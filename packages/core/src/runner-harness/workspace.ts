export * as RunnerWorkspaces from "./workspace"

import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { and, eq, inArray } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import type { Coordination } from "@opencode-ai/schema/coordination"
import { Database } from "../database/database"
import { ProjectV2 } from "../project"
import { AbsolutePath } from "../schema"
import { EffectFlock } from "../util/effect-flock"
import { Hash } from "../util/hash"
import type { AuthorizedRun, Failure, WorkspaceIdentity, Workspaces } from "./contracts"
import { ExecutionTable, ThreadBindingTable } from "./sql"

const exec = promisify(execFile)
const gitEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")))
const activePhases = [
  "accepted",
  "prepared",
  "admitted",
  "running",
  "waiting_approval",
  "cancelling",
  "recovery_required",
] as const

export interface Source {
  /** Canonical checkout of this approved OpenCode project. */
  readonly repository: string
  /** Full commit ID, resolved before a Thread is provisioned. */
  readonly baseRevision: string
}

export interface Config {
  /** Dedicated parent for runner worktrees; it must not be inside a source repository. */
  readonly root: string
  readonly sources: Readonly<Record<string, Source>>
  /** R3 reports whether this workspace still has a drain or scoped tool. Unknown blocks cleanup. */
  readonly activity: (workspace: WorkspaceIdentity) => Effect.Effect<"active" | "idle" | "unknown", Failure>
}

export interface Inspection extends WorkspaceIdentity {
  readonly repository: string
  readonly branch: string
  readonly configuredBaseRevision: string
  readonly dirty: boolean
  readonly activity: "active" | "idle" | "unknown"
}

export interface Interface extends Workspaces {
  readonly inspect: (threadId: Coordination.ThreadID) => Effect.Effect<Inspection | undefined, Failure>
  readonly cleanup: (input: {
    readonly threadId: Coordination.ThreadID
    readonly disposeDirty: boolean
  }) => Effect.Effect<boolean, Failure>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/RunnerWorkspaces") {}

export interface Dependencies extends Config {
  readonly db: Database.Interface["db"]
  readonly project: ProjectV2.Interface
  readonly flock: EffectFlock.Interface
}

export const layerWith = (config: Config) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const project = yield* ProjectV2.Service
      const flock = yield* EffectFlock.Service
      return Service.of(make({ ...config, db, project, flock }))
    }),
  )

