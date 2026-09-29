export * as RunnerSecurityPolicy from "./policy"

import path from "path"
import { lstat, realpath, stat } from "node:fs/promises"
import { Coordination } from "@opencode-ai/schema/coordination"
import { Permission } from "@opencode-ai/schema/permission"
import { Effect, Redacted } from "effect"
import type { Session } from "@opencode-ai/schema/session"
import type { RunnerHarnessContracts } from "../contracts"
import { RunnerEnvironment } from "./environment"
import { RunnerRedaction } from "./redaction"

export interface ApprovedProject {
  readonly projectId: Coordination.ProjectID
  readonly repositoryRoot: string
  readonly workspaceRoot: string
}

export interface SessionScope {
  readonly owner: Coordination.ExecutionOwner
  readonly projectId: Coordination.ProjectID
  readonly directory: string
}

export interface Config {
  readonly credentials: RunnerHarnessContracts.Credentials
  readonly projects: ReadonlyArray<ApprovedProject>
  readonly sessionScope: (
    sessionId: Session.ID,
  ) => Effect.Effect<SessionScope | undefined, RunnerHarnessContracts.Failure>
  readonly destinations: Readonly<Record<string, string>>
  readonly allowedDestinationHosts: ReadonlyArray<string>
  readonly allowLoopbackDestination?: boolean
  readonly toolPath: string
  readonly secrets: ReadonlyArray<Redacted.Redacted>
}

const invalid: RunnerHarnessContracts.Failure = { code: "invalid", message: "Runner security scope is invalid" }
const forbidden: RunnerHarnessContracts.Failure = { code: "forbidden", message: "Runner security scope is forbidden" }
const unavailable: RunnerHarnessContracts.Failure = {
  code: "unavailable",
  message: "Runner security policy is not configured",
}

export const make = Effect.fn("RunnerSecurityPolicy.make")(function* (config: Config) {
  if (!config.projects.length || !config.toolPath.trim()) return yield* Effect.fail(unavailable)
  if (new Set(config.projects.map((item) => item.projectId)).size !== config.projects.length)
    return yield* Effect.fail(unavailable)
  const projects = yield* Effect.forEach(config.projects, (item) =>
    Effect.gen(function* () {
      const repositoryRoot = yield* canonicalDirectory(item.repositoryRoot)
      const workspaceRoot = yield* canonicalDirectory(item.workspaceRoot)
      return { ...item, repositoryRoot, workspaceRoot }
    }),
  )
  for (const url of Object.values(config.destinations))
    if (!validDestination(url, config.allowedDestinationHosts, config.allowLoopbackDestination))
      return yield* Effect.fail(unavailable)

  const redact = RunnerRedaction.make(config.secrets)
  const project = (id: Coordination.ProjectID) => projects.find((item) => item.projectId === id)

  const workspace: RunnerHarnessContracts.SecurityPolicy["workspace"] = ({ run, workspace }) =>
    Effect.gen(function* () {
      const approved = project(run.projectId)
      if (!approved) return yield* Effect.fail(forbidden)
      if (
        run.projectId !== workspace.projectId ||
        run.session.projectID !== run.projectId ||
        run.command.threadId !== workspace.threadId ||
        run.command.sessionId !== run.session.id
      )
        return yield* Effect.fail(forbidden)
      const directory = yield* canonicalDirectory(workspace.directory)
      const sessionDirectory = yield* canonicalDirectory(run.session.location.directory)
      if (directory !== sessionDirectory || !within(approved.workspaceRoot, directory))
        return yield* Effect.fail(forbidden)
    })

  const runtimeAccess: RunnerHarnessContracts.SecurityPolicy["runtimeAccess"] = (input) =>
    Effect.gen(function* () {
      if (input.principal.kind !== "runner") return yield* Effect.fail(forbidden)
      yield* config.credentials.verify(input.principal)
      const scope = yield* config.sessionScope(input.sessionId)
      const approved = scope && project(scope.projectId)
      if (!scope || !approved) return yield* Effect.fail(forbidden)
      if (scope.owner.workerId !== input.principal.workerId || scope.owner.instanceId !== input.principal.instanceId)
        return yield* Effect.fail(forbidden)
      const directory = yield* canonicalDirectory(scope.directory)
      if (!within(approved.workspaceRoot, directory)) return yield* Effect.fail(forbidden)
    })

  const toolEnvironment: RunnerHarnessContracts.SecurityPolicy["toolEnvironment"] = (execution) =>
    Effect.gen(function* () {
      if (!execution.workspace) return yield* Effect.fail(invalid)
      yield* workspace({ run: execution.run, workspace: execution.workspace })
      const environment = RunnerEnvironment.tool({
        workspace: execution.workspace.directory,
        executablePath: config.toolPath,
      })
      yield* verifyToolHome(environment.HOME)
      if (!RunnerEnvironment.rejectsInheritedSecrets(environment)) return yield* Effect.fail(invalid)
      return environment
    })

  const artifact: RunnerHarnessContracts.SecurityPolicy["artifact"] = (input) =>
    Effect.gen(function* () {
      if (!input.execution.workspace) return yield* Effect.fail(invalid)
      yield* workspace({ run: input.execution.run, workspace: input.execution.workspace })
      if (!path.isAbsolute(input.path) || RunnerRedaction.sensitiveArtifact(input.path)) return undefined
      const root = yield* canonicalDirectory(input.execution.workspace.directory)
      const target = yield* canonicalPath(input.path).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!target || !within(root, target)) return undefined
      return { ref: RunnerRedaction.safeReference(input.ref) }
    })

  return { workspace, runtimeAccess, toolEnvironment, artifact, redact } satisfies RunnerHarnessContracts.SecurityPolicy
})

