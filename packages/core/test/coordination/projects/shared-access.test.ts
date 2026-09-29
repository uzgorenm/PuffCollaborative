import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { Coordination } from "@opencode-ai/schema/coordination"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import accessMigration from "@opencode-ai/core/database/migration/20260929190010_coordination_access"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { CoordinationAccess } from "../../../src/coordination/access"
import { CoordinationComments } from "../../../src/coordination/comments"
import { CoordinationProjects } from "../../../src/coordination/projects"
import type { CoordinationContracts } from "@opencode-ai/core/coordination/contracts"

const alice = { kind: "member", userId: Coordination.UserID.make("usr_alice") } as const
const bob = { kind: "member", userId: Coordination.UserID.make("usr_bob") } as const
const eve = { kind: "member", userId: Coordination.UserID.make("usr_eve") } as const
const mallory = { kind: "member", userId: Coordination.UserID.make("usr_mallory") } as const
const projectId = Coordination.ProjectID.make("prj_shared_fixture")
const unsharedProjectId = Coordination.ProjectID.make("prj_unshared_fixture")
const sessionId = Coordination.Thread.fields.sessionId.make("ses_shared_fixture")
const unselectedSessionId = Coordination.Thread.fields.sessionId.make("ses_unselected_fixture")
const otherProjectSessionId = Coordination.Thread.fields.sessionId.make("ses_other_project_fixture")
const workerId = Coordination.WorkerID.make("worker_fixture")
const makeDb = EffectDrizzleSqlite.makeWithDefaults()

const assertFailure = (
  effect: Effect.Effect<unknown, CoordinationContracts.Failure>,
  code: CoordinationContracts.ErrorCode,
) =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(effect)
    expect(Exit.isFailure(result)).toBe(true)
    if (Exit.isFailure(result)) {
      const reason = result.cause.reasons[0]
      expect(reason?._tag).toBe("Fail")
      if (reason?._tag === "Fail") expect(reason.error.code).toBe(code)
    }
  })
const assertForbidden = (effect: Effect.Effect<unknown, CoordinationContracts.Failure>) =>
  assertFailure(effect, "forbidden")

