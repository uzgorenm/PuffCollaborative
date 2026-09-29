import { expect, test } from "bun:test"
import path from "node:path"
import { Cause, Effect, Exit, Layer } from "effect"
import { eq, sql } from "drizzle-orm"
import { Coordination } from "@opencode-ai/schema/coordination"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Database } from "@opencode-ai/core/database/database"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import accessMigration from "@opencode-ai/core/database/migration/20260929190010_coordination_access"
import { EventV2 } from "@opencode-ai/core/event"
import { CoordinationAccess } from "../../src/coordination/access"
import { CoordinationComments } from "../../src/coordination/comments"
import { CommentTable } from "@opencode-ai/core/coordination/comments/sql"
import { CoordinationEvents } from "@opencode-ai/core/coordination/events/events"
import { SharedProjectTable, MembershipTable } from "@opencode-ai/core/coordination/projects/sql"
import { ThreadTable } from "@opencode-ai/core/coordination/threads/sql"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { tmpdir } from "../fixture/tmpdir"

test("overlapping exact comments converge to one event; conflicting payload and unrelated DB error stay distinct", async () => {
  await using tmp = await tmpdir()
  const layer = Layer.provideMerge(
    CoordinationEvents.layerWith(),
    Layer.provideMerge(EventV2.layerWith(), Database.layerFromPath(path.join(tmp.path, "comments.sqlite"))),
  )
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      yield* DatabaseMigration.apply(db)
      yield* DatabaseMigration.applyOnly(db, [accessMigration])
      const events = yield* CoordinationEvents.Service
      const access = CoordinationAccess.make(db)
      const projectId = Coordination.ProjectID.make("prj_comment_retry")
      const threadId = Coordination.ThreadID.make("thr_comment_retry")
      const userId = Coordination.UserID.make("usr_comment_retry")
      const workerId = Coordination.WorkerID.make("wrk_comment_retry")
      const sessionId = Coordination.Thread.fields.sessionId.make("ses_comment_retry")
      const auth = { kind: "member" as const, userId }
      const time = Date.now()
      yield* db.insert(ProjectTable).values({
        id: projectId, worktree: AbsolutePath.make(tmp.path), sandboxes: [], time_created: time, time_updated: time,
      }).run()
      yield* db.insert(SessionTable).values({
        id: sessionId, project_id: projectId, slug: "retry", directory: tmp.path,
        title: "Retry", version: "test", time_created: time, time_updated: time,
      }).run()
      yield* db.insert(SharedProjectTable).values({
        id: projectId, name: "Retry", created_by: userId, created_at: time, request_id: "project",
      }).run()
      yield* db.insert(MembershipTable).values({
        project_id: projectId, user_id: userId, role: "owner", joined_at: time,
      }).run()
      yield* db.insert(ThreadTable).values({
        id: threadId, project_id: projectId, session_id: sessionId, worker_id: workerId,
        title: "Retry", created_by: userId, created_at: time, activity_seq: 0, request_id: "thread",
      }).run()

      let arrived = 0
      let release!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      const comments = CoordinationComments.make({
        db, access,
        events: { append: (input, project) => Effect.gen(function* () {
          arrived++
          if (arrived === 2) release()
          yield* Effect.promise(() => gate)
          return yield* events.append(input, project)
        }) },
      })
      const request = { auth, threadId, requestId: "same-request", body: "Same exact contribution" }
      const copies = yield* Effect.all([comments.create(request), comments.create(request)], { concurrency: "unbounded" })
      expect(arrived).toBe(2)
      expect(copies[0]).toEqual(copies[1])
      const rows = yield* db.select().from(CommentTable).where(eq(CommentTable.thread_id, threadId)).all()
      expect(rows).toHaveLength(1)
      const journal = (yield* events.replayThread(threadId, -1, 10)).events
      expect(journal.filter((event) => event.kind === "comment.created")).toHaveLength(1)
      expect((yield* access.getThread(auth, threadId, "read")).activitySeq).toBe(rows[0]!.event_seq)
      expect((yield* comments.create({ ...request, body: "Different contribution" }).pipe(Effect.flip)).code)
        .toBe("conflict")

      yield* db.run(sql`CREATE TRIGGER reject_comment_retry BEFORE INSERT ON coordination_comment
        BEGIN SELECT RAISE(ABORT, 'sentinel-db-failure'); END`)
      const failed = yield* Effect.exit(comments.create({ ...request, requestId: "db-failure" }))
      expect(Exit.isFailure(failed)).toBe(true)
      if (Exit.isFailure(failed)) expect(Cause.pretty(failed.cause)).toContain("sentinel-db-failure")
      expect((yield* events.replayThread(threadId, -1, 10)).events).toHaveLength(journal.length)
    }).pipe(Effect.provide(layer), Effect.scoped),
  )
})
