import { expect, test } from "bun:test"
import path from "node:path"
import { Effect, Layer } from "effect"
import { eq, sql } from "drizzle-orm"
import { Coordination } from "@opencode-ai/schema/coordination"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Database } from "@opencode-ai/core/database/database"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import accessMigration from "@opencode-ai/core/database/migration/20260929190010_coordination_access"
import approvalMigration from "@opencode-ai/core/database/migration/20260929190000_coordination_runner_approval"
import cardMigration from "@opencode-ai/core/database/migration/20260929190020_coordination_work_card"
import queueMigration from "@opencode-ai/core/database/migration/20260929193000_coordination_queue"
import { EventV2 } from "@opencode-ai/core/event"
import { CoordinationAccess } from "../../../src/coordination/access"
import { ApprovalTable } from "../../../src/coordination/approval/sql"
import { CoordinationEvents } from "../../../src/coordination/events/events"
import { CoordinationOverview } from "../../../src/coordination/overview"
import { SharedProjectTable, MembershipTable } from "../../../src/coordination/projects/sql"
import { InstructionTable, RunTable } from "../../../src/coordination/queue/sql"
import { ThreadTable } from "../../../src/coordination/threads/sql"
import { WorkCardTable } from "../../../src/coordination/work-card/sql"
import type { WorkCard } from "../../../src/coordination/work-card/work-card"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { tmpdir } from "../../fixture/tmpdir"

