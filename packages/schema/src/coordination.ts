export * as Coordination from "./coordination"

import { Schema } from "effect"
import { Project } from "./project"
import { Session } from "./session"

export const ProjectID = Project.ID
export type ProjectID = Project.ID
export const UserID = Schema.String.pipe(Schema.brand("Coordination.UserID"))
export type UserID = typeof UserID.Type
export const WorkerID = Schema.String.pipe(Schema.brand("Coordination.WorkerID"))
export type WorkerID = typeof WorkerID.Type
export const ThreadID = Schema.String.pipe(Schema.brand("Coordination.ThreadID"))
export type ThreadID = typeof ThreadID.Type
export const InstructionID = Schema.String.pipe(Schema.brand("Coordination.InstructionID"))
export type InstructionID = typeof InstructionID.Type
export const RunID = Schema.String.pipe(Schema.brand("Coordination.RunID"))
export type RunID = typeof RunID.Type
export const WorkCardID = Schema.String.pipe(Schema.brand("Coordination.WorkCardID"))
export type WorkCardID = typeof WorkCardID.Type

export const RunState = Schema.Literals([
  "queued",
  "reserved",
  "running",
  "waiting_approval",
  "cancelling",
  "recovery_required",
  "completed",
  "failed",
  "cancelled",
])
export type RunState = typeof RunState.Type

export const EventKind = Schema.Literals([
  "thread.created",
  "instruction.submitted",
  "instruction.cancelled",
  "run.reserved",
  "run.started",
  "run.tool",
  "run.output",
  "run.workspace",
  "run.diff",
  "run.approval.requested",
  "run.approval.resolved",
  "run.cancel.requested",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "run.recovery.required",
  "work-card.updated",
])
export type EventKind = typeof EventKind.Type

export const RunnerActivity = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("run.tool"),
    toolName: Schema.String,
    status: Schema.Literals(["started", "completed", "failed"]),
    summary: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("run.output"),
    text: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("run.workspace"),
    workspaceId: Schema.String,
    ref: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("run.diff"),
    ref: Schema.String,
    summary: Schema.optional(Schema.String),
  }),
]).annotate({ identifier: "Coordination.RunnerActivity" })
export type RunnerActivity = typeof RunnerActivity.Type

export const Thread = Schema.Struct({
  id: ThreadID,
  projectId: ProjectID,
  sessionId: Session.ID,
  workerId: WorkerID,
  title: Schema.String,
  createdBy: UserID,
  createdAt: Schema.String,
  activitySeq: Schema.Int,
}).annotate({ identifier: "Coordination.Thread" })
export type Thread = typeof Thread.Type

export const InstructionRequest = Schema.Struct({
  id: InstructionID,
  requestId: Schema.String,
  threadId: ThreadID,
  actorId: UserID,
  text: Schema.String,
  queueSeq: Schema.Int,
  submittedAt: Schema.String,
  runId: RunID,
}).annotate({ identifier: "Coordination.InstructionRequest" })
export type InstructionRequest = typeof InstructionRequest.Type

export const ExecutionOwner = Schema.Struct({
  workerId: WorkerID,
  instanceId: Schema.String,
}).annotate({ identifier: "Coordination.ExecutionOwner" })
export type ExecutionOwner = typeof ExecutionOwner.Type

export const Run = Schema.Struct({
  id: RunID,
  threadId: ThreadID,
  instructionId: InstructionID,
  state: RunState,
  attempt: Schema.Int,
  runnerMessageId: Schema.String,
  executionOwner: Schema.optional(ExecutionOwner),
  leaseUntil: Schema.optional(Schema.String),
  createdAt: Schema.String,
  startedAt: Schema.optional(Schema.String),
  endedAt: Schema.optional(Schema.String),
}).annotate({ identifier: "Coordination.Run" })
export type Run = typeof Run.Type

export const Approval = Schema.Struct({
  id: Schema.String,
  threadId: ThreadID,
  runId: RunID,
  toolCallId: Schema.String,
  version: Schema.Int,
  state: Schema.Literals(["pending", "claimed", "approved", "rejected"]),
  requestedAt: Schema.String,
  claimedBy: Schema.optional(UserID),
  claimExpiresAt: Schema.optional(Schema.String),
  decidedBy: Schema.optional(UserID),
  decidedAt: Schema.optional(Schema.String),
}).annotate({ identifier: "Coordination.Approval" })
export type Approval = typeof Approval.Type

export const Event = Schema.Struct({
  id: Schema.String,
  projectId: ProjectID,
  threadId: ThreadID,
  seq: Schema.Int,
  kind: EventKind,
  occurredAt: Schema.String,
  actorId: Schema.optional(UserID),
  runId: Schema.optional(RunID),
  instructionId: Schema.optional(InstructionID),
  payload: Schema.Record(Schema.String, Schema.Unknown),
}).annotate({ identifier: "Coordination.Event" })
export type Event = typeof Event.Type

export const WorkCard = Schema.Struct({
  id: WorkCardID,
  threadId: ThreadID,
  version: Schema.Int,
  sourceActivitySeq: Schema.Int,
  currentTask: Schema.String,
  progress: Schema.String,
  blockers: Schema.Array(Schema.String),
  status: Schema.Literals(["queued", "active", "blocked", "idle", "done"]),
  updatedAt: Schema.String,
  summaryJobId: Schema.String,
}).annotate({ identifier: "Coordination.WorkCard" })
export type WorkCard = typeof WorkCard.Type

export const Principal = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("member"),
    id: UserID,
    projectIds: Schema.Array(ProjectID),
  }),
  Schema.Struct({
    kind: Schema.Literal("runner"),
    id: WorkerID,
    projectId: ProjectID,
    workerId: WorkerID,
    instanceId: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("analysis"),
    id: Schema.String,
    projectId: ProjectID,
  }),
]).annotate({ identifier: "Coordination.Principal" })
export type Principal = typeof Principal.Type
