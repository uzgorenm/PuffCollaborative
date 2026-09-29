import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { Coordination } from "@opencode-ai/schema/coordination"
import { Session } from "@opencode-ai/schema/session"
import { Database } from "@opencode-ai/core/database/database"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import outboxMigration from "@opencode-ai/core/database/migration/20260929202500_runner_harness_outbox"
import type { RunnerHarnessContracts } from "@opencode-ai/core/runner-harness/contracts"
import { ReportDelivery } from "@opencode-ai/core/runner-harness/report-delivery"
import { OutboxTable } from "@opencode-ai/core/runner-harness/report-delivery.sql"
import { ExecutionTable } from "@opencode-ai/core/runner-harness/sql"
import { tmpdir } from "../fixture/tmpdir"

const runId = Coordination.RunID.make("run_delivery")
const threadId = Coordination.ThreadID.make("thr_delivery")
const projectId = Coordination.ProjectID.make("prj_delivery")
const workerId = Coordination.WorkerID.make("wrk_delivery")
const sessionId = Session.ID.make("ses_delivery")
const owner = { workerId, instanceId: "instance_delivery" }
const command: RunnerHarnessContracts.StartCommand = {
  runId,
  threadId,
  sessionId,
  executionOwner: owner,
  runnerMessageId: "msg_delivery",
  text: "Do the task",
}
const result: Coordination.Run = {
  id: runId,
  threadId,
  instructionId: Coordination.InstructionID.make("ins_delivery"),
  state: "running",
  attempt: 1,
  runnerMessageId: command.runnerMessageId,
  executionOwner: owner,
  createdAt: "2026-09-29T00:00:00.000Z",
}
const output: RunnerHarnessContracts.CallbackDraft = {
  runId,
  producerKey: "session:4:output",
  sourceSessionSeq: 4,
  callback: { kind: "activity", state: "running", activity: { kind: "run.output", text: "working" } },
}
const completed: RunnerHarnessContracts.CallbackDraft = {
  runId,
  producerKey: "session:9:terminal",
  sourceSessionSeq: 9,
  callback: { kind: "state", expectedState: "running", nextState: "completed" },
}
const credentials: RunnerHarnessContracts.Credentials = {
  verify: () => Effect.void,
  principal: (identity) => Effect.succeed({ kind: "runner", ...identity }),
}

async function withDelivery<A>(
  filename: string,
  callbacks: RunnerHarnessContracts.CoordinatorCallbacks,
  clock: () => number,
  body: (db: Database.Interface["db"], delivery: RunnerHarnessContracts.ReportDelivery) => Effect.Effect<A, unknown>,
  identity = credentials,
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      yield* DatabaseMigration.applyOnly(db, [outboxMigration])
      const delivery = ReportDelivery.make({ db, callbacks, credentials: identity, redact: (text) => text, now: clock })
      return yield* body(db, delivery)
    }).pipe(Effect.provide(Database.layerFromPath(filename)), Effect.scoped),
  )
}

const seed = (db: Database.Interface["db"]) =>
  db
    .insert(ExecutionTable)
    .values({
      run_id: runId,
      thread_id: threadId,
      project_id: projectId,
      session_id: sessionId,
      worker_id: workerId,
      instance_id: owner.instanceId,
      attempt: 1,
      runner_message_id: command.runnerMessageId,
      command,
      phase: "running",
      created_at: 1_000,
      updated_at: 1_000,
    })
    .run()

const append = (
  db: Database.Interface["db"],
  delivery: RunnerHarnessContracts.ReportDelivery,
  drafts: ReadonlyArray<RunnerHarnessContracts.CallbackDraft>,
) => db.transaction((tx) => delivery.append(tx, drafts))