test("authorized project overview reports current work with exact evidence and only selected same-topic relations", async () => {
  await using tmp = await tmpdir()
  const layer = Layer.provideMerge(
    CoordinationEvents.layerWith(),
    Layer.provideMerge(EventV2.layerWith(), Database.layerFromPath(path.join(tmp.path, "overview.sqlite"))),
  )
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      yield* DatabaseMigration.apply(db)
      yield* DatabaseMigration.applyOnly(db, [approvalMigration, accessMigration, cardMigration, queueMigration])
      const events = yield* CoordinationEvents.Service
      const access = CoordinationAccess.make(db)
      const projectId = Coordination.ProjectID.make("prj_overview")
      const alice = Coordination.UserID.make("usr_alice_overview")
      const ben = Coordination.UserID.make("usr_ben_overview")
      const member = { kind: "member" as const, userId: alice }
      const time = Date.now()
      yield* db
        .insert(ProjectTable)
        .values({
          id: projectId,
          worktree: AbsolutePath.make(tmp.path),
          sandboxes: [],
          time_created: time,
          time_updated: time,
        })
        .run()
      yield* db
        .insert(SharedProjectTable)
        .values({
          id: projectId,
          name: "Navigation",
          created_by: alice,
          created_at: time,
          request_id: "project",
        })
        .run()
      yield* db
        .insert(MembershipTable)
        .values([
          { project_id: projectId, user_id: alice, role: "owner", joined_at: time },
          { project_id: projectId, user_id: ben, role: "member", joined_at: time },
        ])
        .run()
      const threads = ["a", "b", "c", "d"].map((suffix) => ({
        id: Coordination.ThreadID.make(`thr_overview_${suffix}`),
        sessionId: Coordination.Thread.fields.sessionId.make(`ses_overview_${suffix}`),
        workerId: Coordination.WorkerID.make(`wrk_overview_${suffix}`),
        createdBy: alice,
        title: suffix === "c" ? "Navigation through schema migrations" : `Navigation UI ${suffix}`,
      }))
      for (const thread of threads) {
        yield* db
          .insert(SessionTable)
          .values({
            id: thread.sessionId,
            project_id: projectId,
            slug: thread.id,
            directory: tmp.path,
            title: thread.title,
            version: "test",
            time_created: time,
            time_updated: time,
          })
          .run()
        yield* db
          .insert(ThreadTable)
          .values({
            id: thread.id,
            project_id: projectId,
            session_id: thread.sessionId,
            worker_id: thread.workerId,
            title: thread.title,
            created_by: thread.createdBy,
            created_at: time,
            activity_seq: 0,
            request_id: thread.id,
          })
          .run()
      }
      const privateSessionId = Coordination.Thread.fields.sessionId.make("ses_private_overview")
      yield* db
        .insert(SessionTable)
        .values({
          id: privateSessionId,
          project_id: projectId,
          slug: "private",
          directory: tmp.path,
          title: "Private investigation",
          version: "test",
          time_created: time,
          time_updated: time,
        })
        .run()
      const source = (threadId: Coordination.ThreadID) =>
        events.append(
          {
            projectId,
            threadId,
            kind: "run.output",
            occurredAt: new Date(time).toISOString(),
            payload: { text: "source-backed finding" },
          },
          (seq) =>
            db
              .update(ThreadTable)
              .set({ activity_seq: seq })
              .where(eq(ThreadTable.id, threadId))
              .run()
              .pipe(Effect.asVoid, Effect.orDie),
        )
      const eventA = yield* source(threads[0]!.id)
      const eventB = yield* source(threads[1]!.id)
      const eventD = yield* source(threads[3]!.id)
      const card = (threadId: Coordination.ThreadID, event: Coordination.Event, status: "active" | "done") =>
        ({
          id: Coordination.WorkCardID.make(`wc_${threadId}`),
          projectId,
          threadId,
          version: 1,
          sourceActivitySeq: event.seq,
          currentTask: "Investigate navigation",
          progress: "Read source",
          blockers: [],
          status,
          recentVerifiedOutcome: "Source-backed finding",
          contributors: [alice],
          evidenceRefs: [{ threadId, eventId: event.id, seq: event.seq }],
          generatedAt: new Date(time).toISOString(),
          submittedBy: "analysis_1",
          updatedAt: new Date(time).toISOString(),
          summaryJobId: `job_${threadId}`,
        }) satisfies WorkCard.Detail
      for (const [threadId, event, status] of [
        [threads[0]!.id, eventA, "active"],
        [threads[1]!.id, eventB, "active"],
        [threads[3]!.id, eventD, "done"],
      ] as const) {
        yield* db
          .insert(WorkCardTable)
          .values({
            thread_id: threadId,
            project_id: projectId,
            version: 1,
            source_activity_seq: event.seq,
            data: card(threadId, event, status),
            time_updated: time,
          })
          .run()
      }
      yield* source(threads[1]!.id)
      const runId = Coordination.RunID.make("run_overview_a")
      const instructionId = Coordination.InstructionID.make("ins_overview_a")
      yield* db
        .insert(InstructionTable)
        .values({
          id: instructionId,
          request_id: "work",
          project_id: projectId,
          thread_id: threads[0]!.id,
          actor_id: alice,
          text: "Investigate",
          queue_seq: 1,
          submitted_at: time,
          run_id: runId,
        })
        .run()
      yield* db
        .insert(RunTable)
        .values({
          id: runId,
          thread_id: threads[0]!.id,
          instruction_id: instructionId,
          state: "waiting_approval",
          attempt: 1,
          runner_message_id: "message_overview",
          created_at: time,
        })
        .run()
      yield* db
        .insert(ApprovalTable)
        .values({
          id: "approval_overview",
          project_id: projectId,
          thread_id: threads[0]!.id,
          run_id: runId,
          tool_call_id: "tool_1",
          version: 1,
          state: "pending",
          requested_at: time,
          requested_seq: eventA.seq,
          delivery_state: "none",
        })
        .run()

      const selected = (
        thread: (typeof threads)[number],
        topic: string,
        relationship: CoordinationOverview.Intent["relationship"],
        ownerId = thread.createdBy,
      ): CoordinationOverview.Intent => ({
        projectId,
        threadId: thread.id,
        sessionId: thread.sessionId,
        workerId: thread.workerId,
        ownerId,
        selectedBy: ownerId,
        topic,
        relationship,
        revision: 1,
        state: "selected",
      })
      let intents = [
        selected(threads[0]!, "navigation-ui", "alternative"),
        selected(threads[1]!, "navigation-ui", "alternative"),
        selected(threads[2]!, "schema-migrations", "unspecified"),
        selected(threads[3]!, "navigation-ui", "unspecified", ben),
        {
          ...selected(threads[0]!, "navigation-ui", "alternative"),
          threadId: Coordination.ThreadID.make("thr_private"),
        },
      ]
      let intentReads = 0
      const overview = CoordinationOverview.make({
        db,
        access,
        events,
        intents: {
          list: () =>
            Effect.sync(() => {
              intentReads++
              return intents
            }),
        },
      })
      const view = yield* overview.read(member, projectId, threads[0]!.id)
      expect(view.work.map((item) => item.thread.id)).toEqual(threads.map((thread) => thread.id))
      expect(view.work.map((item) => item.freshness)).toEqual(["current", "stale", "missing", "current"])
      expect(view.work[0]?.evidence[0]).toEqual({
        id: eventA.id,
        seq: eventA.seq,
        threadId: threads[0]!.id,
        kind: "run.output",
        occurredAt: eventA.occurredAt,
      })
      expect(view.work[0]?.latestRunState).toBe("waiting_approval")
      expect(view.work[0]?.toolPermissions).toEqual([{ id: "approval_overview", state: "pending" }])
      expect(view.redirection).toBe("requires-separate-owner-approval")
      expect(view.related.map((item) => [item.threadId, item.kind])).toEqual([
        [threads[1]!.id, "deliberate-alternative"],
        [threads[3]!.id, "reported-completed"],
      ])
      expect(view.related.map((item) => item.freshness)).toEqual(["stale", "current"])
      expect(view.work[3]?.evidence[0]?.id).toBe(eventD.id)
      expect(view.cursor).toBeGreaterThanOrEqual(eventD.seq)

      const oldRunId = Coordination.RunID.make("run_overview_old")
      const oldInstructionId = Coordination.InstructionID.make("ins_overview_old")
      yield* db
        .insert(InstructionTable)
        .values({
          id: oldInstructionId,
          request_id: "old",
          project_id: projectId,
          thread_id: threads[0]!.id,
          actor_id: alice,
          text: "Old work",
          queue_seq: 2,
          submitted_at: time - 1_000,
          run_id: oldRunId,
        })
        .run()
      yield* db
        .insert(RunTable)
        .values({
          id: oldRunId,
          thread_id: threads[0]!.id,
          instruction_id: oldInstructionId,
          state: "completed",
          attempt: 1,
          runner_message_id: "message_overview_old",
          created_at: time - 1_000,
        })
        .run()
      yield* db
        .insert(ApprovalTable)
        .values({
          id: "approval_overview_old",
          project_id: projectId,
          thread_id: threads[0]!.id,
          run_id: oldRunId,
          tool_call_id: "tool_old",
          version: 1,
          state: "pending",
          requested_at: time - 1_000,
          requested_seq: eventA.seq,
          delivery_state: "none",
        })
        .run()
      expect((yield* overview.read(member, projectId, threads[0]!.id)).work[0]?.toolPermissions).toEqual([
        { id: "approval_overview", state: "pending" },
      ])
      const queuedRunId = Coordination.RunID.make("run_overview_queued")
      const queuedInstructionId = Coordination.InstructionID.make("ins_overview_queued")
      yield* db
        .insert(InstructionTable)
        .values({
          id: queuedInstructionId,
          request_id: "queued",
          project_id: projectId,
          thread_id: threads[0]!.id,
          actor_id: alice,
          text: "Next work",
          queue_seq: 3,
          submitted_at: time + 1_000,
          run_id: queuedRunId,
        })
        .run()
      yield* db
        .insert(RunTable)
        .values({
          id: queuedRunId,
          thread_id: threads[0]!.id,
          instruction_id: queuedInstructionId,
          state: "queued",
          attempt: 1,
          runner_message_id: "message_overview_queued",
          created_at: time + 1_000,
        })
        .run()
      const occupied = (yield* overview.read(member, projectId, threads[0]!.id)).work[0]
      expect(occupied?.latestRunState).toBe("waiting_approval")
      expect(occupied?.toolPermissions).toEqual([{ id: "approval_overview", state: "pending" }])

      const invalidD = {
        ...card(threads[3]!.id, eventD, "done"),
        evidenceRefs: [{ threadId: threads[3]!.id, eventId: "evt_wrong", seq: eventD.seq }],
      }
      yield* db.update(WorkCardTable).set({ data: invalidD }).where(eq(WorkCardTable.thread_id, threads[3]!.id)).run()
      const unsupported = yield* overview.read(member, projectId, threads[0]!.id)
      expect(unsupported.work[3]?.freshness).toBe("invalid")
      expect(unsupported.work[3]?.card).toBeUndefined()
      expect(unsupported.related.find((item) => item.threadId === threads[3]!.id)?.kind).toBe("possible-overlap")
      yield* db
        .update(WorkCardTable)
        .set({ data: card(threads[3]!.id, eventD, "done") })
        .where(eq(WorkCardTable.thread_id, threads[3]!.id))
        .run()

      intents = intents.map((intent) =>
        intent.threadId === threads[3]!.id ? { ...intent, selectedBy: alice } : intent,
      )
      expect((yield* overview.read(member, projectId, threads[0]!.id)).related.map((item) => item.threadId)).toEqual([
        threads[1]!.id,
      ])
      intents = intents.map((intent) => (intent.threadId === threads[3]!.id ? { ...intent, selectedBy: ben } : intent))

      intents = [...intents, { ...intents[1]!, revision: 2, state: "muted" }]
      expect((yield* overview.read(member, projectId, threads[0]!.id)).related.map((item) => item.threadId)).toEqual([
        threads[3]!.id,
      ])
      intents = intents.slice(0, -1)

      intents = intents.map((intent) =>
        intent.threadId === threads[1]!.id ? { ...intent, state: "muted" as const } : intent,
      )
      expect((yield* overview.read(member, projectId, threads[0]!.id)).related.map((item) => item.threadId)).toEqual([
        threads[3]!.id,
      ])
      intents = intents.map((intent) =>
        intent.threadId === threads[0]!.id ? { ...intent, state: "muted" as const } : intent,
      )
      expect((yield* overview.read(member, projectId, threads[0]!.id)).related).toEqual([])

      const beforeDenied = intentReads
      expect(
        (yield* overview
          .read({ kind: "member", userId: Coordination.UserID.make("usr_outside") }, projectId)
          .pipe(Effect.flip)).code,
      ).toBe("forbidden")
      expect(
        (yield* overview
          .read({ kind: "runner", workerId: threads[0]!.workerId, instanceId: "host" }, projectId)
          .pipe(Effect.flip)).code,
      ).toBe("forbidden")
      expect(intentReads).toBe(beforeDenied)

      yield* db.run(sql`DROP TABLE coordination_work_card`)
      expect((yield* overview.read(member, projectId).pipe(Effect.flip)).code).toBe("unavailable")
    }).pipe(Effect.provide(layer), Effect.scoped),
  )
})
