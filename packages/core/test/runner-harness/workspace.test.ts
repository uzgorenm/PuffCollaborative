import { describe, expect, test } from "bun:test"
import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { DateTime, Effect } from "effect"
import { Coordination } from "@opencode-ai/schema/coordination"
import { Session } from "@opencode-ai/schema/session"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { Hash } from "@opencode-ai/core/util/hash"
import { RunnerWorkspaces } from "@opencode-ai/core/runner-harness/workspace"
import type { AuthorizedRun } from "@opencode-ai/core/runner-harness/contracts"
import { tmpdir } from "../fixture/tmpdir"

const exec = promisify(execFile)

async function git(cwd: string, ...args: string[]) {
  return (await exec("git", args, { cwd, encoding: "utf8" })).stdout.trim()
}

async function repository(root: string) {
  const directory = path.join(root, "source")
  await fs.mkdir(directory)
  await git(root, "init", "-q", directory)
  await git(directory, "config", "user.name", "Workspace Test")
  await git(directory, "config", "user.email", "workspace@example.test")
  await fs.writeFile(path.join(directory, "shared.txt"), "base\n")
  await fs.writeFile(path.join(directory, ".gitignore"), "ignored.log\n")
  await git(directory, "add", "shared.txt", ".gitignore")
  await git(directory, "commit", "-qm", "base")
  return { directory: await fs.realpath(directory), revision: await git(directory, "rev-parse", "HEAD") }
}

function run(
  projectId: Coordination.ProjectID,
  threadId: Coordination.ThreadID,
  directory: string,
  serial = "one",
): AuthorizedRun {
  const sessionId = Session.ID.make(`ses_${threadId}`)
  return {
    projectId,
    attempt: 1,
    command: {
      runId: Coordination.RunID.make(`run_${serial}`),
      threadId,
      sessionId,
      executionOwner: { workerId: Coordination.WorkerID.make("worker_one"), instanceId: "instance_one" },
      runnerMessageId: `msg_${serial}`,
      text: `Turn ${serial}`,
    },
    session: Session.Info.make({
      id: sessionId,
      projectID: projectId,
      title: "Workspace test",
      location: {
        directory: AbsolutePath.make(directory),
        workspaceID: Workspace.ID.make(`wrk_${Hash.sha256(`${projectId}\0${threadId}`).slice(0, 32)}`),
      },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
    }),
  }
}

function target(root: string, projectId: Coordination.ProjectID, threadId: Coordination.ThreadID) {
  return path.join(root, Hash.sha256(`${projectId}\0${threadId}`).slice(0, 32))
}

async function withWorkspace<A>(
  directory: string,
  body: (input: {
    db: Database.Interface["db"]
    project: ProjectV2.Interface
    flock: EffectFlock.Interface
  }) => Effect.Effect<A, unknown>,
) {
  const database = makeGlobalNode({
    service: Database.Service,
    layer: Database.layerFromPath(path.join(directory, "runner.sqlite")),
    deps: [],
  })
  const layer = AppNodeBuilder.build(LayerNode.group([Database.node, ProjectV2.node, EffectFlock.node]), [
    [Database.node, database],
  ])
  return Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const project = yield* ProjectV2.Service
      const flock = yield* EffectFlock.Service
      return yield* body({ db, project, flock })
    }).pipe(Effect.provide(layer), Effect.scoped),
  )
}

