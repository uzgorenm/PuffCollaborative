export * as RunnerHarnessContracts from "./contracts"

import type { Coordination } from "@opencode-ai/schema/coordination"
import type { Permission } from "@opencode-ai/schema/permission"
import type { Session } from "@opencode-ai/schema/session"
import type { Effect } from "effect"
import type { CoordinationContracts } from "../coordination/contracts"
import type { Database } from "../database/database"
import type { RunnerArtifacts } from "./artifacts"

export type Failure = CoordinationContracts.Failure
export type StartCommand = CoordinationContracts.RunnerCommand
export type InterruptCommand = Parameters<CoordinationContracts.RunnerPort["interrupt"]>[0]
export type ApprovalCommand = Parameters<CoordinationContracts.RunnerPort["resolveApproval"]>[0]
export type Reconciliation = "missing" | "admitted" | "running" | "terminal"
export type Transaction = Parameters<Parameters<Database.Interface["db"]["transaction"]>[0]>[0]

export type LocalPhase =
  | "accepted"
  | "prepared"
  | "admitted"
  | "running"
  | "waiting_approval"
  | "cancelling"
  | "recovery_required"
  | "completed"
  | "failed"
  | "cancelled"

/** Derived from coordinator records and OpenCode storage, never from browser input. */
export interface AuthorizedRun {
  readonly command: StartCommand
  readonly projectId: Coordination.ProjectID
  readonly attempt: number
  readonly session: Session.Info
}

export interface WorkspaceIdentity {
  readonly id: string
  readonly threadId: Coordination.ThreadID
  readonly projectId: Coordination.ProjectID
  readonly directory: string
}

export interface RuntimeIdentity {
  readonly id: string
  readonly workerId: Coordination.WorkerID
  readonly instanceId: string
}

export interface RuntimeHealth {
  readonly runtime: RuntimeIdentity
  readonly state: "starting" | "ready" | "failed" | "stopped"
  readonly checkedAt: number
  readonly reason?: string
}

export interface RuntimeInspection {
  readonly runtime: RuntimeIdentity
  readonly sessionId: Session.ID
  readonly state: "active" | "idle" | "unknown"
  readonly activeTools: number | "unknown"
  readonly checkedAt: number
}

export interface InterruptionResult {
  readonly runtime: RuntimeIdentity
  readonly sessionId: Session.ID
  /** Acknowledgment only confirms that the abort request reached the runtime. */
  readonly abort: "acknowledged" | "unknown" | "not_delivered"
  /** Stopped requires the exact drain and scoped tools to have settled. */
  readonly state: "stopped" | "already_idle" | "uncertain"
  readonly checkedAt: number
}

export interface LocalExecution {
  readonly run: AuthorizedRun
  readonly phase: LocalPhase
  readonly workspace?: WorkspaceIdentity
  readonly runtime?: RuntimeIdentity
  readonly admittedMessageId?: string
  readonly artifactBaseline?: RunnerArtifacts.Baseline
  readonly artifactReport?: RunnerArtifacts.Report
}

export interface CallbackDraft {
  readonly runId: Coordination.RunID
  /** Stable producer/event identity, unique within this Run. */
  readonly producerKey: string
  readonly callback: CoordinationContracts.RunnerCallback
  readonly sourceSessionSeq?: number
}

export interface CallbackIntent extends CallbackDraft {
  readonly callbackId: string
  readonly ordinal: number
  readonly acknowledgedAt?: number
}

export type Observation =
  | {
      readonly kind: "activity"
      readonly runId: Coordination.RunID
      readonly sourceKey: string
      readonly sourceSessionSeq?: number
      readonly activity: Coordination.RunnerActivity
    }
  | {
      readonly kind: "permission"
      readonly runId: Coordination.RunID
      readonly sourceKey: string
      readonly request: Permission.Request
    }
  | {
      readonly kind: "promoted" | "settled" | "failed"
      readonly runId: Coordination.RunID
      readonly sourceKey: string
      readonly sourceSessionSeq?: number
      readonly messageId: string
    }

export interface ApprovalMapping {
  readonly runId: Coordination.RunID
  readonly sessionId: Session.ID
  readonly permissionRequestId: Permission.ID
  readonly toolCallId: string
  readonly toolName: string
  /** Bounded, redacted action detail suitable for coordinator activity. */
  readonly summary: string
  readonly approvalId: string
  readonly decisionId?: string
  readonly decision?: "approve" | "reject"
  readonly delivery: "pending" | "delivered" | "unknown" | "invalidated"
}