export function make(input: Dependencies): Interface {
  const failure = (code: Failure["code"], message: string): Failure => ({ code, message })
  const convert = (cause: unknown): Failure =>
    cause &&
    typeof cause === "object" &&
    "code" in cause &&
    "message" in cause &&
    ["invalid", "forbidden", "not_found", "conflict", "unavailable"].includes(String(cause.code))
      ? (cause as Failure)
      : failure("unavailable", "Workspace filesystem or Git operation failed")
  const reject = (code: Failure["code"], message: string): never => {
    throw failure(code, message)
  }
  const checked = <A>(value: () => A) => Effect.try({ try: value, catch: convert })
  const git = async (cwd: string, args: string[]) =>
    (await exec("git", args, { cwd, env: gitEnvironment, encoding: "utf8", maxBuffer: 1024 * 1024 })).stdout.trim()
  const contains = (parent: string, child: string) => {
    const relative = path.relative(parent, child)
    return !relative || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  }

  const cleanPath = (value: string, label: string) => {
    if (!path.isAbsolute(value) || value !== path.resolve(value) || /[\x00-\x1f]/.test(value))
      reject("invalid", `${label} must be an absolute canonical path`)
    return value
  }

  const root = Effect.tryPromise({
    try: async () => {
      const directory = cleanPath(input.root, "Workspace root")
      if ((await fs.realpath(path.dirname(directory))) !== path.dirname(directory))
        reject("invalid", "Workspace root parent is not canonical")
      await fs.mkdir(directory).catch((cause: NodeJS.ErrnoException) => {
        if (cause.code !== "EEXIST") throw cause
      })
      if ((await fs.realpath(directory)) !== directory) reject("invalid", "Workspace root resolves elsewhere")
      if (!(await fs.stat(directory)).isDirectory()) reject("invalid", "Workspace root is not a directory")
      return directory
    },
    catch: convert,
  })

  const source = (projectId: Coordination.ProjectID) => {
    if (!Object.hasOwn(input.sources, projectId)) return reject("forbidden", "Project has no approved repository")
    const selected = input.sources[projectId]
    if (!selected) return reject("forbidden", "Project has no approved repository")
    cleanPath(selected.repository, "Approved repository")
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(selected.baseRevision))
      reject("invalid", "Base revision must be a full commit ID")
    return selected
  }

  const identity = (run: AuthorizedRun, directory: string): WorkspaceIdentity => {
    if (run.command.sessionId !== run.session.id || run.session.projectID !== run.projectId)
      reject("conflict", "Run and Session binding disagree")
    const workspaceId = run.session.location.workspaceID ?? reject("conflict", "Existing Session has no workspace ID")
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(run.command.threadId)) reject("invalid", "Thread ID contains invalid characters")
    const workspaceDirectory = cleanPath(run.session.location.directory, "Session workspace")
    if (!contains(directory, workspaceDirectory)) reject("forbidden", "Session workspace is outside the approved root")
    const result = {
      id: workspaceId,
      threadId: run.command.threadId,
      projectId: run.projectId,
      directory: workspaceDirectory,
    }
    return result
  }

  const branch = (workspace: WorkspaceIdentity) =>
    `runner/${Hash.sha256(`${workspace.projectId}\0${workspace.threadId}`).slice(0, 32)}`

  const approved = (selected: Source, directory: string) =>
    Effect.gen(function* () {
      const actual = yield* Effect.tryPromise({
        try: async () => {
          if ((await fs.realpath(selected.repository)) !== selected.repository)
            reject("invalid", "Approved repository resolves elsewhere")
          if ((await git(selected.repository, ["rev-parse", "--show-toplevel"])) !== selected.repository)
            reject("invalid", "Approved repository is not its Git worktree root")
          if (contains(selected.repository, directory) || contains(directory, selected.repository))
            reject("invalid", "Workspace root and approved repository overlap")
          return selected.repository
        },
        catch: convert,
      })
      const resolved = yield* input.project.resolve(AbsolutePath.make(actual))
      return resolved
    })

  const verify = (workspace: WorkspaceIdentity, selected: Source, expectedBranch?: string) =>
    Effect.tryPromise({
      try: async () => {
        if ((await fs.realpath(workspace.directory)) !== workspace.directory)
          reject("conflict", "Workspace resolves outside its assigned directory")
        if ((await git(workspace.directory, ["rev-parse", "--show-toplevel"])) !== workspace.directory)
          reject("conflict", "Workspace path is not a Git worktree root")
        const currentBranch = await git(workspace.directory, ["symbolic-ref", "--quiet", "--short", "HEAD"])
        await git(workspace.directory, ["check-ref-format", "--branch", currentBranch])
        if (expectedBranch && currentBranch !== expectedBranch) reject("conflict", "Workspace branch changed")
        const common = await fs.realpath(
          path.resolve(workspace.directory, await git(workspace.directory, ["rev-parse", "--git-common-dir"])),
        )
        const approvedCommon = await fs.realpath(
          path.resolve(selected.repository, await git(selected.repository, ["rev-parse", "--git-common-dir"])),
        )
        if (common !== approvedCommon) reject("conflict", "Workspace is attached to another repository")
        const entries = await git(selected.repository, ["worktree", "list", "--porcelain"])
        if (!entries.split("\n\n").some((entry) => entry.split("\n")[0] === `worktree ${workspace.directory}`))
          reject("conflict", "Workspace is not registered with its repository")
        return currentBranch
      },
      catch: convert,
    })

  const bound = (row: typeof ThreadBindingTable.$inferSelect, workspace: WorkspaceIdentity) => {
    if (
      row.thread_id !== workspace.threadId ||
      row.project_id !== workspace.projectId ||
      row.workspace_id !== workspace.id ||
      row.directory !== workspace.directory
    )
      reject("conflict", "Stored Thread workspace binding changed")
  }

  const ensure: Interface["ensure"] = (run) =>
    Effect.gen(function* () {
      const directory = yield* root
      const selected = yield* checked(() => source(run.projectId))
      const workspace = yield* checked(() => identity(run, directory))
      const expectedBranch = branch(workspace)
      return yield* input.flock
        .withLock(
          Effect.gen(function* () {
            const repo = yield* approved(selected, directory)
            if (repo.id !== run.projectId || repo.directory !== selected.repository)
              return yield* Effect.fail(failure("forbidden", "Approved repository does not belong to this project"))
            const stored = yield* input.db
              .select()
              .from(ThreadBindingTable)
              .where(eq(ThreadBindingTable.thread_id, workspace.threadId))
              .get()
              .pipe(Effect.orDie)
            if (stored) {
              yield* checked(() => bound(stored, workspace))
              if (
                stored.session_id !== run.command.sessionId ||
                stored.worker_id !== run.command.executionOwner.workerId
              )
                return yield* Effect.fail(failure("conflict", "Thread is bound to another Session or worker"))
              yield* verify(workspace, selected)
              return workspace
            }
            const occupied = yield* input.db
              .select({ thread_id: ThreadBindingTable.thread_id })
              .from(ThreadBindingTable)
              .where(eq(ThreadBindingTable.session_id, run.command.sessionId))
              .get()
              .pipe(Effect.orDie)
            if (occupied) return yield* Effect.fail(failure("conflict", "Session is already bound to another Thread"))
            const reusedId = yield* input.db
              .select({ thread_id: ThreadBindingTable.thread_id })
              .from(ThreadBindingTable)
              .where(eq(ThreadBindingTable.workspace_id, workspace.id))
              .get()
              .pipe(Effect.orDie)
            if (reusedId)
              return yield* Effect.fail(failure("conflict", "Workspace ID is already bound to another Thread"))
            const created = yield* Effect.tryPromise({
              try: async () => {
                await git(selected.repository, ["check-ref-format", "--branch", expectedBranch])
                const exists = await fs.lstat(workspace.directory).then(
                  () => true,
                  (cause: NodeJS.ErrnoException) => {
                    if (cause.code === "ENOENT") return false
                    throw cause
                  },
                )
                const commit = await git(selected.repository, ["cat-file", "-t", selected.baseRevision]).then(
                  (kind) => kind === "commit",
                  () => false,
                )
                if (!commit) reject("invalid", "Base revision is not an available commit")
                if (exists) return false
                const expected = path.join(
                  directory,
                  Hash.sha256(`${workspace.projectId}\0${workspace.threadId}`).slice(0, 32),
                )
                if (workspace.directory !== expected)
                  reject("conflict", "New worktree path must be assigned to this Thread")
                const branchExists = await exec(
                  "git",
                  ["show-ref", "--verify", "--quiet", `refs/heads/${expectedBranch}`],
                  {
                    cwd: selected.repository,
                    env: gitEnvironment,
                  },
                ).then(
                  () => true,
                  () => false,
                )
                if (branchExists) reject("conflict", "Thread branch already exists without a workspace")
                await git(selected.repository, [
                  "worktree",
                  "add",
                  "-b",
                  expectedBranch,
                  workspace.directory,
                  selected.baseRevision,
                ])
                return true
              },
              catch: convert,
            })
            yield* verify(workspace, selected, created ? expectedBranch : undefined)
            if (!created) {
              const includesBase = yield* Effect.tryPromise({
                try: () =>
                  exec("git", ["merge-base", "--is-ancestor", selected.baseRevision, "HEAD"], {
                    cwd: workspace.directory,
                    env: gitEnvironment,
                  }).then(
                    () => true,
                    () => false,
                  ),
                catch: convert,
              })
              if (!includesBase)
                return yield* Effect.fail(failure("conflict", "Existing worktree does not include the approved base"))
            }
            yield* input.db
              .insert(ThreadBindingTable)
              .values({
                thread_id: workspace.threadId,
                project_id: workspace.projectId,
                session_id: run.command.sessionId,
                worker_id: run.command.executionOwner.workerId,
                workspace_id: workspace.id,
                directory: workspace.directory,
                created_at: Date.now(),
                updated_at: Date.now(),
              })
              .onConflictDoNothing()
              .run()
              .pipe(Effect.orDie)
            const saved = yield* input.db
              .select()
              .from(ThreadBindingTable)
              .where(eq(ThreadBindingTable.thread_id, workspace.threadId))
              .get()
              .pipe(Effect.orDie)
            if (!saved)
              return yield* Effect.fail(failure("conflict", "Workspace binding conflicts with another Thread"))
            yield* checked(() => bound(saved, workspace))
            if (saved.session_id !== run.command.sessionId || saved.worker_id !== run.command.executionOwner.workerId)
              return yield* Effect.fail(failure("conflict", "Thread is bound to another Session or worker"))
            return workspace
          }),
          `runner-workspace:${directory}:${workspace.threadId}`,
          path.join(directory, ".locks"),
        )
        .pipe(Effect.mapError(convert))
    })

  const inspectLocked = (threadId: Coordination.ThreadID, directory: string) =>
    Effect.gen(function* () {
      const row = yield* input.db
        .select()
        .from(ThreadBindingTable)
        .where(eq(ThreadBindingTable.thread_id, threadId))
        .get()
        .pipe(Effect.orDie)
      if (!row) return undefined
      const selected = yield* checked(() => source(row.project_id))
      const workspace: WorkspaceIdentity = {
        id: row.workspace_id,
        threadId: row.thread_id,
        projectId: row.project_id,
        directory: row.directory,
      }
      if (!contains(directory, workspace.directory))
        return yield* Effect.fail(failure("conflict", "Stored workspace path is outside its assigned root"))
      const repo = yield* approved(selected, directory)
      if (repo.id !== row.project_id || repo.directory !== selected.repository)
        return yield* Effect.fail(failure("forbidden", "Approved repository does not belong to this project"))
      const currentBranch = yield* verify(workspace, selected)
      const dirty = yield* Effect.tryPromise({
        try: async () =>
          (await git(workspace.directory, ["status", "--porcelain", "--untracked-files=all", "--ignored"])).length > 0,
        catch: convert,
      })
      const local = yield* input.db
        .select({ run_id: ExecutionTable.run_id })
        .from(ExecutionTable)
        .where(and(eq(ExecutionTable.thread_id, threadId), inArray(ExecutionTable.phase, activePhases)))
        .get()
        .pipe(Effect.orDie)
      return {
        ...workspace,
        repository: selected.repository,
        branch: currentBranch,
        configuredBaseRevision: selected.baseRevision,
        dirty,
        activity: local ? ("active" as const) : yield* input.activity(workspace),
      }
    })

  const inspect: Interface["inspect"] = (threadId) =>
    Effect.gen(function* () {
      const directory = yield* root
      return yield* input.flock
        .withLock(
          inspectLocked(threadId, directory),
          `runner-workspace:${directory}:${threadId}`,
          path.join(directory, ".locks"),
        )
        .pipe(Effect.mapError(convert))
    })

  const cleanup: Interface["cleanup"] = (request) =>
    Effect.gen(function* () {
      const directory = yield* root
      return yield* input.flock
        .withLock(
          Effect.gen(function* () {
            const inspected = yield* inspectLocked(request.threadId, directory)
            if (!inspected) return false
            if (inspected.activity !== "idle")
              return yield* Effect.fail(failure("conflict", "Workspace is active or its runtime state is unknown"))
            if (inspected.dirty && !request.disposeDirty)
              return yield* Effect.fail(failure("conflict", "Workspace has uncommitted changes"))
            yield* Effect.tryPromise({
              try: () =>
                git(inspected.repository, [
                  "worktree",
                  "remove",
                  ...(request.disposeDirty ? ["--force"] : []),
                  inspected.directory,
                ]),
              catch: convert,
            })
            yield* input.db
              .delete(ThreadBindingTable)
              .where(
                and(
                  eq(ThreadBindingTable.thread_id, inspected.threadId),
                  eq(ThreadBindingTable.workspace_id, inspected.id),
                  eq(ThreadBindingTable.directory, inspected.directory),
                ),
              )
              .run()
              .pipe(Effect.orDie)
            return true
          }),
          `runner-workspace:${directory}:${request.threadId}`,
          path.join(directory, ".locks"),
        )
        .pipe(Effect.mapError(convert))
    })

  return { ensure, inspect, cleanup }
}
