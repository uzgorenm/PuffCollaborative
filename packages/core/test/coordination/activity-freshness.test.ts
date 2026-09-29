import { expect, test } from "bun:test"
import path from "node:path"
import { Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Coordination } from "@opencode-ai/schema/coordination"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Database } from "@opencode-ai/core/database/database"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import accessMigration from "@opencode-ai/core/database/migration/20260929190010_coordination_access"
import cardMigration from "@opencode-ai/core/database/migration/20260929190020_coordination_work_card"
import queueMigration from "@opencode-ai/core/database/migration/20260929193000_coordination_queue"
import { EventV2 } from "@opencode-ai/core/event"
import { CoordinationAccess } from "../../src/coordination/access"
import { CoordinationEvents } from "@opencode-ai/core/coordination/events/events"
import { CoordinationQueue } from "@opencode-ai/core/coordination/queue/queue"
import { SharedProjectTable, MembershipTable } from "@opencode-ai/core/coordination/projects/sql"
import { ThreadTable } from "@opencode-ai/core/coordination/threads/sql"
import { WorkCard } from "@opencode-ai/core/coordination/work-card/work-card"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { tmpdir } from "../fixture/tmpdir"

test("runner content advances Thread.activitySeq atomically while lifecycle, replay and card projection do not", async () => {
  await using tmp = await tmpdir()
  const layer = Layer.provideMerge(
    CoordinationEvents.layerWith(),
    Layer.provideMerge(EventV2.layerWith(), Database.layerFromPath(path.join(tmp.path, "activity.sqlite"))),
  )
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      yield* DatabaseMigration.apply(db)
      yield* DatabaseMigration.applyOnly(db, [accessMigration, cardMigration, queueMigration])
      const events = yield* CoordinationEvents.Service
      const access = CoordinationAccess.make(db)
      const projectId = Coordination.ProjectID.make("prj_activity_freshness")
      const threadId = Coordination.ThreadID.make("thr_activity_freshness")
      const userId = Coordination.UserID.make("usr_activity_freshness")
      const workerId = Coordination.WorkerID.make("wrk_activity_freshness")
      const sessionId = Coordination.Thread.fields.sessionId.make("ses_activity_freshness")
      const member = { kind: "member" as const, userId }
      const runner = { kind: "runner" as const, workerId, instanceId: "runner_1" }
      const analysis = { kind: "analysis" as const, serviceId: "analysis_1" }
      const time = Date.now()
      yield* db.insert(ProjectTable).values({
        id: projectId, worktree: AbsolutePath.make(tmp.path), sandboxes: [], time_created: time, time_updated: time,
      }).run()
      yield* db.insert(SessionTable).values({
        id: sessionId, project_id: projectId, slug: "freshness", directory: tmp.path,
        title: "Freshness", version: "test", time_created: time, time_updated: time,
      }).run()
      yield* db.insert(SharedProjectTable).values({
        id: projectId, name: "Freshness", created_by: userId, created_at: time, request_id: "project",
      }).run()
      yield* db.insert(MembershipTable).values({
        project_id: projectId, user_id: userId, role: "owner", joined_at: time,
      }).run()
      yield* db.insert(ThreadTable).values({
        id: threadId, project_id: projectId, session_id: sessionId, worker_id: workerId,
        title: "Freshness", created_by: userId, created_at: time, activity_seq: 0, request_id: "thread",
      }).run()

      const revision = () => db.select({ seq: ThreadTable.activity_seq }).from(ThreadTable)
        .where(eq(ThreadTable.id, threadId)).get().pipe(Effect.map((row) => row!.seq))
      const queue = CoordinationQueue.make({ db, access, events, now: () => time })
      const cards = yield* WorkCard.make({ access, events, projectMembers: () => Effect.succeed([userId]) })
      const accepted = yield* queue.submit({ principal: member, threadId, requestId: "work", text: "Generate output" })
      const claimed = yield* queue.reserveNext({
        principal: runner, threadId, executionOwner: { workerId, instanceId: runner.instanceId },
        leaseUntil: new Date(time + 10_000).toISOString(),
      })
      expect(claimed?.run.id).toBe(accepted.run.id)
      yield* queue.transition({ principal: runner, runId: accepted.run.id, callbackId: "start", callback: {
        kind: "state", expectedState: "reserved", nextState: "running",
      } })
      expect(yield* revision()).toBe(0)

      const output = { kind: "activity" as const, state: "running" as const,
        activity: { kind: "run.output" as const, text: "Verified output" } }
      yield* queue.transition({ principal: runner, runId: accepted.run.id, callbackId: "output", callback: output })
      const outputEvent = (yield* events.replayThread(threadId, -1, 20)).events.find((event) => event.kind === "run.output")!
      expect(yield* revision()).toBe(outputEvent.seq)
      const count = (yield* events.replayThread(threadId, -1, 20)).events.length
      yield* queue.transition({ principal: runner, runId: accepted.run.id, callbackId: "output", callback: output })
      expect((yield* events.replayThread(threadId, -1, 20)).events).toHaveLength(count)
      expect(yield* revision()).toBe(outputEvent.seq)

      const card = {
        currentTask: "Summarize runner output", progress: "Verified output", blockers: [],
        status: "active" as const, summaryJobId: "job_1", recentVerifiedOutcome: "Output recorded",
        contributors: [userId], evidenceRefs: [{ threadId, eventId: outputEvent.id, seq: outputEvent.seq }],
        generatedAt: new Date(time).toISOString(),
      }
      expect((yield* cards.update({ principal: analysis, threadId, expectedVersion: 0,
        sourceActivitySeq: 0, card }).pipe(Effect.flip)).code).toBe("conflict")
      expect((yield* cards.update({ principal: analysis, threadId, expectedVersion: 0,
        sourceActivitySeq: outputEvent.seq, card })).version).toBe(1)
      expect(yield* revision()).toBe(outputEvent.seq)

      for (const [callbackId, activity] of [
        ["tool", { kind: "run.tool", toolName: "read", status: "completed", summary: "Read source" }],
        ["workspace", { kind: "run.workspace", workspaceId: "ws_1", ref: "checkpoint_1" }],
        ["diff", { kind: "run.diff", ref: "diff_1", summary: "Changed a file" }],
      ] as const) {
        yield* queue.transition({ principal: runner, runId: accepted.run.id, callbackId, callback: {
          kind: "activity", state: "running", activity,
        } })
        const event = (yield* events.replayThread(threadId, -1, 20)).events.at(-1)!
        expect(event.kind).toBe(activity.kind)
        expect(yield* revision()).toBe(event.seq)
      }
      const latestActivity = yield* revision()
      expect((yield* cards.update({ principal: analysis, threadId, expectedVersion: 1,
        sourceActivitySeq: outputEvent.seq, card }).pipe(Effect.flip)).code).toBe("conflict")

      yield* queue.transition({ principal: runner, runId: accepted.run.id, callbackId: "complete", callback: {
        kind: "state", expectedState: "running", nextState: "completed",
      } })
      expect(yield* revision()).toBe(latestActivity)
      yield* queue.transition({ principal: runner, runId: accepted.run.id, callbackId: "complete", callback: {
        kind: "state", expectedState: "running", nextState: "completed",
      } })
      expect(yield* revision()).toBe(latestActivity)
    }).pipe(Effect.provide(layer), Effect.scoped),
  )
})
