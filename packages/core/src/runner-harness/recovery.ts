export * as RunnerRecovery from "./recovery"

import { asc } from "drizzle-orm"
import { Effect } from "effect"
import type { Database } from "../database/database"
import { SessionInput } from "../session/input"
import { SessionMessage } from "../session/message"
import type {
  Cancellations,
  Failure,
  Lifecycle,
  LocalExecution,
  Recovery,
  ReportDelivery,
  Runtimes,
  SessionBinding,
} from "./contracts"
import { ExecutionTable } from "./sql"

export interface Dependencies {
  readonly db: Database.Interface["db"]
  readonly lifecycle: Pick<Lifecycle, "start" | "transition" | "get" | "byMessageId">
  readonly binding: Pick<SessionBinding, "authorize" | "attach">
  readonly runtimes: Pick<Runtimes, "inspect" | "wake">
  readonly reports: Pick<ReportDelivery, "pending" | "flush">
  readonly cancellations: Cancellations
}

type Assessment =
  | { readonly kind: "missing"; readonly execution?: LocalExecution }
  | { readonly kind: "admitted"; readonly execution: LocalExecution; readonly unpromoted: boolean }
  | { readonly kind: "running" | "terminal"; readonly execution: LocalExecution }
  | { readonly kind: "unreported"; readonly execution: LocalExecution }
  | { readonly kind: "uncertain"; readonly execution?: LocalExecution; readonly reason: string }

const terminal = new Set(["completed", "failed", "cancelled"])

