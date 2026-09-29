import { Effect } from "effect"
import { Coordination } from "@opencode-ai/schema/coordination"
import { Session } from "@opencode-ai/schema/session"
import { Database } from "@opencode-ai/core/database/database"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import outboxMigration from "@opencode-ai/core/database/migration/20260929202500_runner_harness_outbox"
import type { RunnerHarnessContracts } from "@opencode-ai/core/runner-harness/contracts"
import { ReportDelivery } from "@opencode-ai/core/runner-harness/report-delivery"
import { ExecutionTable } from "@opencode-ai/core/runner-harness/sql"

const mode = process.argv[2]
const filename = process.argv[3]
if ((mode !== "enqueue" && mode !== "drain") || !filename) throw new Error("Expected mode and SQLite path")

const runId = Coordination.RunID.make("run_restart")
const threadId = Coordination.ThreadID.make("thr_restart")
const sessionId = Session.ID.make("ses_restart")
const workerId = Coordination.WorkerID.make("wrk_restart")
const owner = { workerId, instanceId: "instance_restart" }
const command: RunnerHarnessContracts.StartCommand = {
  runId,
  threadId,
  sessionId,
  executionOwner: owner,
  runnerMessageId: "msg_restart",
  text: "Continue",
}
const sent: string[] = []

const output = await Effect.runPromise(
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    yield* DatabaseMigration.applyOnly(db, [outboxMigration])
    const delivery = ReportDelivery.make({
      db,
      now: () => (mode === "enqueue" ? 1_000 : 1_250),
      redact: (text) => text,
      credentials: {
        verify: () => Effect.void,
        principal: (identity) => Effect.succeed({ kind: "runner", ...identity }),
      },
      callbacks: {
        report: ({ callbackId }) => {
          sent.push(callbackId)
          if (mode === "enqueue") return Effect.fail({ code: "unavailable", message: "offline" })
          return Effect.succeed({
            id: runId,
            threadId,
            instructionId: Coordination.InstructionID.make("ins_restart"),
            state: "running",
            attempt: 1,
            runnerMessageId: command.runnerMessageId,
            executionOwner: owner,
            createdAt: "2026-09-29T00:00:00.000Z",
          })
        },
      },
    })
    if (mode === "enqueue") {
      yield* db
        .insert(ExecutionTable)
        .values({
          run_id: runId,
          thread_id: threadId,
          project_id: Coordination.ProjectID.make("prj_restart"),
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
      yield* db.transaction((tx) =>
        delivery.append(tx, [
          {
            runId,
            producerKey: "restart:output",
            callback: { kind: "activity", state: "running", activity: { kind: "run.output", text: "before restart" } },
          },
          {
            runId,
            producerKey: "restart:terminal",
            callback: { kind: "state", expectedState: "running", nextState: "completed" },
          },
        ]),
      )
      yield* delivery.flush(runId)
    } else {
      yield* delivery.drainDue(8)
    }
    const pending = yield* delivery.pending(runId)
    const diagnostics = yield* delivery.diagnostics
    return { ids: pending.map((item) => item.callbackId), pending: diagnostics.pending, sent }
  }).pipe(Effect.provide(Database.layerFromPath(filename)), Effect.scoped),
)

process.stdout.write(JSON.stringify(output))
