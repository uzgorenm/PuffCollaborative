import { expect, test } from "bun:test"
import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { Effect, Layer } from "effect"
import { Coordination } from "@opencode-ai/schema/coordination"
import { Model } from "@opencode-ai/schema/model"
import { Provider } from "@opencode-ai/schema/provider"
import { Database } from "../../../src/database/database"
import { DatabaseMigration } from "../../../src/database/migration"
import { AppNodeBuilder } from "../../../src/effect/app-node-builder"
import { makeGlobalNode } from "../../../src/effect/app-node"
import { LayerNode } from "../../../src/effect/layer-node"
import { EventV2 } from "../../../src/event"
import { ProjectV2 } from "../../../src/project"
import { AbsolutePath } from "../../../src/schema"
import { SessionV2 } from "../../../src/session"
import { SessionExecution } from "../../../src/session/execution"
import { EffectFlock } from "../../../src/util/effect-flock"
import { CoordinationAccess } from "../../../src/coordination/access"
import { CoordinationEvents } from "../../../src/coordination/events/events"
import { CoordinationProjects } from "../../../src/coordination/projects"
import { CoordinationQueue } from "../../../src/coordination/queue/queue"
import { CoordinationProvisioning } from "../../../src/coordination/provisioning"
import provisioningMigration from "../../../src/database/migration/20260929233322_coordination_provisioning"
import { tmpdir } from "../../fixture/tmpdir"

const exec = promisify(execFile)
const alice = Coordination.UserID.make("usr_provision_alice")
const bob = Coordination.UserID.make("usr_provision_bob")
const stranger = Coordination.UserID.make("usr_provision_stranger")
const owner = { kind: "member" as const, userId: alice }
const worker = { workerId: Coordination.WorkerID.make("wrk_provision"), instanceId: "provision-local" }
const model = Model.Ref.make({ providerID: Provider.ID.make("fixture"), id: Model.ID.make("fixture-model") })

async function git(cwd: string, ...args: string[]) {
  return (await exec("git", args, { cwd, encoding: "utf8" })).stdout.trim()
}

async function repository(root: string) {
  const directory = path.join(root, "source")
  await fs.mkdir(directory)
  await git(directory, "init", "-q")
  await git(directory, "config", "user.name", "Provision Test")
  await git(directory, "config", "user.email", "provision@example.test")
  await fs.writeFile(path.join(directory, "shared.txt"), "base\n")
  await git(directory, "add", "shared.txt")
  await git(directory, "commit", "-qm", "base")
  return { directory, revision: await git(directory, "rev-parse", "HEAD") }
}

async function withServices<A>(
  root: string,
  source: Awaited<ReturnType<typeof repository>>,
  ready: boolean,
  body: (input: {
    service: CoordinationProvisioning.Interface
    projects: ReturnType<typeof CoordinationProjects.make>
    sessions: SessionV2.Interface
    projectId: Coordination.ProjectID
    db: Database.Interface["db"]
  }) => Effect.Effect<A, unknown>,
  crashBeforeSession = false,
  providerConfigPath?: string,
) {
  const database = makeGlobalNode({
    service: Database.Service,
    layer: Database.layerFromPath(path.join(root, "provision.sqlite")),
    deps: [],
  })
  const layer = AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionV2.node,
      ProjectV2.node,
      EffectFlock.node,
      CoordinationEvents.node,
    ]),
    [
      [Database.node, database],
      [SessionExecution.node, SessionExecution.noopLayer],
    ],
  )
  return Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      yield* DatabaseMigration.applyOnly(db, [provisioningMigration])
      const project = yield* ProjectV2.Service
      const sessions = yield* SessionV2.Service
      const flock = yield* EffectFlock.Service
      const events = yield* CoordinationEvents.Service
      const access = CoordinationAccess.make(db)
      const queue = CoordinationQueue.make({ db, access, events })
      const projectId = (yield* project.resolve(AbsolutePath.make(source.directory))).id
      const admission = {
        canShareExistingProject: (userId: Coordination.UserID, id: Coordination.ProjectID) =>
          Effect.succeed(id === projectId && [alice, bob].includes(userId)),
      }
      const selection = CoordinationProvisioning.selection(db)
      const projects = CoordinationProjects.make({
        db,
        access,
        events,
        queue,
        projectAdmission: admission,
        sessionSelection: selection,
        members: { hasMember: (id) => [alice, bob].includes(id) },
        sessionBinding: {
          resolve: (id) =>
            sessions.get(id).pipe(
              Effect.map((item) => ({ projectId: item.projectID, workerId: worker.workerId })),
              Effect.mapError(() => ({ code: "not_found" as const, message: "Session absent" })),
            ),
        },
      })
      const service = CoordinationProvisioning.make({
        db,
        project,
        sessions: crashBeforeSession
          ? {
              get: sessions.get,
              create: () =>
                Effect.sync(() => {
                  throw new Error("Simulated provisioning process crash")
                }),
            }
          : sessions,
        flock,
        projects,
        access,
        admission,
        ready: () => Effect.succeed(ready),
        config: {
          workspaceRoot: path.join(root, "workspaces"),
          worker,
          model,
          providerConfigPath,
          projects: [
            {
              name: "Approved",
              repositoryRoot: source.directory,
              baseRevision: source.revision,
              allowedUsers: [alice, bob],
            },
          ],
        },
      })
      return yield* body({ service, projects, sessions, projectId, db })
    }).pipe(Effect.provide(layer), Effect.scoped),
  )
}