describe("runner callback outbox with real SQLite and a simulated coordinator", () => {
  test("outage schedules bounded retry and keeps terminal behind output", async () => {
    await using tmp = await tmpdir()
    let time = 1_000
    let connected = false
    const sent: string[] = []
    await withDelivery(
      path.join(tmp.path, "outbox.sqlite"),
      {
        report: ({ callbackId, callback }) => {
          sent.push(`${callbackId}:${callback.kind === "activity" ? "output" : "terminal"}`)
          return connected ? Effect.succeed(result) : Effect.fail({ code: "unavailable", message: "offline" })
        },
      },
      () => time,
      (db, delivery) =>
        Effect.gen(function* () {
          yield* seed(db)
          const recorded = yield* append(db, delivery, [output, completed])
          expect(recorded.map((item) => item.ordinal)).toEqual([1, 2])
          yield* delivery.flush(runId)
          expect(sent).toEqual([`${recorded[0]!.callbackId}:output`])
          expect(yield* delivery.diagnostics).toEqual({ pending: 2, failed: 0 })
          time += 249
          expect(yield* delivery.drainDue(8)).toBe(0)
          connected = true
          time += 1
          expect(yield* delivery.drainDue(8)).toBe(1)
          expect(sent).toEqual([
            `${recorded[0]!.callbackId}:output`,
            `${recorded[0]!.callbackId}:output`,
            `${recorded[1]!.callbackId}:terminal`,
          ])
          expect(yield* delivery.diagnostics).toEqual({ pending: 0, failed: 0 })
        }),
    )
  })

  test("lost acknowledgment repeats one logical event with its original identity and payload", async () => {
    await using tmp = await tmpdir()
    let time = 1_000
    let first = true
    const received = new Map<string, string>()
    const attempts: string[] = []
    await withDelivery(
      path.join(tmp.path, "outbox.sqlite"),
      {
        report: ({ callbackId, callback }) => {
          attempts.push(callbackId)
          const payload = JSON.stringify(callback)
          const earlier = received.get(callbackId)
          if (earlier && earlier !== payload) return Effect.fail({ code: "conflict", message: "changed retry" })
          received.set(callbackId, payload)
          if (first) {
            first = false
            return Effect.fail({ code: "unavailable", message: "ack lost" })
          }
          return Effect.succeed(result)
        },
      },
      () => time,
      (db, delivery) =>
        Effect.gen(function* () {
          yield* seed(db)
          const [recorded] = yield* append(db, delivery, [output])
          yield* delivery.flush(runId)
          time += 250
          yield* delivery.flush(runId)
          expect(attempts).toEqual([recorded!.callbackId, recorded!.callbackId])
          expect(received.size).toBe(1)
          expect(yield* delivery.pending(runId)).toEqual([])
        }),
    )
  })

  test("exact producer retry returns one row; changed retry conflicts", async () => {
    await using tmp = await tmpdir()
    await withDelivery(
      path.join(tmp.path, "outbox.sqlite"),
      { report: () => Effect.succeed(result) },
      () => 1_000,
      (db, delivery) =>
        Effect.gen(function* () {
          yield* seed(db)
          const [first] = yield* append(db, delivery, [output])
          const [second] = yield* append(db, delivery, [output])
          expect(second).toEqual(first)
          const conflict = yield* append(db, delivery, [
            {
              ...output,
              callback: { kind: "activity", state: "running", activity: { kind: "run.output", text: "changed" } },
            },
          ]).pipe(Effect.match({ onFailure: (error) => error, onSuccess: () => undefined }))
          expect(conflict).toMatchObject({ code: "conflict" })
          expect((yield* db.select().from(OutboxTable).all()).length).toBe(1)
        }),
    )
  })

  test("a large callback batch is rejected without writing a partial backlog", async () => {
    await using tmp = await tmpdir()
    await withDelivery(
      path.join(tmp.path, "outbox.sqlite"),
      { report: () => Effect.succeed(result) },
      () => 1_000,
      (db, delivery) =>
        Effect.gen(function* () {
          yield* seed(db)
          const failure = yield* append(
            db,
            delivery,
            Array.from({ length: 65 }, (_, index) => ({ ...output, producerKey: `output:${index}` })),
          ).pipe(Effect.match({ onFailure: (error) => error, onSuccess: () => undefined }))
          expect(failure).toMatchObject({ code: "invalid" })
          expect(yield* db.select().from(OutboxTable).all()).toEqual([])
        }),
    )
  })

  test("permanent authentication failure is recorded and blocks later callbacks", async () => {
    await using tmp = await tmpdir()
    let calls = 0
    await withDelivery(
      path.join(tmp.path, "outbox.sqlite"),
      {
        report: () => {
          calls++
          return Effect.succeed(result)
        },
      },
      () => 1_000,
      (db, delivery) =>
        Effect.gen(function* () {
          yield* seed(db)
          yield* append(db, delivery, [output, completed])
          const failure = yield* delivery
            .flush(runId)
            .pipe(Effect.match({ onFailure: (error) => error, onSuccess: () => undefined }))
          expect(failure).toMatchObject({ code: "unauthorized" })
          expect(calls).toBe(0)
          expect(yield* delivery.drainDue(8)).toBe(0)
          expect(yield* delivery.diagnostics).toEqual({ pending: 1, failed: 1 })
          const rows = yield* db.select().from(OutboxTable).orderBy(OutboxTable.ordinal).all()
          expect(rows.map((row) => row.acknowledged_at)).toEqual([null, null])
          expect(rows[0]?.permanent_failure_at).toBe(1_000)
        }),
      {
        ...credentials,
        principal: () => Effect.fail({ code: "unauthorized", message: "credential revoked" }),
      },
    )
  })

  test("phase update and callback insertion roll back together", async () => {
    await using tmp = await tmpdir()
    await withDelivery(
      path.join(tmp.path, "outbox.sqlite"),
      { report: () => Effect.succeed(result) },
      () => 1_000,
      (db, delivery) =>
        Effect.gen(function* () {
          yield* seed(db)
          const failure = yield* db
            .transaction((tx) =>
              Effect.gen(function* () {
                yield* tx
                  .update(ExecutionTable)
                  .set({ phase: "completed" })
                  .where(eq(ExecutionTable.run_id, runId))
                  .run()
                yield* delivery.append(tx, [output, { ...output, callback: completed.callback }])
              }),
            )
            .pipe(Effect.match({ onFailure: (error) => error, onSuccess: () => undefined }))
          expect(failure).toMatchObject({ code: "conflict" })
          expect((yield* db.select().from(ExecutionTable).where(eq(ExecutionTable.run_id, runId)).get())?.phase).toBe(
            "running",
          )
          expect(yield* db.select().from(OutboxTable).all()).toEqual([])
        }),
    )
  })

  test("storage exhaustion fails append explicitly and preserves the transaction", async () => {
    await using tmp = await tmpdir()
    await withDelivery(
      path.join(tmp.path, "outbox.sqlite"),
      { report: () => Effect.succeed(result) },
      () => 1_000,
      (db, delivery) =>
        Effect.gen(function* () {
          yield* seed(db)
          yield* db.run(
            `CREATE TRIGGER fail_outbox BEFORE INSERT ON runner_harness_outbox BEGIN SELECT RAISE(FAIL, 'database or disk is full'); END;`,
          )
          const failure = yield* append(db, delivery, [output]).pipe(
            Effect.match({ onFailure: (error) => error, onSuccess: () => undefined }),
          )
          expect(failure).toMatchObject({ code: "unavailable", message: "Runner outbox storage exhausted" })
          expect(yield* db.select().from(OutboxTable).all()).toEqual([])
        }),
    )
  })

  test("pending callbacks recover across two actual worker processes", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "restart.sqlite")
    const child = path.join(import.meta.dir, "report-delivery.restart.ts")
    const run = async (mode: "enqueue" | "drain") => {
      const childProcess = Bun.spawn([process.execPath, child, mode, filename], {
        cwd: path.join(import.meta.dir, "../.."),
        stdout: "pipe",
        stderr: "pipe",
      })
      const [stdout, stderr, code] = await Promise.all([
        new Response(childProcess.stdout).text(),
        new Response(childProcess.stderr).text(),
        childProcess.exited,
      ])
      expect(code, stderr).toBe(0)
      return JSON.parse(stdout.trim()) as { ids: string[]; pending: number; sent?: string[] }
    }
    const first = await run("enqueue")
    expect(first.pending).toBe(2)
    const second = await run("drain")
    expect(second.pending).toBe(0)
    expect(second.sent).toEqual(first.ids)
  })
})
