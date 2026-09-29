import { describe, expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Stream } from "effect"
import { eq } from "drizzle-orm"
import { Coordination } from "@opencode-ai/schema/coordination"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Database } from "@opencode-ai/core/database/database"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import accessMigration from "@opencode-ai/core/database/migration/20260929190010_coordination_access"
import { EventV2 } from "@opencode-ai/core/event"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { CoordinationAccess } from "@opencode-ai/core/coordination/access/index"
import { CoordinationEvents } from "@opencode-ai/core/coordination/events/events"
import { MembershipTable, SharedProjectTable } from "@opencode-ai/core/coordination/projects/sql"
import { ThreadTable } from "@opencode-ai/core/coordination/threads/sql"
import { testEffect } from "../../lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, CoordinationEvents.node])))

describe("coordination events with real thread storage and access", () => {
  it.effect("replays for members and stops an open stream after membership revocation", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* DatabaseMigration.applyOnly(db, [accessMigration])
      const journal = yield* CoordinationEvents.Service
      const now = Date.now()
      const projectId = Coordination.ProjectID.make(`prj_${crypto.randomUUID()}`)
      const threadId = Coordination.ThreadID.make(`thr_${crypto.randomUUID()}`)
      const sessionId = Coordination.Thread.fields.sessionId.make(`ses_${crypto.randomUUID()}`)
      const alice = { kind: "member" as const, userId: Coordination.UserID.make(`usr_${crypto.randomUUID()}`) }
      const outsider = { kind: "member" as const, userId: Coordination.UserID.make(`usr_${crypto.randomUUID()}`) }

      yield* db
        .insert(ProjectTable)
        .values({
          id: projectId,
          worktree: AbsolutePath.make("/tmp/coordination-events-test"),
          sandboxes: [],
          time_created: now,
          time_updated: now,
        })
        .run()
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionId,
          project_id: projectId,
          slug: "coordination-events-test",
          directory: "/tmp/coordination-events-test",
          title: "Shared test thread",
          version: "test",
          time_created: now,
          time_updated: now,
        })
        .run()
      yield* db
        .insert(SharedProjectTable)
        .values({
          id: projectId,
          name: "Shared test project",
          created_by: alice.userId,
          created_at: now,
          request_id: threadId,
        })
        .run()
      yield* db
        .insert(MembershipTable)
        .values({ project_id: projectId, user_id: alice.userId, role: "owner", joined_at: now })
        .run()
      yield* db
        .insert(ThreadTable)
        .values({
          id: threadId,
          project_id: projectId,
          session_id: sessionId,
          worker_id: Coordination.WorkerID.make(`wrk_${crypto.randomUUID()}`),
          title: "Shared test thread",
          created_by: alice.userId,
          created_at: now,
          activity_seq: -1,
          request_id: threadId,
        })
        .run()

      const access = CoordinationAccess.make(db)
      const first = yield* journal.append(
        {
          projectId,
          threadId,
          kind: "run.tool",
          occurredAt: new Date(now).toISOString(),
          payload: { status: "started" },
        },
        () => Effect.void,
      )
      expect(
        (yield* db
          .select({ seq: ThreadTable.activity_seq })
          .from(ThreadTable)
          .where(eq(ThreadTable.id, threadId))
          .get())?.seq,
      ).toBe(first.seq)
      const page = yield* CoordinationEvents.authorizedReplayThread(access, journal, alice, threadId, -1, 10)
      expect(page.events).toEqual([first])

      const deniedThread = yield* CoordinationEvents.authorizedSubscribeThread(
        access,
        journal,
        outsider,
        threadId,
        -1,
      ).pipe(Effect.flip)
      expect(deniedThread.code).toBe("forbidden")
      const deniedProject = yield* CoordinationEvents.authorizedSubscribeProject(
        access,
        journal,
        outsider,
        projectId,
        -1,
      ).pipe(Effect.flip)
      expect(deniedProject.code).toBe("forbidden")

      const live = yield* CoordinationEvents.authorizedSubscribeThread(access, journal, alice, threadId, first.seq)
      const seen: Coordination.Event[] = []
      const firstSeen = yield* Deferred.make<void>()
      const observer = yield* live.pipe(
        Stream.take(2),
        Stream.runForEach((event) =>
          Effect.sync(() => seen.push(event)).pipe(
            Effect.andThen(Deferred.succeed(firstSeen, undefined)),
            Effect.asVoid,
          ),
        ),
        Effect.exit,
        Effect.forkScoped,
      )
      const second = yield* journal.append(
        {
          projectId,
          threadId,
          kind: "run.output",
          occurredAt: new Date(now + 1).toISOString(),
          payload: { status: "finished" },
        },
        () => Effect.void,
      )
      yield* Deferred.await(firstSeen)
      expect(
        (yield* db
          .select({ seq: ThreadTable.activity_seq })
          .from(ThreadTable)
          .where(eq(ThreadTable.id, threadId))
          .get())?.seq,
      ).toBe(second.seq)
      yield* db.delete(MembershipTable).where(eq(MembershipTable.project_id, projectId)).run()
      const third = yield* journal.append(
        {
          projectId,
          threadId,
          kind: "run.tool",
          occurredAt: new Date(now + 2).toISOString(),
          payload: { status: "after revocation" },
        },
        () => Effect.void,
      )
      expect(Exit.isFailure(yield* Fiber.join(observer))).toBe(true)
      expect(seen).toEqual([second])
      yield* journal.append(
        { projectId, threadId, kind: "work-card.updated", occurredAt: new Date(now + 3).toISOString(), payload: {} },
        () => Effect.void,
      )
      expect(
        (yield* db
          .select({ seq: ThreadTable.activity_seq })
          .from(ThreadTable)
          .where(eq(ThreadTable.id, threadId))
          .get())?.seq,
      ).toBe(third.seq)
    }),
  )
})
