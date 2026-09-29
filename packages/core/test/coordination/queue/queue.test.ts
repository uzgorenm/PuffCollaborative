import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Effect, Layer } from "effect"
import { eq, sql } from "drizzle-orm"
import { Coordination } from "@opencode-ai/schema/coordination"
import { Session } from "@opencode-ai/schema/session"
import { Database } from "@opencode-ai/core/database/database"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import queueMigration from "@opencode-ai/core/database/migration/20260929193000_coordination_queue"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import type { CoordinationContracts } from "@opencode-ai/core/coordination/contracts"
import { CoordinationEvents } from "@opencode-ai/core/coordination/events/events"
import { CoordinationQueue } from "@opencode-ai/core/coordination/queue/queue"
import { RunTable } from "@opencode-ai/core/coordination/queue/sql"
import { tmpdir } from "../../fixture/tmpdir"

const projectId = Coordination.ProjectID.make("prj_queue_test")
const alice = Coordination.UserID.make("usr_alice")
const bob = Coordination.UserID.make("usr_bob")
const eve = Coordination.UserID.make("usr_eve")
const workerA = Coordination.WorkerID.make("wrk_a")
const workerB = Coordination.WorkerID.make("wrk_b")
const threadA = Coordination.ThreadID.make("thr_a")
const threadB = Coordination.ThreadID.make("thr_b")
const threads = new Map<Coordination.ThreadID, Coordination.Thread>([
  [
    threadA,
    {
      id: threadA,
      projectId,
      sessionId: Session.ID.make("ses_a"),
      workerId: workerA,
      title: "A",
      createdBy: alice,
      createdAt: "2026-09-29T00:00:00.000Z",
      activitySeq: 0,
    },
  ],
  [
    threadB,
    {
      id: threadB,
      projectId,
      sessionId: Session.ID.make("ses_b"),
      workerId: workerB,
      title: "B",
      createdBy: bob,
      createdAt: "2026-09-29T00:00:00.000Z",
      activitySeq: 0,
    },
  ],
])
const member = (userId: Coordination.UserID): Coordination.AuthContext => ({ kind: "member", userId })
const runner = (workerId: Coordination.WorkerID, instanceId = "instance_1"): Coordination.AuthContext => ({
  kind: "runner",
  workerId,
  instanceId,
})
const owner = (workerId: Coordination.WorkerID, instanceId = "instance_1") => ({ workerId, instanceId })

// Synthetic Access adapter; the event journal and SQLite transactions are real.
const access: CoordinationContracts.Access = {
  getThread: (principal, threadId) => {
    const thread = threads.get(threadId)
    if (!thread) return Effect.fail({ code: "not_found", message: "Thread not found" })
    if (principal.kind === "member" && principal.userId === eve)
      return Effect.fail({ code: "forbidden", message: "Outside project" })
    if (principal.kind === "runner" && principal.workerId !== thread.workerId)
      return Effect.fail({ code: "forbidden", message: "Wrong worker" })
    return Effect.succeed(thread)
  },
  authorize: (principal, _projectId, threadId) =>
    threadId ? Effect.asVoid(access.getThread(principal, threadId, "read")) : Effect.void,
}

async function withQueue<A>(
  filename: string,
  time: number,
  body: (queue: CoordinationContracts.Queue, db: Database.Interface["db"]) => Effect.Effect<A, unknown>,
) {
  const layer = Layer.provideMerge(
    CoordinationEvents.layerWith(),
    Layer.provideMerge(EventV2.layerWith(), Database.layerFromPath(filename)),
  )
  return Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const events = yield* CoordinationEvents.Service
      yield* DatabaseMigration.applyOnly(db, [queueMigration])
      const queue = CoordinationQueue.make({
        db,
        access,
        events,
        now: () => time,
      })
      return yield* body(queue, db)
    }).pipe(Effect.provide(layer), Effect.scoped),
  )
}