describe("runner workspaces (disposable Git repositories)", () => {
  test("isolates matching filenames and preserves a Thread's edits across turns and retries", async () => {
    await using tmp = await tmpdir()
    const source = await repository(tmp.path)
    await withWorkspace(tmp.path, ({ db, project, flock }) =>
      Effect.gen(function* () {
        const projectId = (yield* project.resolve(AbsolutePath.make(source.directory))).id
        const root = path.join(tmp.path, "workspaces")
        const workspace = RunnerWorkspaces.make({
          db,
          project,
          flock,
          root,
          sources: { [projectId]: { repository: source.directory, baseRevision: source.revision } },
          activity: () => Effect.succeed("idle"),
        })
        const a = Coordination.ThreadID.make("thr_a")
        const b = Coordination.ThreadID.make("thr_b")
        const first = run(projectId, a, target(root, projectId, a))
        const second = run(projectId, b, target(root, projectId, b), "two")
        const allocated = yield* Effect.all([workspace.ensure(first), workspace.ensure(second)], { concurrency: 2 })
        expect(allocated[0].directory).not.toBe(allocated[1].directory)
        yield* Effect.promise(() => fs.writeFile(path.join(allocated[0].directory, "shared.txt"), "A edited\n"))
        yield* Effect.promise(() => fs.writeFile(path.join(allocated[1].directory, "shared.txt"), "B edited\n"))
        const repeated = yield* Effect.all([workspace.ensure(first), workspace.ensure(first)], { concurrency: 2 })
        const later = yield* workspace.ensure(run(projectId, a, target(root, projectId, a), "later"))
        expect(repeated).toEqual([allocated[0], allocated[0]])
        expect(later).toEqual(allocated[0])
        expect(yield* Effect.promise(() => fs.readFile(path.join(later.directory, "shared.txt"), "utf8"))).toBe(
          "A edited\n",
        )
        expect(yield* Effect.promise(() => fs.readFile(path.join(allocated[1].directory, "shared.txt"), "utf8"))).toBe(
          "B edited\n",
        )
        expect((yield* workspace.inspect(a))?.dirty).toBe(true)
        expect((yield* workspace.inspect(b))?.dirty).toBe(true)
        const changed = {
          ...first,
          command: { ...first.command, sessionId: Session.ID.make("ses_other") },
          session: Session.Info.make({ ...first.session, id: Session.ID.make("ses_other") }),
        }
        expect((yield* Effect.flip(workspace.ensure(changed))).code).toBe("conflict")
      }),
    )
    await withWorkspace(tmp.path, ({ db, project, flock }) =>
      Effect.gen(function* () {
        const projectId = (yield* project.resolve(AbsolutePath.make(source.directory))).id
        const root = path.join(tmp.path, "workspaces")
        const threadId = Coordination.ThreadID.make("thr_a")
        const workspace = RunnerWorkspaces.make({
          db,
          project,
          flock,
          root,
          sources: { [projectId]: { repository: source.directory, baseRevision: source.revision } },
          activity: () => Effect.succeed("idle"),
        })
        const restored = yield* workspace.ensure(
          run(projectId, threadId, target(root, projectId, threadId), "after_restart"),
        )
        expect(yield* Effect.promise(() => fs.readFile(path.join(restored.directory, "shared.txt"), "utf8"))).toBe(
          "A edited\n",
        )
      }),
    )
  }, 30_000)

  test("adopts an existing OpenCode worktree for its bound Session", async () => {
    await using tmp = await tmpdir()
    const source = await repository(tmp.path)
    await fs.writeFile(path.join(source.directory, "shared.txt"), "new base\n")
    await git(source.directory, "add", "shared.txt")
    await git(source.directory, "commit", "-qm", "new base")
    const laterRevision = await git(source.directory, "rev-parse", "HEAD")
    await withWorkspace(tmp.path, ({ db, project, flock }) =>
      Effect.gen(function* () {
        const projectId = (yield* project.resolve(AbsolutePath.make(source.directory))).id
        const root = path.join(tmp.path, "workspaces")
        const existing = path.join(root, "already-open")
        const threadId = Coordination.ThreadID.make("thr_adopted")
        yield* Effect.promise(() => fs.mkdir(root))
        yield* Effect.promise(() =>
          git(source.directory, "worktree", "add", "-b", "opencode/previous-work", existing, source.revision),
        )
        yield* Effect.promise(() => fs.writeFile(path.join(existing, "shared.txt"), "earlier turn\n"))
        const config = {
          db,
          project,
          flock,
          root,
          activity: () => Effect.succeed("idle" as const),
        }
        const newerBase = RunnerWorkspaces.make({
          ...config,
          sources: { [projectId]: { repository: source.directory, baseRevision: laterRevision } },
        })
        expect((yield* Effect.flip(newerBase.ensure(run(projectId, threadId, existing)))).code).toBe("conflict")
        const workspace = RunnerWorkspaces.make({
          ...config,
          sources: { [projectId]: { repository: source.directory, baseRevision: source.revision } },
        })
        const allocated = yield* workspace.ensure(run(projectId, threadId, existing))
        expect(allocated.directory).toBe(existing)
        expect((yield* workspace.inspect(threadId))?.branch).toBe("opencode/previous-work")
        expect((yield* workspace.ensure(run(projectId, threadId, existing, "next"))).directory).toBe(existing)
        expect(yield* Effect.promise(() => fs.readFile(path.join(existing, "shared.txt"), "utf8"))).toBe(
          "earlier turn\n",
        )
      }),
    )
  })

  test("rejects invalid repository paths, Thread IDs, and a foreign directory at the assigned path", async () => {
    await using tmp = await tmpdir()
    const source = await repository(tmp.path)
    await withWorkspace(tmp.path, ({ db, project, flock }) =>
      Effect.gen(function* () {
        const projectId = (yield* project.resolve(AbsolutePath.make(source.directory))).id
        const root = path.join(tmp.path, "workspaces")
        const threadId = Coordination.ThreadID.make("thr_valid")
        const good = run(projectId, threadId, target(root, projectId, threadId))
        const config = {
          db,
          project,
          flock,
          root,
          activity: () => Effect.succeed("idle" as const),
        }
        const invalid = RunnerWorkspaces.make({
          ...config,
          sources: { [projectId]: { repository: `${source.directory}/../source`, baseRevision: source.revision } },
        })
        expect((yield* Effect.flip(invalid.ensure(good))).code).toBe("invalid")
        const invalidRevision = RunnerWorkspaces.make({
          ...config,
          sources: { [projectId]: { repository: source.directory, baseRevision: "../../main" } },
        })
        expect((yield* Effect.flip(invalidRevision.ensure(good))).code).toBe("invalid")
        const workspace = RunnerWorkspaces.make({
          ...config,
          sources: { [projectId]: { repository: source.directory, baseRevision: source.revision } },
        })
        const traversal = Coordination.ThreadID.make("../escape")
        expect(
          (yield* Effect.flip(workspace.ensure(run(projectId, traversal, target(root, projectId, traversal))))).code,
        ).toBe("invalid")
        expect(
          (yield* Effect.flip(workspace.ensure(run(projectId, threadId, path.join(tmp.path, "foreign"))))).code,
        ).toBe("forbidden")
        const foreign = path.join(tmp.path, "foreign")
        yield* Effect.promise(() => fs.mkdir(foreign))
        yield* Effect.promise(() => fs.symlink(foreign, target(root, projectId, threadId)))
        expect((yield* Effect.flip(workspace.ensure(good))).code).toBe("conflict")
        expect(yield* Effect.promise(() => fs.realpath(foreign))).toBe(foreign)
      }),
    )
  })

  test("cleanup refuses active or dirty workspaces and requires explicit dirty disposal", async () => {
    await using tmp = await tmpdir()
    const source = await repository(tmp.path)
    await withWorkspace(tmp.path, ({ db, project, flock }) =>
      Effect.gen(function* () {
        const projectId = (yield* project.resolve(AbsolutePath.make(source.directory))).id
        const root = path.join(tmp.path, "workspaces")
        const threadId = Coordination.ThreadID.make("thr_cleanup")
        let activity: "active" | "idle" | "unknown" = "active"
        const workspace = RunnerWorkspaces.make({
          db,
          project,
          flock,
          root,
          sources: { [projectId]: { repository: source.directory, baseRevision: source.revision } },
          activity: () => Effect.succeed(activity),
        })
        const allocated = yield* workspace.ensure(run(projectId, threadId, target(root, projectId, threadId)))
        expect((yield* Effect.flip(workspace.cleanup({ threadId, disposeDirty: true }))).code).toBe("conflict")
        activity = "unknown"
        expect((yield* Effect.flip(workspace.cleanup({ threadId, disposeDirty: true }))).code).toBe("conflict")
        activity = "idle"
        yield* Effect.promise(() => fs.writeFile(path.join(allocated.directory, "shared.txt"), "dirty\n"))
        expect((yield* Effect.flip(workspace.cleanup({ threadId, disposeDirty: false }))).code).toBe("conflict")
        expect(yield* Effect.promise(() => fs.readFile(path.join(allocated.directory, "shared.txt"), "utf8"))).toBe(
          "dirty\n",
        )
        yield* Effect.promise(() => fs.writeFile(path.join(allocated.directory, "shared.txt"), "base\n"))
        yield* Effect.promise(() => fs.writeFile(path.join(allocated.directory, "ignored.log"), "keep me\n"))
        expect((yield* workspace.inspect(threadId))?.dirty).toBe(true)
        expect((yield* Effect.flip(workspace.cleanup({ threadId, disposeDirty: false }))).code).toBe("conflict")
        expect(yield* workspace.cleanup({ threadId, disposeDirty: true })).toBe(true)
        expect(yield* workspace.inspect(threadId)).toBeUndefined()
        expect(
          yield* Effect.promise(() =>
            git(
              source.directory,
              "show-ref",
              "--verify",
              `refs/heads/runner/${Hash.sha256(`${projectId}\0${threadId}`).slice(0, 32)}`,
            ),
          ),
        ).toBeTruthy()
      }),
    )
  })
})