test("real Session and Git provisioning survives restart, isolates worktrees and attributes owner selections", async () => {
  await using tmp = await tmpdir()
  const source = await repository(tmp.path)
  const first = await withServices(tmp.path, source, true, ({ service, projects, projectId, sessions, db }) =>
    Effect.gen(function* () {
      const listing = yield* service.list(owner)
      expect(listing).toEqual({ projects: [{ projectId, name: "Approved", modelReady: true }], privateSessions: false })
      yield* projects.create({ auth: owner, projectId, name: "Approved", requestId: "share-project" })
      yield* projects.grantMember({ auth: owner, projectId, targetUserId: bob, requestId: "join-bob" })
      const duplicates = yield* Effect.all(
        [
          service.provision({ principal: owner, projectId, requestId: "alice-one", title: "Alice task" }),
          service.provision({ principal: owner, projectId, requestId: "alice-one", title: "Alice task" }),
        ],
        { concurrency: 2 },
      )
      expect(duplicates[0]).toEqual(duplicates[1])
      const created = duplicates[0]
      const independent = yield* service.provision({
        principal: { kind: "member", userId: bob },
        projectId,
        requestId: "bob-one",
        title: "Bob task",
      })
      expect(created.ownerUserId).toBe(alice)
      expect(created.thread.createdBy).toBe(alice)
      expect(independent.ownerUserId).toBe(bob)
      expect(yield* CoordinationProvisioning.ownerOf(db, created.thread)).toBe(alice)
      expect(created.directory).not.toBe(independent.directory)
      expect(created.workspaceId).not.toBe(independent.workspaceId)
      expect((yield* sessions.get(created.sessionId)).location.directory).toBe(AbsolutePath.make(created.directory))
      expect((yield* sessions.get(created.sessionId)).model).toMatchObject(model)
      yield* Effect.promise(() => fs.writeFile(path.join(String(created.directory), "shared.txt"), "Alice only\n"))
      expect(yield* Effect.promise(() => fs.readFile(path.join(independent.directory, "shared.txt"), "utf8"))).toBe(
        "base\n",
      )
      expect(
        yield* CoordinationProvisioning.selection(db).canShareSession(
          bob,
          projectId,
          created.sessionId,
          worker.workerId,
        ),
      ).toBe(false)
      return created
    }),
  )
  await withServices(tmp.path, source, false, ({ service, projectId }) =>
    Effect.gen(function* () {
      expect(
        yield* service.provision({ principal: owner, projectId, requestId: "alice-one", title: "Alice task" }),
      ).toEqual(first)
      expect(
        (yield* service
          .provision({ principal: owner, projectId, requestId: "alice-one", title: "Changed" })
          .pipe(Effect.flip)).code,
      ).toBe("conflict")
      expect(yield* Effect.promise(() => fs.readFile(path.join(first.directory, "shared.txt"), "utf8"))).toBe(
        "Alice only\n",
      )
    }),
  )
})

