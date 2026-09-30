export * as CoordinationProvisioning from "./index"

import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { and, eq } from "drizzle-orm"
import { Effect, Semaphore } from "effect"
import { Coordination } from "@opencode-ai/schema/coordination"
import type { Model } from "@opencode-ai/schema/model"
import { Session } from "@opencode-ai/schema/session"
import { Workspace } from "@opencode-ai/schema/workspace"
import type { Database } from "../../database/database"
import type { ProjectV2 } from "../../project"
import { ProjectTable } from "../../project/sql"
import { AbsolutePath } from "../../schema"
import type { SessionV2 } from "../../session"
import type { EffectFlock } from "../../util/effect-flock"
import { Hash } from "../../util/hash"
import type { SessionSelection } from "../access/selection"
import type { CoordinationContracts } from "../contracts"
import { ProvisioningTable } from "./sql"

export interface Config {
  readonly workspaceRoot: string
  readonly worker: { readonly workerId: Coordination.WorkerID; readonly instanceId: string }
  readonly model?: Model.Ref
  readonly providerConfigPath?: string
  readonly projects: ReadonlyArray<{
    readonly name: string
    readonly repositoryRoot: string
    readonly baseRevision: string
    readonly allowedUsers: ReadonlyArray<Coordination.UserID>
  }>
}

export interface Interface {
  readonly list: (
    principal: Coordination.AuthContext,
  ) => Effect.Effect<Coordination.ProvisioningView, CoordinationContracts.Failure>
  readonly provision: (input: {
    readonly principal: Coordination.AuthContext
    readonly projectId: Coordination.ProjectID
    readonly requestId: string
    readonly title: string
  }) => Effect.Effect<Coordination.ProvisionedSession, CoordinationContracts.Failure>
}

export interface Dependencies {
  readonly db: Database.Interface["db"]
  readonly project: ProjectV2.Interface
  readonly sessions: Pick<SessionV2.Interface, "create" | "get">
  readonly projects: Pick<CoordinationContracts.Projects, "createThread">
  readonly access: CoordinationContracts.Access
  readonly admission: CoordinationContracts.ProjectAdmission
  readonly flock: EffectFlock.Interface
  readonly config: Config
  readonly ready: (directory: string, model: Model.Ref) => Effect.Effect<boolean>
}

const forbidden: CoordinationContracts.Failure = {
  code: "forbidden",
  message: "Approved project and owner admission required",
}
const conflict: CoordinationContracts.Failure = {
  code: "conflict",
  message: "Provisioning request conflicts with its durable reservation",
}
const invalid: CoordinationContracts.Failure = { code: "invalid", message: "Invalid Session provisioning request" }
const unavailable: CoordinationContracts.Failure = {
  code: "unavailable",
  message: "Configured coding model or provisioning runtime is unavailable",
}
const exec = promisify(execFile)
const gitEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")))
const locks = Semaphore.makeUnsafe(1)
const contains = (parent: string, child: string) => {
  const relative = path.relative(parent, child)
  return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}
const git = async (directory: string, ...args: string[]) =>
  (
    await exec("git", args, { cwd: directory, env: gitEnvironment, encoding: "utf8", maxBuffer: 1024 * 1024 })
  ).stdout.trim()

/** Dynamic selections are granted only by an authenticated, durable provisioning reservation. */
export function selection(db: Database.Interface["db"], configured?: SessionSelection): SessionSelection {
  return {
    canShareSession: (userId, projectId, sessionId, workerId) =>
      Effect.gen(function* () {
        const row = yield* db
          .select({ phase: ProvisioningTable.phase })
          .from(ProvisioningTable)
          .where(
            and(
              eq(ProvisioningTable.owner_id, userId),
              eq(ProvisioningTable.project_id, projectId),
              eq(ProvisioningTable.session_id, sessionId),
              eq(ProvisioningTable.worker_id, workerId),
            ),
          )
          .get()
          .pipe(Effect.orDie)
        if (row && (row.phase === "session" || row.phase === "shared")) return true
        return configured ? yield* configured.canShareSession(userId, projectId, sessionId, workerId) : false
      }),
  }
}

/** A shared Thread's creator is not necessarily its Session owner. Only our durable reservation proves ownership. */
export const ownerOf = (db: Database.Interface["db"], thread: Coordination.Thread) =>
  Effect.gen(function* () {
    const row = yield* db
      .select()
      .from(ProvisioningTable)
      .where(
        and(eq(ProvisioningTable.project_id, thread.projectId), eq(ProvisioningTable.session_id, thread.sessionId)),
      )
      .get()
      .pipe(Effect.orDie)
  // The reservation proves ownership before the final shared projection is saved. A crash after
  // createThread must not make a provisioned Session fall back to legacy shared work control.
  return (row?.phase === "session" || row?.phase === "shared") &&
    (!row.thread || row.thread.id === thread.id) && row.worker_id === thread.workerId
    ? row.owner_id
      : undefined
  })