describe("shared project access with mocked event, queue, project admission and session binding adapters", () => {
  test("two members share one thread; comments carry authenticated authorship without a run", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* DatabaseMigration.apply(db)
        yield* DatabaseMigration.applyOnly(db, [accessMigration])
        const now = Date.now()
        yield* db
          .insert(ProjectTable)
          .values({
            id: projectId,
            worktree: AbsolutePath.make("/tmp/coordination-shared-fixture"),
            sandboxes: [],
            time_created: now,
            time_updated: now,
          })
          .run()
        yield* db
          .insert(ProjectTable)
          .values({
            id: unsharedProjectId,
            worktree: AbsolutePath.make("/tmp/coordination-unshared-fixture"),
            sandboxes: [],
            time_created: now,
            time_updated: now,
          })
          .run()
        yield* db
          .insert(SessionTable)
          .values([
            {
              id: sessionId,
              project_id: projectId,
              slug: "shared-fixture",
              directory: "/tmp/coordination-shared-fixture",
              title: "Shared fixture",
              version: "test",
              time_created: now,
              time_updated: now,
            },
            {
              id: unselectedSessionId,
              project_id: projectId,
              slug: "unselected-fixture",
              directory: "/tmp/coordination-shared-fixture",
              title: "Unselected fixture",
              version: "test",
              time_created: now,
              time_updated: now,
            },
            {
              id: otherProjectSessionId,
              project_id: unsharedProjectId,
              slug: "other-project-fixture",
              directory: "/tmp/coordination-unshared-fixture",
              title: "Other project fixture",
              version: "test",
              time_created: now,
              time_updated: now,
            },
          ])
          .run()

        const events: Coordination.Event[] = []
        const append: CoordinationContracts.Events["append"] = (input, commit) =>
          Effect.gen(function* () {
            const seq = events.filter((event) => event.projectId === input.projectId).length
            yield* db.transaction(() => commit(seq)).pipe(Effect.orDie)
            const event: Coordination.Event = { ...input, id: `evt_fixture_${seq}`, seq }
            events.push(event)
            return event
          })
        let instructionReads = 0
        const queue: Pick<CoordinationContracts.Queue, "instructions"> = {
          instructions: () => {
            instructionReads++
            return Effect.succeed([])
          },
        }
        const access = CoordinationAccess.make(db)
        const projectAdmission = {
          canShareExistingProject: (userId: Coordination.UserID, requestedProjectId: Coordination.ProjectID) =>
            Effect.succeed(userId === alice.userId || (userId === mallory.userId && requestedProjectId === projectId)),
        }
        const sessionBinding = { resolve: () => Effect.succeed({ projectId, workerId }) }
        const sessionSelection = {
          canShareSession: (
            userId: Coordination.UserID,
            selectedProjectId: Coordination.ProjectID,
            selectedSessionId: Coordination.Thread["sessionId"],
            selectedWorkerId: Coordination.WorkerID,
          ) =>
            Effect.succeed(
              userId === alice.userId &&
                selectedProjectId === projectId &&
                selectedSessionId === sessionId &&
                selectedWorkerId === workerId,
            ),
        }
        const members = {
          hasMember: (userId: Coordination.UserID) => [alice.userId, bob.userId, eve.userId].includes(userId),
        }
        const projects = CoordinationProjects.make({
          db,
          access,
          events: { append },
          queue,
          projectAdmission,
          sessionBinding,
          sessionSelection,
          members,
        })
        const comments = CoordinationComments.make({ db, access, events: { append } })

        const shared = yield* projects.create({
          auth: alice,
          projectId,
          name: "Shared fixture",
          requestId: "create-project",
        })
        expect(
          yield* projects.create({ auth: alice, projectId, name: "Shared fixture", requestId: "create-project" }),
        ).toEqual(shared)
        yield* assertFailure(
          projects.create({
            auth: alice,
            projectId,
            name: "Changed name",
            requestId: "create-project",
          }),
          "conflict",
        )
        yield* assertForbidden(
          projects.create({
            auth: eve,
            projectId: unsharedProjectId,
            name: "Claimed without access",
            requestId: "claim-project",
          }),
        )
        yield* assertForbidden(
          projects.create({
            auth: mallory,
            projectId,
            name: "Probe existing shared project",
            requestId: "probe-shared-project",
          }),
        )
        yield* assertForbidden(
          projects.create({
            auth: eve,
            projectId: Coordination.ProjectID.make("prj_unknown_fixture"),
            name: "Probe unknown project",
            requestId: "probe-project",
          }),
        )
        const membership = yield* projects.grantMember({
          auth: alice,
          projectId,
          targetUserId: bob.userId,
          requestId: "add-bob",
        })
        expect(
          yield* projects.grantMember({ auth: alice, projectId, targetUserId: bob.userId, requestId: "add-bob" }),
        ).toEqual(membership)
        yield* assertFailure(
          projects.grantMember({ auth: alice, projectId, targetUserId: eve.userId, requestId: "add-bob" }),
          "conflict",
        )
        yield* assertForbidden(
          projects.grantMember({ auth: bob, projectId, targetUserId: eve.userId, requestId: "bob-add-eve" }),
        )
        yield* assertFailure(
          projects.grantMember({
            auth: alice,
            projectId,
            targetUserId: Coordination.UserID.make("usr_unseeded"),
            requestId: "add-unknown",
          }),
          "not_found",
        )
        const projectsWithoutSelection = CoordinationProjects.make({
          db,
          access,
          events: { append },
          queue,
          projectAdmission,
          sessionBinding,
          members,
        })
        yield* assertForbidden(
          projectsWithoutSelection.createThread({
            auth: alice,
            projectId,
            sessionId,
            title: "No trusted selection source",
            requestId: "alice-share-without-selection",
          }),
        )
        yield* assertForbidden(
          projects.createThread({
            auth: bob,
            projectId,
            sessionId,
            title: "Unselected session",
            requestId: "bob-share-unselected",
          }),
        )
        yield* assertForbidden(
          projects.createThread({
            auth: alice,
            projectId,
            sessionId: unselectedSessionId,
            title: "Wrong Session grant",
            requestId: "alice-share-wrong-session",
          }),
        )
        yield* assertFailure(
          projects.createThread({
            auth: alice,
            projectId,
            sessionId: otherProjectSessionId,
            title: "Other project Session",
            requestId: "alice-share-other-project-session",
          }),
          "not_found",
        )
        expect(yield* projects.listThreads(alice, projectId)).toEqual([])
        expect(events.map((event) => event.kind)).toEqual(["project.created", "membership.changed"])
        const shareRequest = {
          auth: alice,
          projectId,
          sessionId,
          workerId: Coordination.WorkerID.make("worker_forged"),
          title: "Team thread",
          requestId: "share-session",
        }
        const thread = yield* projects.createThread(shareRequest)
        expect(thread.workerId).toBe(workerId)
        expect(
          yield* projects.createThread({
            auth: alice,
            projectId,
            sessionId,
            title: "Team thread",
            requestId: "share-session",
          }),
        ).toEqual(thread)
        yield* assertFailure(
          projects.createThread({
            auth: alice,
            projectId,
            sessionId,
            title: "Changed title",
            requestId: "share-session",
          }),
          "conflict",
        )

        expect((yield* projects.list(alice)).map((project) => project.id)).toEqual([projectId])
        expect((yield* projects.list(bob)).map((project) => project.id)).toEqual([projectId])
        expect((yield* projects.listThreads(bob, projectId)).map((item) => item.id)).toEqual([thread.id])
        expect((yield* access.getThread(bob, thread.id, "read")).sessionId).toBe(sessionId)
        yield* access.authorize(bob, projectId, thread.id, "cancel")
        yield* access.authorize(bob, projectId, thread.id, "approve")
        yield* access.authorize({ kind: "runner", workerId, instanceId: "runner-one" }, projectId, thread.id, "runner")
        yield* assertForbidden(
          access.authorize(
            {
              kind: "runner",
              workerId: Coordination.WorkerID.make("worker_forged"),
              instanceId: "runner-two",
            },
            projectId,
            thread.id,
            "runner",
          ),
        )
        yield* access.authorize({ kind: "analysis", serviceId: "flower" }, projectId, thread.id, "update_work_card")
        yield* assertForbidden(
          access.authorize({ kind: "analysis", serviceId: "flower" }, projectId, thread.id, "read"),
        )

        const spoofed = {
          auth: bob,
          threadId: thread.id,
          requestId: "comment-one",
          body: "The shared setup is ready.",
          authorId: eve.userId,
          projectId: Coordination.ProjectID.make("prj_fake"),
        }
        const comment = yield* comments.create(spoofed)
        expect(comment.authorId).toBe(bob.userId)
        expect((yield* comments.list(alice, thread.id)).map((item) => item.id)).toEqual([comment.id])
        expect((yield* projects.contributions(alice, projectId, bob.userId)).map((item) => item.sourceKind)).toEqual([
          "comment",
        ])
        expect(instructionReads).toBe(1)
        expect(events.map((event) => event.kind)).toEqual([
          "project.created",
          "membership.changed",
          "thread.created",
          "comment.created",
        ])
        expect(events.at(-1)?.actorId).toBe(bob.userId)
        expect((yield* access.getThread(alice, thread.id, "read")).activitySeq).toBe(3)
        expect(yield* comments.create(spoofed)).toEqual(comment)
        yield* assertFailure(comments.create({ ...spoofed, body: "Changed comment" }), "conflict")
        expect(events).toHaveLength(4)

        expect(yield* projects.list(eve)).toEqual([])
        yield* assertForbidden(projects.get(eve, projectId))
        yield* assertForbidden(projects.listThreads(eve, projectId))
        yield* assertForbidden(projects.contributions(eve, projectId))
        yield* assertForbidden(access.getThread(eve, thread.id, "read"))
        yield* assertForbidden(comments.list(eve, thread.id))
        yield* assertForbidden(comments.create({ auth: eve, threadId: thread.id, requestId: "evil", body: "No" }))
        yield* assertForbidden(
          projects.createThread({
            auth: eve,
            projectId,
            sessionId,
            title: "Hidden",
            requestId: "evil-share",
          }),
        )
      }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
    )
  })
})
