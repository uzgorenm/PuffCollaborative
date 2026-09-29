export * as RunnerAdapter from "./adapter"

import { Effect } from "effect"
import type { Coordination } from "@opencode-ai/schema/coordination"
import type { CoordinationContracts } from "../contracts"

export interface ApprovalStore {
  readonly list: (
    threadId: Coordination.ThreadID,
  ) => Effect.Effect<ReadonlyArray<Coordination.Approval>, CoordinationContracts.Failure>
  readonly requested: (input: {
    readonly thread: Coordination.Thread
    readonly run: Coordination.Run
    readonly approvalId: string
    readonly toolCallId: string
    readonly seq: number
  }) => Effect.Effect<void, CoordinationContracts.Failure>
  readonly claim: (
    input: Parameters<CoordinationContracts.Runner["claimApproval"]>[0],
  ) => Effect.Effect<Coordination.Approval, CoordinationContracts.Failure>
  readonly decide: (
    input: Parameters<CoordinationContracts.Runner["decideApproval"]>[0],
  ) => Effect.Effect<Coordination.Approval, CoordinationContracts.Failure>
  readonly markDelivered: (
    approvalId: string,
    decisionId: string,
  ) => Effect.Effect<Coordination.Approval, CoordinationContracts.Failure>
  readonly pendingDecisions: (
    executionOwner: Coordination.ExecutionOwner,
  ) => Effect.Effect<
    ReadonlyArray<{ readonly thread: Coordination.Thread; readonly approval: Coordination.Approval }>,
    CoordinationContracts.Failure
  >
}

export interface Dependencies {
  readonly access: CoordinationContracts.Access
  readonly queue: CoordinationContracts.Queue
  readonly port: CoordinationContracts.RunnerPort
  readonly approvals: ApprovalStore
  readonly now?: () => number
  readonly leaseMs?: number
}

export function make(input: Dependencies): CoordinationContracts.Runner {
  const now = input.now ?? Date.now
  const leaseMs = input.leaseMs ?? 60_000

  const claim: CoordinationContracts.Runner["claim"] = (principal, threadId, executionOwner) =>
    Effect.gen(function* () {
      const identityError = requireRunner(principal, executionOwner)
      if (identityError) return yield* Effect.fail(identityError)
      const thread = yield* input.access.getThread(principal, threadId, "runner")
      if (thread.workerId !== executionOwner.workerId)
        return yield* Effect.fail(conflict("Thread belongs to another worker"))
      const reserved = yield* input.queue.reserveNext({
        principal,
        threadId,
        executionOwner,
        leaseUntil: new Date(now() + leaseMs).toISOString(),
      })
      if (!reserved) return undefined
      const reservationError = validateDelivery(reserved, thread, executionOwner)
      if (reservationError) return yield* Effect.fail(reservationError)
      if (reserved.run.state !== "reserved") return yield* Effect.fail(conflict("Run is not reserved for delivery"))
      yield* deliver(input.port, {
        runId: reserved.run.id,
        threadId,
        sessionId: thread.sessionId,
        executionOwner,
        runnerMessageId: reserved.run.runnerMessageId,
        text: reserved.instruction.text,
      })
      return reserved.run
    })

  const report: CoordinationContracts.Runner["report"] = ({ principal, runId, callbackId, callback }) =>
    Effect.gen(function* () {
      if (principal.kind !== "runner") return yield* Effect.fail(forbidden("Runner credential required"))
      const run = yield* input.queue.getRun(runId)
      if (!run) return yield* Effect.fail({ code: "not_found" as const, message: "Run not found" })
      if (!owns(run, principal)) return yield* Effect.fail(forbidden("Runner does not own this execution"))
      const thread = yield* input.access.getThread(principal, run.threadId, "runner")
      if (thread.workerId !== principal.workerId)
        return yield* Effect.fail(forbidden("Thread belongs to another worker"))
      if (callback.kind === "activity") yield* validateActivity(callback.activity)
      if (
        callback.kind === "state" &&
        callback.nextState === "waiting_approval" &&
        (!callback.approvalId || !callback.toolCallId)
      )
        return yield* Effect.fail({ code: "invalid" as const, message: "Approval ID and tool call ID are required" })
      return yield* input.queue.transition({
        principal,
        runId,
        callbackId,
        callback,
        commitApproval:
          callback.kind === "state" &&
          callback.nextState === "waiting_approval" &&
          callback.approvalId &&
          callback.toolCallId
            ? (seq) =>
                input.approvals.requested({
                  thread,
                  run,
                  approvalId: callback.approvalId!,
                  toolCallId: callback.toolCallId!,
                  seq,
                })
            : undefined,
      })
    })

  const cancel: CoordinationContracts.Runner["cancel"] = ({ principal, threadId, instructionId }) =>
    Effect.gen(function* () {
      if (principal.kind !== "member") return yield* Effect.fail(forbidden("Member credential required"))
      const thread = yield* input.access.getThread(principal, threadId, "cancel")
      const run = yield* input.queue.cancel({ principal, threadId, instructionId })
      // Queue.cancel commits the cancellation request first. A failed interrupt leaves the
      // reservation occupied until the runner confirms termination or recovery reconciles it.
      if (run.state === "cancelling") yield* input.port.interrupt({ runId: run.id, sessionId: thread.sessionId })
      return run
    })

  const claimApproval: CoordinationContracts.Runner["claimApproval"] = (request) =>
    Effect.gen(function* () {
      if (request.principal.kind !== "member") return yield* Effect.fail(forbidden("Member credential required"))
      yield* input.access.getThread(request.principal, request.threadId, "approve")
      return yield* input.approvals.claim(request)
    })

  const decideApproval: CoordinationContracts.Runner["decideApproval"] = (request) =>
    Effect.gen(function* () {
      if (request.principal.kind !== "member") return yield* Effect.fail(forbidden("Member credential required"))
      const thread = yield* input.access.getThread(request.principal, request.threadId, "approve")
      const approval = yield* input.approvals.decide(request)
      if (approval.deliveryState === "delivered") return approval
      yield* input.port.resolveApproval({
        approvalId: approval.id,
        decisionId: request.decisionId,
        runId: approval.runId,
        sessionId: thread.sessionId,
        decision: request.decision,
      })
      return yield* input.approvals.markDelivered(approval.id, request.decisionId)
    })

  const recoverPending: CoordinationContracts.Runner["recoverPending"] = (executionOwner) =>
    Effect.gen(function* () {
      const pending = yield* input.queue.pending(executionOwner)
      for (const item of pending) {
        const reservationError = validateDelivery(item, item.thread, executionOwner)
        if (reservationError) return yield* Effect.fail(reservationError)
        const status = yield* input.port.reconcile(item.run.runnerMessageId)
        if (item.run.state === "reserved" && status === "missing")
          yield* deliver(input.port, {
            runId: item.run.id,
            threadId: item.thread.id,
            sessionId: item.thread.sessionId,
            executionOwner,
            runnerMessageId: item.run.runnerMessageId,
            text: item.instruction.text,
          })
        if (item.run.state === "cancelling" && status !== "terminal")
          yield* input.port.interrupt({ runId: item.run.id, sessionId: item.thread.sessionId })
        // Other active states remain occupied. Reconciliation alone cannot prove termination.
      }
      const approvals = yield* input.approvals.pendingDecisions(executionOwner)
      for (const item of approvals) {
        if (!item.approval.decisionId || !item.approval.decision)
          return yield* Effect.fail(conflict("Pending approval has no decision"))
        yield* input.port.resolveApproval({
          approvalId: item.approval.id,
          decisionId: item.approval.decisionId,
          runId: item.approval.runId,
          sessionId: item.thread.sessionId,
          decision: item.approval.decision,
        })
        yield* input.approvals.markDelivered(item.approval.id, item.approval.decisionId)
      }
      return pending.map((item) => item.run)
    })

  return { approvals: input.approvals.list, claim, report, cancel, claimApproval, decideApproval, recoverPending }
}