export interface ApprovalResult {
  readonly mapping: ApprovalMapping
  readonly decisionId: string
  readonly nativeReply: "once" | "reject"
  readonly delivery: "delivered" | "unknown"
}

export interface SessionBinding {
  /** Check the exact command against trusted coordinator Run, Instruction, Thread, and Session records. */
  readonly authorize: (command: StartCommand) => Effect.Effect<AuthorizedRun, Failure>
  /** Verify that the already bound Session still belongs to the persistent Thread workspace. */
  readonly attach: (input: {
    readonly run: AuthorizedRun
    readonly workspace: WorkspaceIdentity
    readonly runtime: RuntimeIdentity
  }) => Effect.Effect<Session.Info, Failure>
  readonly coordinator: CoordinationContracts.SessionBinding
}

export interface Workspaces {
  readonly ensure: (run: AuthorizedRun) => Effect.Effect<WorkspaceIdentity, Failure>
}

export interface Runtimes {
  /** Attach to the pinned embedded runtime under the verified worker instance. */
  readonly ensure: (input: {
    readonly run: AuthorizedRun
    readonly workspace: WorkspaceIdentity
    readonly readinessTimeoutMs: number
  }) => Effect.Effect<RuntimeIdentity, Failure>
  readonly health: (runtime: RuntimeIdentity) => Effect.Effect<RuntimeHealth, Failure>
  /** Register a replaying observer under the process-owned runtime scope and return after registration. */
  readonly watch: (input: {
    readonly execution: LocalExecution
    readonly session: Session.Info
    readonly readinessTimeoutMs: number
    /** R6 signals readiness after listener registration and durable replay. */
    readonly observe: (onReady: Effect.Effect<void>) => Effect.Effect<void, Failure>
  }) => Effect.Effect<void, Failure>
  readonly wake: (execution: LocalExecution) => Effect.Effect<void, Failure>
  readonly inspect: (execution: LocalExecution) => Effect.Effect<RuntimeInspection, Failure>
  /** Wait for this Run's drain and scoped tools to settle before terminal reporting. */
  readonly awaitIdle: (execution: LocalExecution, timeoutMs: number) => Effect.Effect<RuntimeInspection, Failure>
  readonly interrupt: (execution: LocalExecution) => Effect.Effect<InterruptionResult, Failure>
  /** Start the scoped callback-delivery tick only after R10 recovery has completed. */
  readonly startDelivery: (input: {
    readonly drainDue: (limit: number) => Effect.Effect<number, Failure>
    readonly batchSize: number
    readonly intervalMs: number
  }) => Effect.Effect<void, Failure>
  readonly shutdown: (runtime: RuntimeIdentity) => Effect.Effect<void, Failure>
}

/** R5 is the only writer of local execution phases and owns turn orchestration. */
export interface Lifecycle {
  readonly start: (command: StartCommand) => Effect.Effect<{ readonly messageId: string }, Failure>
  readonly accept: (run: AuthorizedRun) => Effect.Effect<LocalExecution, Failure>
  readonly prepared: (input: {
    readonly runId: Coordination.RunID
    readonly workspace: WorkspaceIdentity
    readonly runtime: RuntimeIdentity
    readonly sessionId: Session.ID
    readonly artifactBaseline: RunnerArtifacts.Baseline
  }) => Effect.Effect<LocalExecution, Failure>
  readonly admitted: (input: {
    readonly runId: Coordination.RunID
    readonly messageId: string
  }) => Effect.Effect<LocalExecution, Failure>
  readonly transition: (input: {
    readonly runId: Coordination.RunID
    readonly expected: LocalPhase
    readonly next: LocalPhase
    readonly callbacks: ReadonlyArray<CallbackDraft>
    readonly artifactReport?: RunnerArtifacts.Report
  }) => Effect.Effect<LocalExecution, Failure>
  readonly approvalRequested: (mapping: ApprovalMapping) => Effect.Effect<LocalExecution, Failure>
  readonly approvalResolved: (result: ApprovalResult) => Effect.Effect<LocalExecution, Failure>
  readonly cancellationRequested: (runId: Coordination.RunID) => Effect.Effect<LocalExecution, Failure>
  readonly cancellationObserved: (input: {
    readonly runId: Coordination.RunID
    readonly result: InterruptionResult
  }) => Effect.Effect<LocalExecution, Failure>
  /** Rebind a persisted active Run to this process's verified runtime without changing its phase. */
  readonly reattach: (runId: Coordination.RunID) => Effect.Effect<LocalExecution, Failure>
  readonly runtimeFailed: (input: {
    readonly runId: Coordination.RunID
    readonly runtime: RuntimeIdentity
    readonly reason: string
  }) => Effect.Effect<LocalExecution, Failure>
  readonly get: (runId: Coordination.RunID) => Effect.Effect<LocalExecution | undefined, Failure>
  readonly byMessageId: (messageId: string) => Effect.Effect<LocalExecution | undefined, Failure>
}