export function make(input: Dependencies): Recovery {
  const assess = Effect.fn("RunnerRecovery.assess")(function* (messageId: string) {
    const execution = yield* input.lifecycle.byMessageId(messageId)
    const admitted = yield* SessionInput.find(input.db, SessionMessage.ID.make(messageId))
    if (!execution) {
      if (!admitted) return { kind: "missing" as const }
      return { kind: "uncertain" as const, reason: "Session input exists without a local Run record" }
    }

    const command = execution.run.command
    if (
      command.runnerMessageId !== messageId ||
      (execution.admittedMessageId && execution.admittedMessageId !== messageId)
    )
      return { kind: "uncertain" as const, execution, reason: "Local Run message identity changed" }
    if (
      execution.runtime &&
      (execution.runtime.workerId !== command.executionOwner.workerId ||
        execution.runtime.instanceId !== command.executionOwner.instanceId)
    )
      return { kind: "uncertain" as const, execution, reason: "Runtime execution owner changed" }
    if (
      execution.workspace &&
      (execution.workspace.threadId !== command.threadId || execution.workspace.projectId !== execution.run.projectId)
    )
      return { kind: "uncertain" as const, execution, reason: "Workspace binding changed" }

    const authorized = yield* input.binding.authorize(command).pipe(
      Effect.map((run) => ({ run }) as const),
      Effect.catch((error) => Effect.succeed({ error } as const)),
    )
    if ("error" in authorized)
      return {
        kind: "uncertain" as const,
        execution,
        reason: `Coordinator Run cannot be verified (${authorized.error.code})`,
      }
    if (
      authorized.run.attempt !== execution.run.attempt ||
      authorized.run.projectId !== execution.run.projectId ||
      execution.run.session.id !== command.sessionId ||
      execution.run.session.projectID !== execution.run.projectId ||
      authorized.run.session.id !== command.sessionId ||
      authorized.run.session.projectID !== execution.run.projectId ||
      authorized.run.command.runId !== command.runId ||
      authorized.run.command.threadId !== command.threadId ||
      authorized.run.command.sessionId !== command.sessionId ||
      authorized.run.command.runnerMessageId !== messageId ||
      authorized.run.command.text !== command.text ||
      authorized.run.command.executionOwner.workerId !== command.executionOwner.workerId ||
      authorized.run.command.executionOwner.instanceId !== command.executionOwner.instanceId
    )
      return { kind: "uncertain" as const, execution, reason: "Coordinator Run attempt or ownership changed" }
    if (execution.workspace && execution.runtime) {
      const attached = yield* input.binding
        .attach({
          run: authorized.run,
          workspace: execution.workspace,
          runtime: execution.runtime,
        })
        .pipe(
          Effect.map((session) => ({ session }) as const),
          Effect.catch((error) => Effect.succeed({ error } as const)),
        )
      if ("error" in attached)
        return {
          kind: "uncertain" as const,
          execution,
          reason: `Session binding cannot be verified (${attached.error.code})`,
        }
      if (attached.session.id !== command.sessionId || attached.session.projectID !== execution.run.projectId)
        return { kind: "uncertain" as const, execution, reason: "Session binding changed" }
    }
    if (
      admitted &&
      (admitted.sessionID !== command.sessionId ||
        admitted.delivery !== "queue" ||
        admitted.prompt.text !== command.text ||
        (admitted.prompt.files?.length ?? 0) > 0 ||
        (admitted.prompt.agents?.length ?? 0) > 0)
    )
      return {
        kind: "uncertain" as const,
        execution,
        reason: "Durable Session input differs from the authorized command",
      }

    if (terminal.has(execution.phase)) {
      if (!admitted && execution.phase === "completed")
        return { kind: "uncertain" as const, execution, reason: "Completed Run has no durable Session input" }
      if ((yield* input.reports.pending(command.runId)).length > 0) return { kind: "unreported" as const, execution }
      return { kind: "terminal" as const, execution }
    }
    if (!admitted) {
      if (execution.phase === "recovery_required")
        return { kind: "uncertain" as const, execution, reason: "Run still requires explicit reconciliation" }
      if (execution.phase === "accepted" && !execution.runtime) return { kind: "missing" as const, execution }
      if (execution.phase !== "accepted" && execution.phase !== "prepared")
        return { kind: "uncertain" as const, execution, reason: "Run advanced without durable Session input" }
      if (!execution.runtime)
        return { kind: "uncertain" as const, execution, reason: "Submission intent has no inspectable runtime" }
      const inspection = yield* input.runtimes.inspect(execution).pipe(
        Effect.map((state) => ({ state }) as const),
        Effect.catch((error) => Effect.succeed({ error } as const)),
      )
      if ("error" in inspection)
        return {
          kind: "uncertain" as const,
          execution,
          reason: `Runtime cannot be inspected (${inspection.error.code})`,
        }
      if (
        inspection.state.runtime.id !== execution.runtime.id ||
        inspection.state.runtime.workerId !== command.executionOwner.workerId ||
        inspection.state.runtime.instanceId !== command.executionOwner.instanceId ||
        inspection.state.sessionId !== command.sessionId
      )
        return {
          kind: "uncertain" as const,
          execution,
          reason: "Runtime inspection belongs to another execution owner",
        }
      if (inspection.state.state === "idle" && inspection.state.activeTools === 0)
        return { kind: "missing" as const, execution }
      return {
        kind: "uncertain" as const,
        execution,
        reason: "Submission may be in flight or runtime ownership is unclear",
      }
    }

    if (!execution.runtime)
      return { kind: "uncertain" as const, execution, reason: "Durable input has no recorded runtime" }
    const inspection = yield* input.runtimes.inspect(execution).pipe(
      Effect.map((state) => ({ state }) as const),
      Effect.catch((error) => Effect.succeed({ error } as const)),
    )
    if ("error" in inspection)
      return { kind: "uncertain" as const, execution, reason: `Runtime cannot be inspected (${inspection.error.code})` }
    if (
      inspection.state.runtime.id !== execution.runtime.id ||
      inspection.state.runtime.workerId !== command.executionOwner.workerId ||
      inspection.state.runtime.instanceId !== command.executionOwner.instanceId ||
      inspection.state.sessionId !== command.sessionId
    )
      return { kind: "uncertain" as const, execution, reason: "Runtime inspection belongs to another execution owner" }
    if (inspection.state.state === "unknown") {
      // A promoted input can be replay-observed without waking provider work.
      // R3 may not yet know this Run owns the active drain until R5 restores its watcher.
      if (
        admitted.promotedSeq !== undefined &&
        (execution.phase === "recovery_required" || execution.phase === "admitted" || execution.phase === "prepared")
      )
        return { kind: "admitted" as const, execution, unpromoted: false }
      return { kind: "uncertain" as const, execution, reason: "Runtime cannot establish whether scoped work is active" }
    }
    if (admitted.promotedSeq === undefined) {
      if (inspection.state.state === "idle" && inspection.state.activeTools !== 0)
        return { kind: "uncertain" as const, execution, reason: "Scoped tools have not been proved idle before wake" }
      return { kind: "admitted" as const, execution, unpromoted: true }
    }
    if (
      inspection.state.state === "active" &&
      (execution.phase === "running" || execution.phase === "waiting_approval" || execution.phase === "cancelling")
    )
      return { kind: "running" as const, execution }
    if (execution.phase === "recovery_required" || execution.phase === "admitted" || execution.phase === "prepared")
      return { kind: "admitted" as const, execution, unpromoted: false }
    return {
      kind: "uncertain" as const,
      execution,
      reason: "Promoted input has no confirmed active or terminal execution",
    }
  })

  const hold = Effect.fn("RunnerRecovery.hold")(function* (assessment: Extract<Assessment, { kind: "uncertain" }>) {
    if (
      !assessment.execution ||
      terminal.has(assessment.execution.phase) ||
      assessment.execution.phase === "recovery_required"
    )
      return
    yield* input.lifecycle.transition({
      runId: assessment.execution.run.command.runId,
      expected: assessment.execution.phase,
      next: "recovery_required",
      callbacks: [],
    })
  })

  const reconcile: Recovery["reconcile"] = Effect.fn("RunnerRecovery.reconcile")(function* (messageId) {
    const assessment = yield* assess(messageId)
    if (assessment.kind === "missing") return "missing" as const
    if (assessment.kind === "admitted" || assessment.kind === "running") {
      if ((yield* input.reports.pending(assessment.execution.run.command.runId)).length > 0)
        yield* input.reports.flush(assessment.execution.run.command.runId)
      return assessment.kind
    }
    if (assessment.kind === "unreported") {
      yield* input.reports.flush(assessment.execution.run.command.runId)
      return "terminal" as const
    }
    if (assessment.kind === "terminal") return "terminal" as const
    yield* hold(assessment)
    return yield* Effect.fail({ code: "unavailable", message: assessment.reason } satisfies Failure)
  })

  const recoverOne = Effect.fn("RunnerRecovery.recoverOne")(function* (row: {
    readonly runId: typeof ExecutionTable.$inferSelect.run_id
    readonly messageId: string
  }) {
    const execution = yield* input.lifecycle.get(row.runId)
    if (!execution)
      return yield* Effect.fail({
        code: "unavailable",
        message: "Local Run vanished during recovery",
      } satisfies Failure)
    const pending = yield* input.reports.pending(row.runId)
    if (terminal.has(execution.phase) && pending.length === 0) return

    const assessment = yield* assess(row.messageId)
    if (assessment.kind === "uncertain") {
      yield* hold(assessment)
      const refreshed = yield* assess(row.messageId)
      if (refreshed.kind === "admitted" && !refreshed.unpromoted && refreshed.execution.phase === "recovery_required")
        yield* input.lifecycle.start(refreshed.execution.run.command)
      yield* Effect.logWarning("Runner recovery requires reconciliation", {
        runId: row.runId,
        reason: assessment.reason,
      })
      return
    }
    if (!assessment.execution || assessment.execution.run.command.runId !== row.runId)
      return yield* Effect.fail({ code: "unavailable", message: "Recovered Run identity changed" } satisfies Failure)
    if (assessment.execution.phase === "cancelling") {
      yield* input.cancellations.interrupt({
        runId: row.runId,
        sessionId: assessment.execution.run.command.sessionId,
      })
      if (pending.length > 0) yield* input.reports.flush(row.runId)
      return
    }
    if (assessment.kind === "missing" || assessment.kind === "admitted" || assessment.kind === "running") {
      const started = yield* input.lifecycle.start(assessment.execution.run.command).pipe(
        Effect.map(() => ({ accepted: true as const })),
        Effect.catch((error) => Effect.succeed({ accepted: false as const, error })),
      )
      // R5 can install the watcher yet leave an uncertain local phase occupied.
      // R3.wake independently refuses to run unless that exact watcher is installed.
      if (
        !started.accepted &&
        !(
          assessment.kind === "admitted" &&
          assessment.execution.phase === "recovery_required" &&
          started.error.code === "unavailable"
        )
      )
        return yield* Effect.fail(started.error)
    }
    if (assessment.kind === "admitted") {
      const refreshed = yield* assess(row.messageId)
      if (refreshed.kind === "admitted" && refreshed.unpromoted) yield* input.runtimes.wake(refreshed.execution)
      if (refreshed.kind === "uncertain") {
        yield* hold(refreshed)
        return
      }
    }
    if (pending.length > 0) yield* input.reports.flush(row.runId)
  })

  const recover: Recovery["recover"] = Effect.gen(function* () {
    const rows = yield* input.db
      .select({ runId: ExecutionTable.run_id, messageId: ExecutionTable.runner_message_id })
      .from(ExecutionTable)
      .orderBy(asc(ExecutionTable.created_at), asc(ExecutionTable.run_id))
      .all()
      .pipe(Effect.orDie)

    for (const row of rows) {
      yield* recoverOne(row).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Runner recovery could not finish a Run", { runId: row.runId, reason: error.message }),
        ),
      )
    }
  })

  return { reconcile, recover }
}
