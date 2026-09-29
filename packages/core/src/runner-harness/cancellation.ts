export * as RunnerCancellation from "./cancellation"

import { Effect, Result } from "effect"
import { RunnerHarnessContracts } from "./contracts"

export interface Dependencies {
  readonly sessions: Pick<RunnerHarnessContracts.SessionBinding, "authorize">
  readonly credentials: Pick<RunnerHarnessContracts.Credentials, "verify">
  readonly lifecycle: Pick<
    RunnerHarnessContracts.Lifecycle,
    "get" | "cancellationRequested" | "cancellationObserved" | "transition"
  >
  readonly runtimes: Pick<RunnerHarnessContracts.Runtimes, "interrupt" | "inspect">
  readonly approvals: Pick<RunnerHarnessContracts.Approvals, "invalidate">
  readonly reports: Pick<RunnerHarnessContracts.ReportDelivery, "flush">
}

const terminal = (phase: RunnerHarnessContracts.LocalPhase) =>
  phase === "completed" || phase === "failed" || phase === "cancelled"

export function make(input: Dependencies): RunnerHarnessContracts.Cancellations {
  const interrupt = Effect.fn("RunnerCancellation.interrupt")(function* (
    command: RunnerHarnessContracts.InterruptCommand,
  ) {
    const current = yield* input.lifecycle.get(command.runId)
    if (!current)
      return yield* Effect.fail({
        code: "unavailable" as const,
        message: "Cancellation requires reconciliation: local execution is missing",
      })

    const stored = current.run.command
    if (
      stored.runId !== command.runId ||
      stored.sessionId !== command.sessionId ||
      current.run.session.id !== command.sessionId ||
      (current.workspace &&
        (current.workspace.threadId !== stored.threadId || current.workspace.projectId !== current.run.projectId)) ||
      (current.runtime &&
        (current.runtime.workerId !== stored.executionOwner.workerId ||
          current.runtime.instanceId !== stored.executionOwner.instanceId))
    )
      return yield* Effect.fail({ code: "conflict" as const, message: "Cancellation scope does not match the Run" })

    yield* input.credentials.verify(stored.executionOwner)
    const authorized = yield* input.sessions.authorize(stored)
    if (
      authorized.projectId !== current.run.projectId ||
      authorized.session.id !== command.sessionId ||
      authorized.command.runId !== stored.runId ||
      authorized.command.threadId !== stored.threadId ||
      authorized.command.sessionId !== stored.sessionId ||
      authorized.command.runnerMessageId !== stored.runnerMessageId ||
      authorized.command.text !== stored.text ||
      authorized.command.executionOwner.workerId !== stored.executionOwner.workerId ||
      authorized.command.executionOwner.instanceId !== stored.executionOwner.instanceId
    )
      return yield* Effect.fail({ code: "conflict" as const, message: "Trusted Run binding changed" })

    if (terminal(current.phase) || current.phase === "recovery_required") return undefined
    const cancelling = yield* input.lifecycle.cancellationRequested(command.runId)
    if (terminal(cancelling.phase) || cancelling.phase === "recovery_required") return undefined
    if (cancelling.phase !== "cancelling")
      return yield* Effect.fail({ code: "conflict" as const, message: "Run did not enter cancelling" })

    const result = cancelling.runtime ? yield* Effect.result(input.runtimes.interrupt(cancelling)) : undefined
    const observed =
      result && Result.isSuccess(result)
        ? yield* Effect.result(input.lifecycle.cancellationObserved({ runId: command.runId, result: result.success }))
        : undefined
    const inspection = cancelling.runtime ? yield* Effect.result(input.runtimes.inspect(cancelling)) : undefined
    const latest = yield* input.lifecycle.get(command.runId)
    if (!latest)
      return yield* Effect.fail({
        code: "unavailable" as const,
        message: "Local execution disappeared during cancellation",
      })
    if (terminal(latest.phase) || latest.phase === "recovery_required") return undefined
    if (latest.phase !== "cancelling")
      return yield* Effect.fail({ code: "conflict" as const, message: "Run changed during cancellation" })

    const stopped =
      !!latest.runtime &&
      !!result &&
      Result.isSuccess(result) &&
      result.success.abort === "acknowledged" &&
      result.success.state === "stopped" &&
      result.success.sessionId === command.sessionId &&
      result.success.runtime.id === latest.runtime.id &&
      result.success.runtime.workerId === latest.runtime.workerId &&
      result.success.runtime.instanceId === latest.runtime.instanceId &&
      !!observed &&
      Result.isSuccess(observed) &&
      !!inspection &&
      Result.isSuccess(inspection) &&
      inspection.success.sessionId === command.sessionId &&
      inspection.success.runtime.id === latest.runtime.id &&
      inspection.success.runtime.workerId === latest.runtime.workerId &&
      inspection.success.runtime.instanceId === latest.runtime.instanceId &&
      inspection.success.checkedAt >= result.success.checkedAt &&
      inspection.success.state === "idle" &&
      inspection.success.activeTools === 0
    const invalidated = stopped
      ? yield* Effect.result(input.approvals.invalidate({ runId: command.runId, reason: "cancelled" }))
      : undefined
    const next = stopped && invalidated && Result.isSuccess(invalidated) ? "cancelled" : "recovery_required"
    const changed = yield* Effect.result(
      input.lifecycle.transition({
        runId: command.runId,
        expected: "cancelling",
        next,
        callbacks: [
          {
            runId: command.runId,
            producerKey: next === "cancelled" ? "cancellation.confirmed" : "cancellation.uncertain",
            callback: { kind: "state", expectedState: "cancelling", nextState: next },
          },
        ],
      }),
    )
    if (Result.isFailure(changed)) {
      const after = yield* input.lifecycle.get(command.runId)
      if (after && (terminal(after.phase) || after.phase === "recovery_required")) return undefined
      return yield* Effect.fail(changed.failure)
    }
    // The callback is durable at this point; a lost delivery response leaves it for R7's retry loop.
    yield* input.reports.flush(command.runId).pipe(Effect.ignore)
    return undefined
  })

  return { interrupt }
}
