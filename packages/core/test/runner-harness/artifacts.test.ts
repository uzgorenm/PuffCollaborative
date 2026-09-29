import { $ } from "bun"
import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { DateTime, Effect, Redacted } from "effect"
import { AppProcess } from "@opencode-ai/core/process"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Git } from "@opencode-ai/core/git"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { RunnerArtifacts } from "@opencode-ai/core/runner-harness/artifacts"
import type { LocalExecution, SecurityPolicy } from "@opencode-ai/core/runner-harness/contracts"
import { RunnerSecurityPolicy } from "@opencode-ai/core/runner-harness/security/policy"
import { Coordination } from "@opencode-ai/schema/coordination"
import { Session } from "@opencode-ai/schema/session"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Git.node, AppProcess.node])))

describe("runner artifacts", () => {
  it.live(
    "separates a run from prior work and marks incomplete or excluded content",
    () =>
      Effect.acquireUseRelease(
        Effect.promise(() => tmpdir()),
        (tmp) =>
          Effect.gen(function* () {
            const directory = path.join(tmp.path, "workspace")
            yield* Effect.promise(async () => {
              await fs.mkdir(directory)
              await $`git init`.cwd(directory).quiet()
              await $`git config user.name Test`.cwd(directory).quiet()
              await $`git config user.email test@example.com`.cwd(directory).quiet()
              await $`git config commit.gpgsign false`.cwd(directory).quiet()
              await fs.writeFile(path.join(directory, "dirty.txt"), "original\n")
              await fs.writeFile(path.join(directory, "delete.txt"), "delete me\n")
              await fs.writeFile(path.join(directory, "rename.txt"), "move me\n")
              await $`git add .`.cwd(directory).quiet()
              await $`git commit -m initial`.cwd(directory).quiet()
              const initial = (await $`git rev-parse HEAD`.cwd(directory).quiet()).text().trim()
              await $`git update-ref refs/remotes/origin/main ${initial}`.cwd(directory).quiet()
              await fs.writeFile(path.join(directory, "committed.txt"), "prior commit\n")
              await $`git add committed.txt`.cwd(directory).quiet()
              await $`git commit -m prior`.cwd(directory).quiet()
              await fs.writeFile(path.join(directory, "dirty.txt"), "prior dirty\n")
              await fs.writeFile(path.join(directory, "prior-untracked.txt"), "prior untracked\n")
              await fs.writeFile(path.join(directory, ".env.preexisting"), "credential=SECRET\n")
            })

            const execution = run(directory, "thread-a", "run-a")
            const security = yield* RunnerSecurityPolicy.make({
              credentials: {
                verify: () => Effect.void,
                principal: (owner) => Effect.succeed({ kind: "runner", ...owner }),
              },
              projects: [{ projectId: execution.run.projectId, repositoryRoot: directory, workspaceRoot: tmp.path }],
              sessionScope: () => Effect.succeed(undefined),
              destinations: {},
              allowedDestinationHosts: [],
              toolPath: "/usr/bin:/bin",
              secrets: [Redacted.make("SECRET")],
            })
            const artifacts = RunnerArtifacts.make({
              git: yield* Git.Service,
              process: yield* AppProcess.Service,
              policy: security,
              dataDirectory: path.join(tmp.path, "opencode-data"),
            })
            const baseline = yield* artifacts.baseline(execution)
            expect(baseline.state).toBe("truncated")
            expect(baseline.excludedCount).toBeGreaterThan(0)
            expect(baseline.branchBaseKind).toBe("origin/main")
            expect(baseline.dirtyPaths).toContain("dirty.txt")
            expect(baseline.dirtyPaths).toContain("prior-untracked.txt")
            expect(JSON.stringify(baseline)).not.toContain(".env.preexisting")
            const snapshots = path.join(tmp.path, "opencode-data", "runner-harness", "artifacts")
            const shadow = path.join(snapshots, (yield* Effect.promise(() => fs.readdir(snapshots)))[0] ?? "missing")
            expect(
              (yield* Effect.promise(() =>
                $`git --git-dir=${shadow} ls-tree -r --name-only ${baseline.revision}`.quiet(),
              )).text(),
            ).not.toContain(".env.preexisting")

            yield* Effect.promise(async () => {
              await fs.writeFile(path.join(directory, "dirty.txt"), "prior dirty\nrun edit\n")
              await fs.writeFile(path.join(directory, "prior-untracked.txt"), "prior untracked\nrun edit\n")
              await fs.writeFile(path.join(directory, "new.txt"), "SECRET value\n")
              await fs.writeFile(path.join(directory, "staged.txt"), "staged addition\n")
              await $`git add staged.txt`.cwd(directory).quiet()
              await fs.unlink(path.join(directory, "delete.txt"))
              await fs.rename(path.join(directory, "rename.txt"), path.join(directory, "renamed.txt"))
              await fs.writeFile(path.join(directory, "blob.bin"), Buffer.from([0, 1, 2, 3]))
              await fs.writeFile(path.join(directory, "large.txt"), "x".repeat(2 * 1024 * 1024 + 1))
              await fs.writeFile(path.join(directory, "medium.txt"), "line\n".repeat(30_000))
              await fs.writeFile(path.join(directory, ".env.local"), "credential=SECRET\n")
              await fs.writeFile(path.join(tmp.path, "outside.txt"), "host content\n")
              await fs.symlink(path.join(tmp.path, "outside.txt"), path.join(directory, "host-link.txt"))
            })

            const report = yield* artifacts.collect({ execution, baseline })
            const changes = new Map(report.changed.map((item) => [item.path, item]))
            expect(report.projectId).toBe(execution.run.projectId)
            expect(report.threadId).toBe(execution.run.command.threadId)
            expect(report.runId).toBe(execution.run.command.runId)
            expect(report.baseline).toBe(baseline.revision)
            expect(report.scopes.run.changed).toBe(report.changed)
            expect(changes.get("dirty.txt")).toMatchObject({ status: "modified", dirtyBeforeRun: true })
            expect(changes.get("prior-untracked.txt")).toMatchObject({ status: "untracked", dirtyBeforeRun: true })
            expect(changes.get("new.txt")).toMatchObject({
              status: "untracked",
              dirtyBeforeRun: false,
              content: "redacted",
            })
            expect(changes.get("staged.txt")).toMatchObject({ status: "added", content: "complete" })
            expect(changes.get("delete.txt")).toMatchObject({ status: "deleted" })
            expect(changes.get("renamed.txt")).toMatchObject({ status: "renamed", previousPath: "rename.txt" })
            expect(changes.get("blob.bin")).toMatchObject({ status: "binary", content: "binary" })
            expect(changes.get("large.txt")).toMatchObject({ status: "oversized", content: "oversized" })
            expect(changes.get("medium.txt")).toMatchObject({ content: "truncated" })
            expect(changes.get("medium.txt")?.patch).toBeUndefined()
            expect(JSON.stringify(report)).not.toContain(".env.local")
            expect(JSON.stringify(report)).not.toContain("host-link.txt")
            expect(JSON.stringify(report)).not.toContain("SECRET")
            expect(JSON.stringify(report)).not.toContain(tmp.path)
            const finalTree = (yield* Effect.promise(() =>
              $`git --git-dir=${shadow} ls-tree -r --name-only ${report.final}`.quiet(),
            )).text()
            expect(finalTree).not.toContain(".env.local")
            expect(finalTree).not.toContain("host-link.txt")
            expect(report.state).toBe("truncated")
            expect(report.excludedCount).toBeGreaterThan(0)
            expect(report.activity).toEqual([])
            expect(report.scopes.beforeRun.changed.map((item) => item.path)).toContain("committed.txt")
            expect(report.scopes.beforeRun.changed.map((item) => item.path)).toContain("dirty.txt")
            expect(report.scopes.overall.changed.map((item) => item.path)).toContain("committed.txt")
            expect((yield* Effect.promise(() => $`git diff --cached --name-only`.cwd(directory).quiet())).text()).toBe(
              "staged.txt\n",
            )
            expect((yield* Effect.promise(() => $`git rev-parse HEAD`.cwd(directory).quiet())).text().trim()).toBe(
              baseline.head ?? "",
            )
          }),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      ),
    20_000,
  )

  it.live("rejects a baseline from another Thread and workspace", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const first = path.join(tmp.path, "first")
          const second = path.join(tmp.path, "second")
          yield* Effect.promise(async () => {
            await fs.mkdir(first)
            await fs.mkdir(second)
            for (const directory of [first, second]) {
              await $`git init`.cwd(directory).quiet()
              await $`git config user.name Test`.cwd(directory).quiet()
              await $`git config user.email test@example.com`.cwd(directory).quiet()
              await fs.writeFile(path.join(directory, "file.txt"), "one\n")
              await $`git add .`.cwd(directory).quiet()
              await $`git commit -m initial`.cwd(directory).quiet()
            }
          })
          const artifacts = RunnerArtifacts.make({
            git: yield* Git.Service,
            process: yield* AppProcess.Service,
            policy: policy(),
            dataDirectory: path.join(tmp.path, "opencode-data"),
          })
          const baseline = yield* artifacts.baseline(run(first, "thread-a", "run-a"))
          const error = yield* artifacts
            .collect({ execution: run(second, "thread-b", "run-b"), baseline })
            .pipe(Effect.flip)
          expect(error).toEqual({ code: "forbidden", message: "Artifact baseline belongs to another Run or workspace" })
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
})

function run(directory: string, thread: string, id: string): LocalExecution {
  const projectId = Coordination.ProjectID.make("project")
  const threadId = Coordination.ThreadID.make(thread)
  const sessionId = Session.ID.make(`session-${thread}`)
  return {
    run: {
      command: {
        runId: Coordination.RunID.make(id),
        threadId,
        sessionId,
        executionOwner: { workerId: Coordination.WorkerID.make("worker"), instanceId: "instance" },
        runnerMessageId: `message-${id}`,
        text: "test",
      },
      projectId,
      attempt: 0,
      session: {
        id: sessionId,
        projectID: projectId,
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
        title: "test",
        location: { directory: AbsolutePath.make(directory) },
      },
    },
    phase: "prepared",
    workspace: { id: `workspace-${thread}`, threadId, projectId, directory },
  }
}

function policy(): SecurityPolicy {
  return {
    workspace: () => Effect.void,
    runtimeAccess: () => Effect.void,
    toolEnvironment: () => Effect.succeed({}),
    artifact: ({ path: file }) => Effect.succeed(path.basename(file).startsWith(".env") ? undefined : {}),
    redact: (text) => text.replaceAll("SECRET", "[REDACTED]"),
  }
}