function validateDelivery(
  item: { readonly run: Coordination.Run; readonly instruction: Coordination.InstructionRequest },
  thread: Coordination.Thread,
  executionOwner: Coordination.ExecutionOwner,
) {
  if (item.run.threadId !== thread.id || item.instruction.threadId !== thread.id)
    return conflict("Reservation thread mismatch")
  if (item.run.instructionId !== item.instruction.id || item.instruction.runId !== item.run.id)
    return conflict("Reservation instruction mismatch")
  if (!item.run.executionOwner || !sameOwner(item.run.executionOwner, executionOwner))
    return forbidden("Run belongs to another execution owner")
  if (thread.workerId !== executionOwner.workerId) return forbidden("Thread belongs to another worker")
}

function requireRunner(principal: Coordination.AuthContext, executionOwner: Coordination.ExecutionOwner) {
  if (principal.kind !== "runner" || !sameOwner(principal, executionOwner))
    return forbidden("Runner credential does not match execution owner")
}

function owns(run: Coordination.Run, principal: Extract<Coordination.AuthContext, { kind: "runner" }>) {
  return run.executionOwner !== undefined && sameOwner(run.executionOwner, principal)
}

function sameOwner(left: Coordination.ExecutionOwner, right: Coordination.ExecutionOwner) {
  return left.workerId === right.workerId && left.instanceId === right.instanceId
}

function deliver(port: CoordinationContracts.RunnerPort, command: CoordinationContracts.RunnerCommand) {
  return Effect.gen(function* () {
    const started = yield* port.start(command)
    if (started.messageId !== command.runnerMessageId)
      return yield* Effect.fail(conflict("Runner returned a different message ID"))
  })
}

function validateActivity(activity: Coordination.RunnerActivity) {
  const values =
    activity.kind === "run.tool"
      ? [activity.toolName, activity.summary]
      : activity.kind === "run.output"
        ? [activity.text]
        : activity.kind === "run.workspace"
          ? [activity.workspaceId, activity.ref]
          : [activity.ref, activity.summary]
  if (values.some((value) => value !== undefined && value.length > 8_000))
    return Effect.fail({ code: "invalid" as const, message: "Runner activity text exceeds 8,000 characters" })
  return Effect.void
}

function conflict(message: string): CoordinationContracts.Failure {
  return { code: "conflict", message }
}

function forbidden(message: string): CoordinationContracts.Failure {
  return { code: "forbidden", message }
}