export function validDestination(url: string, allowedHosts: ReadonlyArray<string>, allowLoopback = false) {
  const parsed = URL.parse(url)
  if (!parsed || parsed.username || parsed.password || parsed.hash || !allowedHosts.includes(parsed.hostname))
    return false
  const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]"
  if (loopback) return allowLoopback && (parsed.protocol === "http:" || parsed.protocol === "https:")
  if (/^(?:\d+\.\d+\.\d+\.\d+|\[.*\])$/.test(parsed.hostname)) return false
  return parsed.protocol === "https:"
}

/** Agent-local rules; these never change a developer's saved/global approvals. */
export function permissionRules(options: { readonly trustedLocalShell?: boolean } = {}): Permission.Ruleset {
  return [
    { action: "*", resource: "*", effect: "ask" },
    { action: "read", resource: "*", effect: "allow" },
    { action: "glob", resource: "*", effect: "allow" },
    { action: "grep", resource: "*", effect: "allow" },
    { action: "todowrite", resource: "*", effect: "allow" },
    { action: "external_directory", resource: "*", effect: "deny" },
    { action: "webfetch", resource: "*", effect: "deny" },
    { action: "websearch", resource: "*", effect: "deny" },
    { action: "bash", resource: "*", effect: options.trustedLocalShell ? "ask" : "deny" },
  ]
}

export function within(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function canonicalDirectory(input: string) {
  return Effect.tryPromise({
    try: async () => {
      if (!path.isAbsolute(input) || !(await stat(input)).isDirectory()) throw new Error("invalid directory")
      return realpath(input)
    },
    catch: () => invalid,
  })
}

function canonicalPath(input: string) {
  return Effect.tryPromise({
    try: async () => {
      const resolved = path.resolve(input)
      const info = await lstat(resolved).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined
        throw error
      })
      if (info?.isSymbolicLink()) throw new Error("Artifact symlink is not allowed")
      if (info) return realpath(resolved)
      const parent = await realpath(path.dirname(resolved))
      return path.join(parent, path.basename(resolved))
    },
    catch: () => invalid,
  })
}

function verifyToolHome(home: string) {
  return Effect.tryPromise({
    try: async () => {
      const info = await lstat(home).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined
        throw error
      })
      if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error("Unsafe tool home")
    },
    catch: () => invalid,
  })
}