export function make(input: Dependencies): Interface {
  const approved = (principal: Coordination.AuthContext) =>
    Effect.gen(function* () {
      if (principal.kind !== "member") return yield* Effect.fail(forbidden)
      return yield* Effect.forEach(
        input.config.projects.filter((item) => item.allowedUsers.includes(principal.userId)),
        (item) =>
          Effect.gen(function* () {
            const canonical = yield* Effect.tryPromise({
              try: async () => {
                if (
                  !path.isAbsolute(item.repositoryRoot) ||
                  (await fs.realpath(item.repositoryRoot)) !== item.repositoryRoot ||
                  (await git(item.repositoryRoot, "rev-parse", "--show-toplevel")) !== item.repositoryRoot ||
                  !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(item.baseRevision) ||
                  (await git(item.repositoryRoot, "cat-file", "-t", item.baseRevision)) !== "commit"
                )
                  throw unavailable
                return item.repositoryRoot
              },
              catch: () => unavailable,
            })
            const resolved = yield* input.project.resolve(AbsolutePath.make(canonical))
            if (!(yield* input.admission.canShareExistingProject(principal.userId, resolved.id))) return undefined
            yield* input.db
              .insert(ProjectTable)
              .values({ id: resolved.id, worktree: AbsolutePath.make(canonical), vcs: "git", sandboxes: [] })
              .onConflictDoNothing()
              .run()
              .pipe(Effect.orDie)
            return { ...item, projectId: resolved.id }
          }),
      ).pipe(Effect.map((items) => items.filter((item) => item !== undefined)))
    })
  const result = (row: typeof ProvisioningTable.$inferSelect): Coordination.ProvisionedSession => ({
    thread: row.thread!,
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    directory: row.directory,
    ownerUserId: row.owner_id,
  })
  return {
    list: (principal) =>
      Effect.gen(function* () {
        const projects = yield* approved(principal)
        return {
          projects: yield* Effect.forEach(projects, (item) =>
            Effect.gen(function* () {
              const modelReady = input.config.model
                ? yield* input.ready(item.repositoryRoot, input.config.model)
                : false
              return { projectId: item.projectId, name: item.name, modelReady }
            }),
          ),
          privateSessions: false,
        }
      }),
    provision: (request) =>
      locks.withPermit(
        Effect.gen(function* () {
          if (request.principal.kind !== "member") return yield* Effect.fail(forbidden)
          const principal = request.principal
          if (!/^[A-Za-z0-9_-]{1,160}$/.test(request.requestId) || !request.title.trim() || request.title.length > 256)
            return yield* Effect.fail(invalid)
          const selected = (yield* approved(request.principal)).find((item) => item.projectId === request.projectId)
          if (!selected) return yield* Effect.fail(forbidden)
          yield* input.access.authorize(request.principal, request.projectId, undefined, "submit")
          const id = Hash.sha256(`${request.projectId}\0${request.principal.userId}\0${request.requestId}`)
          const prior = yield* input.db
            .select()
            .from(ProvisioningTable)
            .where(eq(ProvisioningTable.id, id))
            .get()
            .pipe(Effect.orDie)
          if (prior && prior.title !== request.title) return yield* Effect.fail(conflict)
          if (prior?.phase === "shared" && prior.thread) return result(prior)
          if (!input.config.model || !(yield* input.ready(selected.repositoryRoot, input.config.model)))
            return yield* Effect.fail(unavailable)
          const model = input.config.model
          const signature = Hash.sha256(
            JSON.stringify([
              selected,
              input.config.workspaceRoot,
              input.config.worker,
              model,
              input.config.providerConfigPath,
            ]),
          )
          if (prior && prior.config_signature !== signature) return yield* Effect.fail(conflict)
          const root = input.config.workspaceRoot
          yield* Effect.tryPromise({
            try: async () => {
              if (
                !path.isAbsolute(root) ||
                path.resolve(root) !== root ||
                (await fs.realpath(path.dirname(root))) !== path.dirname(root) ||
                contains(selected.repositoryRoot, root) ||
                contains(root, selected.repositoryRoot)
              )
                throw unavailable
              await fs.mkdir(root, { mode: 0o700, recursive: false }).catch((error: NodeJS.ErrnoException) => {
                if (error.code !== "EEXIST") throw error
              })
              if ((await fs.realpath(root)) !== root) throw unavailable
            },
            catch: () => unavailable,
          })
          return yield* input.flock
            .withLock(
              Effect.gen(function* () {
                const now = Date.now()
                yield* input.db
                  .insert(ProvisioningTable)
                  .values({
                    id,
                    project_id: request.projectId,
                    owner_id: principal.userId,
                    request_id: request.requestId,
                    title: request.title,
                    worker_id: input.config.worker.workerId,
                    session_id: Session.ID.make(`ses_${id.slice(0, 40)}`),
                    workspace_id: `wrk_${id.slice(0, 40)}`,
                    directory: path.join(root, id.slice(0, 40)),
                    model,
                    config_signature: signature,
                    phase: "reserved",
                    created_at: now,
                    updated_at: now,
                  })
                  .onConflictDoNothing()
                  .run()
                  .pipe(Effect.orDie)
                const row = yield* input.db
                  .select()
                  .from(ProvisioningTable)
                  .where(eq(ProvisioningTable.id, id))
                  .get()
                  .pipe(Effect.orDie)
                if (!row || row.title !== request.title || row.config_signature !== signature)
                  return yield* Effect.fail(conflict)
                if (row.phase === "shared" && row.thread) return result(row)
                const branch = `puff/${id.slice(0, 40)}`
                yield* Effect.tryPromise({
                  try: async () => {
                    const existing = await fs.lstat(row.directory).then(
                      () => true,
                      (error: NodeJS.ErrnoException) => {
                        if (error.code === "ENOENT") return false
                        throw error
                      },
                    )
                    if (!existing)
                      await git(
                        selected.repositoryRoot,
                        "worktree",
                        "add",
                        "-b",
                        branch,
                        row.directory,
                        selected.baseRevision,
                      )
                    if (
                      (await fs.realpath(row.directory)) !== row.directory ||
                      (await git(row.directory, "rev-parse", "--show-toplevel")) !== row.directory ||
                      (await git(row.directory, "symbolic-ref", "--quiet", "--short", "HEAD")) !== branch
                    )
                      throw conflict
                    const common = await fs.realpath(
                      path.resolve(row.directory, await git(row.directory, "rev-parse", "--git-common-dir")),
                    )
                    const sourceCommon = await fs.realpath(
                      path.resolve(
                        selected.repositoryRoot,
                        await git(selected.repositoryRoot, "rev-parse", "--git-common-dir"),
                      ),
                    )
                    if (common !== sourceCommon) throw conflict
                    await git(row.directory, "merge-base", "--is-ancestor", selected.baseRevision, "HEAD")
                    if (input.config.providerConfigPath && row.phase === "reserved") {
                      if (
                        !path.isAbsolute(input.config.providerConfigPath) ||
                        (await fs.realpath(input.config.providerConfigPath)) !== input.config.providerConfigPath
                      )
                        throw unavailable
                      // Rename a private file so a repository-controlled destination symlink cannot redirect credential writes.
                      const temporary = await fs.mkdtemp(path.join(row.directory, ".provision-config-"))
                      try {
                        const file = path.join(temporary, "opencode.json")
                        await fs.copyFile(input.config.providerConfigPath, file)
                        await fs.chmod(file, 0o600)
                        await fs.rename(file, path.join(row.directory, "opencode.json"))
                      } finally {
                        await fs.rm(temporary, { recursive: true, force: true })
                      }
                    }
                  },
                  catch: (error) => (error === conflict ? conflict : unavailable),
                })
                yield* input.db
                  .update(ProvisioningTable)
                  .set({ phase: "worktree", updated_at: Date.now() })
                  .where(eq(ProvisioningTable.id, id))
                  .run()
                  .pipe(Effect.orDie)
                const session = yield* input.sessions.create({
                  id: row.session_id,
                  model: row.model,
                  location: {
                    directory: AbsolutePath.make(row.directory),
                    workspaceID: Workspace.ID.make(row.workspace_id),
                  },
                })
                if (
                  session.projectID !== request.projectId ||
                  session.location.directory !== row.directory ||
                  session.location.workspaceID !== row.workspace_id ||
                  session.model?.id !== row.model.id ||
                  session.model.providerID !== row.model.providerID ||
                  (session.model.variant ?? "default") !== (row.model.variant ?? "default")
                )
                  return yield* Effect.fail(conflict)
                yield* input.db
                  .update(ProvisioningTable)
                  .set({ phase: "session", updated_at: Date.now() })
                  .where(eq(ProvisioningTable.id, id))
                  .run()
                  .pipe(Effect.orDie)
                const thread = yield* input.projects.createThread({
                  auth: request.principal,
                  projectId: request.projectId,
                  sessionId: row.session_id,
                  title: row.title,
                  requestId: `provision_${id}`,
                })
                yield* input.db
                  .update(ProvisioningTable)
                  .set({ phase: "shared", thread, updated_at: Date.now() })
                  .where(eq(ProvisioningTable.id, id))
                  .run()
                  .pipe(Effect.orDie)
                return result({ ...row, phase: "shared", thread })
              }),
              `coordination-provisioning:${root}`,
              path.join(root, ".provision-locks"),
            )
            .pipe(Effect.mapError((error) => ("code" in error ? error : unavailable)))
        }),
      ),
  }
}