export interface EventIngestion {
  /** Attach before prompt admission, then replay and correlate only this Run's events. */
  readonly observe: (input: {
    readonly execution: LocalExecution
    readonly session: Session.Info
    readonly onObservation: (observation: Observation) => Effect.Effect<void, Failure>
    readonly onReady?: Effect.Effect<void>
  }) => Effect.Effect<void, Failure>
}

export interface ReportDelivery {
  /** R5 calls this inside its phase-change SQLite transaction. R7 assigns ordinals and callback IDs. */
  readonly append: (tx: Transaction, drafts: ReadonlyArray<CallbackDraft>) => Effect.Effect<ReadonlyArray<CallbackIntent>, Failure>
  readonly flush: (runId: Coordination.RunID) => Effect.Effect<void, Failure>
  readonly pending: (runId: Coordination.RunID) => Effect.Effect<ReadonlyArray<CallbackIntent>, Failure>
  /** Discover and retry eligible per-Run heads after restart with a bounded read. */
  readonly drainDue: (limit: number) => Effect.Effect<number, Failure>
  readonly diagnostics: Effect.Effect<{ readonly pending: number; readonly failed: number }, Failure>
}

export interface Approvals {
  readonly requested: (input: {
    readonly execution: LocalExecution
    readonly request: Permission.Request
  }) => Effect.Effect<ApprovalMapping, Failure>
  readonly resolve: (command: ApprovalCommand) => Effect.Effect<void, Failure>
  readonly get: (approvalId: string) => Effect.Effect<ApprovalMapping | undefined, Failure>
  readonly invalidate: (input: {
    readonly runId: Coordination.RunID
    readonly reason: "cancelled" | "terminal" | "native_request_missing"
  }) => Effect.Effect<void, Failure>
}

/** Read-only coordinator decision verification before R8 replies to a native permission. */
export interface ApprovalAuthority {
  readonly verifyDecision: (command: ApprovalCommand) => Effect.Effect<Coordination.Approval, Failure>
}

export interface Cancellations {
  readonly interrupt: (command: InterruptCommand) => Effect.Effect<void, Failure>
}

export interface Recovery {
  readonly reconcile: (messageId: string) => Effect.Effect<Reconciliation, Failure>
  readonly recover: Effect.Effect<void, Failure>
}

export type Artifacts = RunnerArtifacts.Interface

export interface Credentials {
  readonly verify: (owner: Coordination.ExecutionOwner) => Effect.Effect<void, Failure>
  readonly principal: (owner: Coordination.ExecutionOwner) => Effect.Effect<Extract<Coordination.AuthContext, { kind: "runner" }>, Failure>
}

export interface SecurityPolicy {
  readonly workspace: (input: { readonly run: AuthorizedRun; readonly workspace: WorkspaceIdentity }) => Effect.Effect<void, Failure>
  readonly runtimeAccess: (input: {
    readonly principal: Coordination.AuthContext
    readonly sessionId: Session.ID
    readonly action: "prompt" | "interrupt" | "permission" | "read"
  }) => Effect.Effect<void, Failure>
  readonly toolEnvironment: (execution: LocalExecution) => Effect.Effect<Readonly<Record<string, string>>, Failure>
  readonly artifact: (input: {
    readonly execution: LocalExecution
    readonly path: string
    readonly ref?: string
  }) => Effect.Effect<{ readonly ref?: string } | undefined, Failure>
  readonly redact: (text: string) => string
}

export interface CoordinatorCallbacks {
  readonly report: CoordinationContracts.Runner["report"]
}