describe("CoordinationQueue with SQLite and EventV2 (mocked Access adapter)", () => {
  test("concurrent same-thread submissions receive durable per-thread order", async () => {
    await using tmp = await tmpdir()
    await withQueue(path.join(tmp.path, "queue.sqlite"), 1_000, (queue) =>
      Effect.gen(function* () {
        const accepted = yield* Effect.all(
          Array.from({ length: 12 }, (_, index) =>
            queue.submit({
              principal: member(alice),
              threadId: threadA,
              requestId: `req_${index}`,
              text: `Task ${index}`,
            }),
          ),
          { concurrency: "unbounded" },
        )
        expect(accepted.map((item) => item.instruction.queueSeq).sort((a, b) => a - b)).toEqual(
          Array.from({ length: 12 }, (_, index) => index + 1),
        )
        expect((yield* queue.instructions(threadA)).map((item) => item.queueSeq)).toEqual(
          Array.from({ length: 12 }, (_, index) => index + 1),
        )
      }),
    )
  })

  test("competing dispatchers reserve one active Run while another Thread reserves independently", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "queue.sqlite")
    await withQueue(filename, 1_000, (queue) =>
      Effect.gen(function* () {
        yield* queue.submit({ principal: member(alice), threadId: threadA, requestId: "one", text: "First" })
        yield* queue.submit({ principal: member(bob), threadId: threadA, requestId: "two", text: "Second" })
        yield* queue.submit({ principal: member(bob), threadId: threadB, requestId: "other", text: "Independent" })
      }),
    )
    // Each dispatcher opens its own SQLite connection to the same durable file.
    const claims = await Promise.all([
      withQueue(filename, 1_000, (queue) =>
        queue.reserveNext({
          principal: runner(workerA, "instance_1"),
          threadId: threadA,
          executionOwner: owner(workerA, "instance_1"),
          leaseUntil: new Date(5_000).toISOString(),
        }),
      ),
      withQueue(filename, 1_000, (queue) =>
        queue.reserveNext({
          principal: runner(workerA, "instance_2"),
          threadId: threadA,
          executionOwner: owner(workerA, "instance_2"),
          leaseUntil: new Date(5_000).toISOString(),
        }),
      ),
      withQueue(filename, 1_000, (queue) =>
        queue.reserveNext({
          principal: runner(workerB),
          threadId: threadB,
          executionOwner: owner(workerB),
          leaseUntil: new Date(5_000).toISOString(),
        }),
      ),
    ])
    expect(claims.slice(0, 2).filter(Boolean)).toHaveLength(1)
    expect(claims[2]?.run.state).toBe("reserved")
    expect(claims[0]?.instruction.queueSeq ?? claims[1]?.instruction.queueSeq).toBe(1)
  })

  test("two dispatchers with the same execution owner do not both receive the reservation", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "queue.sqlite")
    await withQueue(filename, 1_000, (queue) =>
      Effect.asVoid(queue.submit({ principal: member(alice), threadId: threadA, requestId: "one", text: "Only once" })),
    )
    const claims = await Promise.all(
      Array.from({ length: 2 }, () =>
        withQueue(filename, 1_000, (queue) =>
          queue.reserveNext({
            principal: runner(workerA),
            threadId: threadA,
            executionOwner: owner(workerA),
            leaseUntil: new Date(5_000).toISOString(),
          }),
        ),
      ),
    )
    expect(claims.filter(Boolean)).toHaveLength(1)
  })

  test("exact submission and callback retries create no extra work or durable events", async () => {
    await using tmp = await tmpdir()
    await withQueue(path.join(tmp.path, "queue.sqlite"), 1_000, (queue, db) =>
      Effect.gen(function* () {
        const copies = yield* Effect.all(
          Array.from({ length: 8 }, () =>
            queue.submit({ principal: member(alice), threadId: threadA, requestId: "retry", text: "Do this" }),
          ),
          { concurrency: "unbounded" },
        )
        expect(new Set(copies.map((item) => item.run.id)).size).toBe(1)
        expect(yield* queue.instructions(threadA)).toHaveLength(1)
        const conflicting = yield* queue
          .submit({ principal: member(alice), threadId: threadA, requestId: "retry", text: "Different" })
          .pipe(Effect.flip)
        expect(conflicting.code).toBe("conflict")
        const denied = yield* queue
          .submit({ principal: member(eve), threadId: threadA, requestId: "new", text: "Unauthorized" })
          .pipe(Effect.flip)
        expect(denied.code).toBe("forbidden")
        const claimed = yield* queue.reserveNext({
          principal: runner(workerA),
          threadId: threadA,
          executionOwner: owner(workerA),
          leaseUntil: new Date(5_000).toISOString(),
        })
        expect(claimed).toBeDefined()
        const callback = { kind: "state" as const, expectedState: "reserved" as const, nextState: "running" as const }
        yield* queue.transition({
          principal: runner(workerA),
          runId: claimed!.run.id,
          callbackId: "callback_start",
          callback,
        })
        yield* queue.transition({
          principal: runner(workerA),
          runId: claimed!.run.id,
          callbackId: "callback_start",
          callback,
        })
        const callbackConflict = yield* queue
          .transition({
            principal: runner(workerA),
            runId: claimed!.run.id,
            callbackId: "callback_start",
            callback: { kind: "state", expectedState: "running", nextState: "completed" },
          })
          .pipe(Effect.flip)
        expect(callbackConflict.code).toBe("conflict")
        const rows = yield* db
          .select()
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, `coordination:project:${projectId}`))
          .all()
          .pipe(Effect.orDie)
        expect(rows).toHaveLength(3)
        const otherMember = yield* queue.submit({
          principal: member(bob),
          threadId: threadA,
          requestId: "retry",
          text: "My own task",
        })
        const otherThread = yield* queue.submit({
          principal: member(alice),
          threadId: threadB,
          requestId: "retry",
          text: "Another thread",
        })
        expect(otherMember.instruction.id).not.toBe(copies[0]?.instruction.id)
        expect(otherThread.instruction.id).not.toBe(copies[0]?.instruction.id)
      }),
    )
  })

  test("a follow-up becomes reservable only after the prior turn is confirmed terminal", async () => {
    await using tmp = await tmpdir()
    await withQueue(path.join(tmp.path, "queue.sqlite"), 1_000, (queue) =>
      Effect.gen(function* () {
        const first = yield* queue.submit({
          principal: member(alice),
          threadId: threadA,
          requestId: "first",
          text: "First task",
        })
        const second = yield* queue.submit({
          principal: member(bob),
          threadId: threadA,
          requestId: "second",
          text: "Follow up",
        })
        const claim = yield* queue.reserveNext({
          principal: runner(workerA),
          threadId: threadA,
          executionOwner: owner(workerA),
          leaseUntil: new Date(5_000).toISOString(),
        })
        expect(claim?.instruction.id).toBe(first.instruction.id)
        yield* queue.transition({
          principal: runner(workerA),
          runId: first.run.id,
          callbackId: "start",
          callback: { kind: "state", expectedState: "reserved", nextState: "running" },
        })
        expect(
          yield* queue.reserveNext({
            principal: runner(workerA),
            threadId: threadA,
            executionOwner: owner(workerA),
            leaseUntil: new Date(5_000).toISOString(),
          }),
        ).toBeUndefined()
        yield* queue.transition({
          principal: runner(workerA),
          runId: first.run.id,
          callbackId: "done",
          callback: { kind: "state", expectedState: "running", nextState: "completed" },
        })
        const followUp = yield* queue.reserveNext({
          principal: runner(workerA),
          threadId: threadA,
          executionOwner: owner(workerA),
          leaseUntil: new Date(5_000).toISOString(),
        })
        expect(followUp?.instruction.id).toBe(second.instruction.id)
        expect(followUp?.instruction.text).toBe("Follow up")
      }),
    )
  })

  test("cancellation and approval waits keep the Thread occupied", async () => {
    await using tmp = await tmpdir()
    await withQueue(path.join(tmp.path, "queue.sqlite"), 1_000, (queue, db) =>
      Effect.gen(function* () {
        yield* db
          .run(sql`CREATE TABLE test_approval (id TEXT PRIMARY KEY, source_seq INTEGER NOT NULL)`)
          .pipe(Effect.orDie)
        const first = yield* queue.submit({
          principal: member(alice),
          threadId: threadA,
          requestId: "first",
          text: "Write file",
        })
        yield* queue.submit({ principal: member(bob), threadId: threadA, requestId: "second", text: "Next task" })
        yield* queue.reserveNext({
          principal: runner(workerA),
          threadId: threadA,
          executionOwner: owner(workerA),
          leaseUntil: new Date(5_000).toISOString(),
        })
        yield* queue.transition({
          principal: runner(workerA),
          runId: first.run.id,
          callbackId: "start",
          callback: { kind: "state", expectedState: "reserved", nextState: "running" },
        })
        const wait = {
          kind: "state" as const,
          expectedState: "running" as const,
          nextState: "waiting_approval" as const,
          approvalId: "approval_1",
          toolCallId: "tool_write",
        }
        const before = yield* db
          .select()
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, `coordination:project:${projectId}`))
          .all()
          .pipe(Effect.orDie)
        const rejected = yield* queue
          .transition({
            principal: runner(workerA),
            runId: first.run.id,
            callbackId: "ask",
            callback: wait,
            commitApproval: () => Effect.fail({ code: "conflict" as const, message: "Approval projection rejected" }),
          })
          .pipe(Effect.flip)
        expect(rejected.code).toBe("conflict")
        expect((yield* queue.getRun(first.run.id))?.state).toBe("running")
        expect(
          yield* db
            .select()
            .from(EventTable)
            .where(eq(EventTable.aggregate_id, `coordination:project:${projectId}`))
            .all()
            .pipe(Effect.orDie),
        ).toHaveLength(before.length)
        yield* queue.transition({
          principal: runner(workerA),
          runId: first.run.id,
          callbackId: "ask",
          callback: wait,
          commitApproval: (seq) =>
            db
              .run(sql`INSERT INTO test_approval (id, source_seq) VALUES ('approval_1', ${seq})`)
              .pipe(Effect.asVoid, Effect.orDie),
        })
        yield* queue.transition({ principal: runner(workerA), runId: first.run.id, callbackId: "ask", callback: wait })
        expect(yield* db.get(sql`SELECT count(*) AS count FROM test_approval`)).toEqual({ count: 1 })
        expect(
          yield* queue.reserveNext({
            principal: runner(workerA),
            threadId: threadA,
            executionOwner: owner(workerA),
            leaseUntil: new Date(5_000).toISOString(),
          }),
        ).toBeUndefined()
        expect(
          (yield* queue.cancel({ principal: member(alice), threadId: threadA, instructionId: first.instruction.id }))
            .state,
        ).toBe("cancelling")
        expect(
          yield* queue.reserveNext({
            principal: runner(workerA),
            threadId: threadA,
            executionOwner: owner(workerA),
            leaseUntil: new Date(5_000).toISOString(),
          }),
        ).toBeUndefined()
      }),
    )
  })

  test("a restarted dispatcher marks an expired reservation uncertain and does not launch the next Run", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "queue.sqlite")
    const first = await withQueue(filename, 1_000, (queue) =>
      Effect.gen(function* () {
        const one = yield* queue.submit({
          principal: member(alice),
          threadId: threadA,
          requestId: "one",
          text: "First",
        })
        yield* queue.submit({ principal: member(bob), threadId: threadA, requestId: "two", text: "Second" })
        yield* queue.reserveNext({
          principal: runner(workerA),
          threadId: threadA,
          executionOwner: owner(workerA),
          leaseUntil: new Date(2_000).toISOString(),
        })
        return one.run
      }),
    )
    await withQueue(filename, 1_500, (queue) =>
      Effect.gen(function* () {
        const pending = yield* queue.pending(owner(workerA))
        expect(pending).toHaveLength(1)
        expect(pending[0]?.run.runnerMessageId).toBe(first.runnerMessageId)
        expect(pending[0]?.instruction.queueSeq).toBe(1)
      }),
    )
    await withQueue(filename, 3_000, (queue, db) =>
      Effect.gen(function* () {
        const next = yield* queue.reserveNext({
          principal: runner(workerA),
          threadId: threadA,
          executionOwner: owner(workerA),
          leaseUntil: new Date(5_000).toISOString(),
        })
        expect(next).toBeUndefined()
        expect((yield* queue.getRun(first.id))?.state).toBe("recovery_required")
        expect((yield* queue.pending(owner(workerA)))[0]?.run.state).toBe("recovery_required")
        expect(
          yield* queue.reserveNext({
            principal: runner(workerA),
            threadId: threadA,
            executionOwner: owner(workerA),
            leaseUntil: new Date(5_000).toISOString(),
          }),
        ).toBeUndefined()
        const rows = yield* db.select().from(RunTable).where(eq(RunTable.thread_id, threadA)).all().pipe(Effect.orDie)
        expect(rows.map((row) => row.state).sort()).toEqual(["queued", "recovery_required"])
        const lateStart = yield* queue.transition({
          principal: runner(workerA),
          runId: first.id,
          callbackId: "late_start",
          callback: { kind: "state", expectedState: "reserved", nextState: "running" },
        })
        expect(lateStart.state).toBe("running")
        expect(lateStart.attempt).toBe(1)
        expect(
          yield* queue.reserveNext({
            principal: runner(workerA),
            threadId: threadA,
            executionOwner: owner(workerA),
            leaseUntil: new Date(5_000).toISOString(),
          }),
        ).toBeUndefined()
      }),
    )
  })

  test("a cancellation requested before execution starts survives lease expiry", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "queue.sqlite")
    const first = await withQueue(filename, 1_000, (queue) =>
      Effect.gen(function* () {
        const accepted = yield* queue.submit({
          principal: member(alice),
          threadId: threadA,
          requestId: "cancel_before_start",
          text: "First",
        })
        yield* queue.submit({ principal: member(bob), threadId: threadA, requestId: "next", text: "Second" })
        yield* queue.reserveNext({
          principal: runner(workerA),
          threadId: threadA,
          executionOwner: owner(workerA),
          leaseUntil: new Date(2_000).toISOString(),
        })
        const cancelled = yield* queue.cancel({
          principal: member(alice),
          threadId: threadA,
          instructionId: accepted.instruction.id,
        })
        expect(cancelled.state).toBe("cancelling")
        expect(cancelled.leaseUntil).toBeUndefined()
        return accepted.run.id
      }),
    )
    await withQueue(filename, 3_000, (queue) =>
      Effect.gen(function* () {
        expect(
          yield* queue.reserveNext({
            principal: runner(workerA),
            threadId: threadA,
            executionOwner: owner(workerA),
            leaseUntil: new Date(5_000).toISOString(),
          }),
        ).toBeUndefined()
        expect((yield* queue.getRun(first))?.state).toBe("cancelling")
        expect((yield* queue.pending(owner(workerA)))[0]?.run.state).toBe("cancelling")
      }),
    )
  })
})
