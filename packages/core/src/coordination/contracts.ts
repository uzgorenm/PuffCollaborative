export * as CoordinationContracts from "./contracts"

import type { Coordination } from "@opencode-ai/schema/coordination"
import type { Effect, Stream } from "effect"

export type ErrorCode = "invalid" | "unauthorized" | "forbidden" | "not_found" | "conflict" | "unavailable"
export type Failure = { readonly code: ErrorCode; readonly message: string }
export type Action = "read" | "submit" | "cancel" | "approve" | "runner" | "update_work_card"

export interface Access {
  readonly authorize: (
    principal: Coordination.Principal,
    projectId: Coordination.ProjectID,
    threadId: Coordination.ThreadID | undefined,
    action: Action,
  ) => Effect.Effect<void, Failure>
  readonly getThread: (
    principal: Coordination.Principal,
    threadId: Coordination.ThreadID,
    action: Action,
  ) => Effect.Effect<Coordination.Thread, Failure>
  readonly snapshot: (
    principal: Coordination.Principal,
    threadId: Coordination.ThreadID,
  ) => Effect.Effect<ThreadSnapshot, Failure>
}

export interface ThreadSnapshot {
  readonly thread: Coordination.Thread
  readonly instructions: ReadonlyArray<Coordination.InstructionRequest>
  readonly runs: ReadonlyArray<Coordination.Run>
  readonly approvals: ReadonlyArray<Coordination.Approval>
  readonly workCard: Coordination.WorkCard | undefined
  readonly cursor: number
}

export interface Events {
  readonly append: (
    input: Omit<Coordination.Event, "id" | "seq"> & { readonly id?: string },
    project: (seq: number) => Effect.Effect<void>,
  ) => Effect.Effect<Coordination.Event, Failure>
  readonly replayProject: (
    projectId: Coordination.ProjectID,
    after: number,
    limit: number,
  ) => Effect.Effect<ReplayPage, Failure>
  readonly latestSequence: (projectId: Coordination.ProjectID) => Effect.Effect<number, Failure>
  readonly replayThread: (
    threadId: Coordination.ThreadID,
    after: number,
    limit: number,
  ) => Effect.Effect<ReplayPage, Failure>
  readonly subscribeProject: (
    projectId: Coordination.ProjectID,
    after: number,
  ) => Stream.Stream<Coordination.Event, Failure>
  readonly subscribeThread: (
    threadId: Coordination.ThreadID,
    after: number,
  ) => Stream.Stream<Coordination.Event, Failure>
}

export interface ReplayPage {
  readonly events: ReadonlyArray<Coordination.Event>
  readonly cursor: number
  readonly hasMore: boolean
}

export interface Queue {
  readonly submit: (input: {
    readonly principal: Coordination.Principal
    readonly threadId: Coordination.ThreadID
    readonly requestId: string
    readonly text: string
  }) => Effect.Effect<{ readonly instruction: Coordination.InstructionRequest; readonly run: Coordination.Run }, Failure>
  readonly cancel: (input: {
    readonly principal: Coordination.Principal
    readonly threadId: Coordination.ThreadID
    readonly instructionId: Coordination.InstructionID
  }) => Effect.Effect<Coordination.Run, Failure>
  readonly reserveNext: (input: {
    readonly principal: Coordination.Principal
    readonly threadId: Coordination.ThreadID
    readonly executionOwner: Coordination.ExecutionOwner
    readonly leaseUntil: string
  }) => Effect.Effect<
    { readonly instruction: Coordination.InstructionRequest; readonly run: Coordination.Run } | undefined,
    Failure
  >
  readonly transition: (input: {
    readonly principal: Coordination.Principal
    readonly runId: Coordination.RunID
    readonly callbackId: string
    readonly callback: RunnerCallback
  }) => Effect.Effect<Coordination.Run, Failure>
  readonly pending: (
    executionOwner: Coordination.ExecutionOwner,
  ) => Effect.Effect<
    ReadonlyArray<{
      readonly thread: Coordination.Thread
      readonly instruction: Coordination.InstructionRequest
      readonly run: Coordination.Run
    }>,
    Failure
  >
  readonly getRun: (runId: Coordination.RunID) => Effect.Effect<Coordination.Run | undefined, Failure>
}

export interface RunnerCommand {
  readonly runId: Coordination.RunID
  readonly threadId: Coordination.ThreadID
  readonly sessionId: Coordination.Thread["sessionId"]
  readonly executionOwner: Coordination.ExecutionOwner
  readonly runnerMessageId: string
  readonly text: string
}

export type RunnerCallback =
  | {
      readonly kind: "state"
      readonly expectedState: Coordination.RunState
      readonly nextState: Coordination.RunState
      readonly approvalId?: string
    }
  | {
      readonly kind: "activity"
      readonly state: "running" | "waiting_approval"
      readonly activity: Coordination.RunnerActivity
    }

export interface RunnerPort {
  readonly start: (command: RunnerCommand) => Effect.Effect<{ readonly messageId: string }, Failure>
  readonly interrupt: (command: { readonly runId: Coordination.RunID; readonly sessionId: Coordination.Thread["sessionId"] }) => Effect.Effect<void, Failure>
  readonly resolveApproval: (command: {
    readonly approvalId: string
    readonly decisionId: string
    readonly runId: Coordination.RunID
    readonly sessionId: Coordination.Thread["sessionId"]
    readonly decision: "approve" | "reject"
  }) => Effect.Effect<void, Failure>
  readonly reconcile: (runnerMessageId: string) => Effect.Effect<"missing" | "admitted" | "running" | "terminal", Failure>
}

export interface Runner {
  readonly claim: (
    principal: Coordination.Principal,
    threadId: Coordination.ThreadID,
    executionOwner: Coordination.ExecutionOwner,
  ) => Effect.Effect<Coordination.Run | undefined, Failure>
  readonly report: (input: {
    readonly principal: Coordination.Principal
    readonly runId: Coordination.RunID
    readonly callbackId: string
    readonly callback: RunnerCallback
  }) => Effect.Effect<Coordination.Run, Failure>
  readonly cancel: (input: {
    readonly principal: Coordination.Principal
    readonly threadId: Coordination.ThreadID
    readonly instructionId: Coordination.InstructionID
  }) => Effect.Effect<Coordination.Run, Failure>
  readonly claimApproval: (input: {
    readonly principal: Coordination.Principal
    readonly threadId: Coordination.ThreadID
    readonly approvalId: string
    readonly expectedVersion: number
  }) => Effect.Effect<Coordination.Approval, Failure>
  readonly decideApproval: (input: {
    readonly principal: Coordination.Principal
    readonly threadId: Coordination.ThreadID
    readonly approvalId: string
    readonly expectedVersion: number
    readonly decisionId: string
    readonly decision: "approve" | "reject"
  }) => Effect.Effect<Coordination.Approval, Failure>
  readonly recoverPending: (
    executionOwner: Coordination.ExecutionOwner,
  ) => Effect.Effect<ReadonlyArray<Coordination.Run>, Failure>
}

export interface WorkCards {
  readonly get: (threadId: Coordination.ThreadID) => Effect.Effect<Coordination.WorkCard | undefined, Failure>
  readonly update: (input: {
    readonly principal: Coordination.Principal
    readonly threadId: Coordination.ThreadID
    readonly expectedVersion: number
    readonly sourceActivitySeq: number
    readonly card: Pick<Coordination.WorkCard, "currentTask" | "progress" | "blockers" | "status" | "summaryJobId">
  }) => Effect.Effect<Coordination.WorkCard, Failure>
}