test("a crash between worktree creation and Session creation resumes the durable reservation", async () => {
  await using tmp = await tmpdir()
  const source = await repository(tmp.path)
  await withServices(
    tmp.path,
    source,
    true,
    ({ service, projects, projectId }) =>
      Effect.gen(function* () {
        yield* service.list(owner)
        yield* projects.create({ auth: owner, projectId, name: "Approved", requestId: "share-project" })
        expect(
          (yield* service
            .provision({ principal: owner, projectId, requestId: "interrupted", title: "Resume task" })
            .pipe(Effect.exit))._tag,
        ).toBe("Failure")
      }),
    true,
  )
  await withServices(tmp.path, source, true, ({ service, sessions, projectId }) =>
    Effect.gen(function* () {
      const resumed = yield* service.provision({
        principal: owner,
        projectId,
        requestId: "interrupted",
        title: "Resume task",
      })
      expect(yield* sessions.list()).toHaveLength(1)
      expect(resumed.thread.createdBy).toBe(alice)
      const worktrees = yield* Effect.promise(() => git(source.directory, "worktree", "list", "--porcelain"))
      expect(worktrees.split("\n").filter((line) => line.startsWith("worktree "))).toHaveLength(2)
    }),
  )
})

test("provider configuration replaces repository symlinks without writing outside its worktree", async () => {
  await using tmp = await tmpdir()
  const source = await repository(tmp.path)
  const outside = path.join(tmp.path, "outside.json")
  const providerConfigPath = path.join(tmp.path, "provider.json")
  await fs.writeFile(outside, "outside must remain unchanged")
  await fs.writeFile(providerConfigPath, "{}")
  await fs.symlink(outside, path.join(source.directory, "opencode.json"))
  await git(source.directory, "add", "opencode.json")
  await git(source.directory, "commit", "-qm", "repository configuration symlink")
  source.revision = await git(source.directory, "rev-parse", "HEAD")
  await withServices(
    tmp.path,
    source,
    true,
    ({ service, projects, projectId }) =>
      Effect.gen(function* () {
        yield* service.list(owner)
        yield* projects.create({ auth: owner, projectId, name: "Approved", requestId: "share-project" })
        const created = yield* service.provision({
          principal: owner,
          projectId,
          requestId: "safe-config",
          title: "Safe configuration",
        })
        expect(yield* Effect.promise(() => fs.readFile(outside, "utf8"))).toBe("outside must remain unchanged")
        const copied = path.join(created.directory, "opencode.json")
        expect(yield* Effect.promise(() => fs.readFile(copied, "utf8"))).toBe("{}")
        const metadata = yield* Effect.promise(() => fs.lstat(copied))
        expect(metadata.isSymbolicLink()).toBe(false)
        expect(metadata.mode & 0o777).toBe(0o600)
      }),
    false,
    providerConfigPath,
  )
})

test("admission, credential type and model readiness fail closed before creating worktrees", async () => {
  await using tmp = await tmpdir()
  const source = await repository(tmp.path)
  await withServices(tmp.path, source, false, ({ service, projects, projectId }) =>
    Effect.gen(function* () {
      expect((yield* service.list({ kind: "runner", ...worker }).pipe(Effect.flip)).code).toBe("forbidden")
      expect((yield* service.list({ kind: "member", userId: stranger })).projects).toEqual([])
      yield* service.list(owner)
      yield* projects.create({ auth: owner, projectId, name: "Approved", requestId: "share-project" })
      expect(
        (yield* service
          .provision({ principal: { kind: "member", userId: stranger }, projectId, requestId: "bad", title: "Denied" })
          .pipe(Effect.flip)).code,
      ).toBe("forbidden")
      expect(
        (yield* service
          .provision({ principal: owner, projectId, requestId: "no-model", title: "Unavailable" })
          .pipe(Effect.flip)).code,
      ).toBe("unavailable")
      expect(
        (yield* service
          .provision({ principal: owner, projectId, requestId: "../escape", title: "Invalid" })
          .pipe(Effect.flip)).code,
      ).toBe("invalid")
      expect(
        yield* Effect.promise(() =>
          fs.access(path.join(tmp.path, "workspaces")).then(
            () => true,
            () => false,
          ),
        ),
      ).toBe(false)
    }),
  )
})
