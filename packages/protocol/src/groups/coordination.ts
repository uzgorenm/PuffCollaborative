import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Coordination } from "@opencode-ai/schema/coordination"
import {
  ConflictError,
  CoordinationNotFoundError,
  ForbiddenError,
  InvalidRequestError,
  ServiceUnavailableError,
  UnauthorizedError,
} from "../errors"
import { CoordinationAuth } from "../middleware/coordination-auth"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { optional } from "@opencode-ai/schema/schema"

const errors = [
  InvalidRequestError,
  UnauthorizedError,
  ForbiddenError,
  CoordinationNotFoundError,
  ConflictError,
  ServiceUnavailableError,
] as const

const replayQuery = Schema.Struct({
  after: Schema.NumberFromString.pipe(Schema.optional),
  limit: Schema.NumberFromString.pipe(Schema.optional),
})

const callback = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("state"),
    expectedState: Coordination.RunState,
    nextState: Coordination.RunState,
    approvalId: Schema.optional(Schema.String),
    toolCallId: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("activity"),
    state: Schema.Literals(["running", "waiting_approval"]),
    activity: Coordination.RunnerActivity,
  }),
])

const snapshot = Schema.Struct({
  ownerId: Schema.optional(Coordination.UserID),
  thread: Coordination.Thread,
  instructions: Schema.Array(Coordination.InstructionRequest),
  runs: Schema.Array(Coordination.Run),
  approvals: Schema.Array(Coordination.Approval),
  workCard: Schema.optional(Coordination.WorkCard),
  cursor: Schema.Int,
})

const sourceThread = Schema.Struct({
  threadId: Coordination.ThreadID,
  sessionId: Coordination.Thread.fields.sessionId,
  href: Schema.String,
})

const activityView = Schema.Struct({
  projectId: Coordination.ProjectID,
  asOf: Schema.String,
  workingNow: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      sourceThread,
      runId: Schema.NullOr(Coordination.RunID),
      status: Schema.Union([Coordination.RunState, Schema.Literal("idle")]),
      startedAt: Schema.NullOr(Schema.String),
      approvalId: Schema.NullOr(Schema.String),
      objective: Schema.NullOr(Schema.String),
      step: Schema.NullOr(Schema.String),
      blockers: Schema.Array(Schema.String),
      recentVerifiedOutcome: Schema.NullOr(Schema.String),
      contributors: Schema.Array(Coordination.UserID),
      freshness: Schema.NullOr(
        Schema.Struct({
          sourceActivitySeq: Schema.Int,
          threadActivitySeq: Schema.Int,
          stale: Schema.Boolean,
          generatedAt: Schema.String,
          updatedAt: Schema.String,
          summaryJobId: Schema.String,
        }),
      ),
    }),
  ),
  upNext: Schema.Array(
    Schema.Struct({
      id: Coordination.InstructionID,
      sourceThread,
      status: Schema.Literal("queued"),
      queueSeq: Schema.Int,
      submittedAt: Schema.String,
      actorId: Coordination.UserID,
      text: Schema.String,
    }),
  ),
  recent: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      sourceThread: Schema.NullOr(sourceThread),
      kind: Coordination.EventKind,
      occurredAt: Schema.String,
      actorId: Schema.NullOr(Coordination.UserID),
      outcome: Schema.NullOr(Schema.String),
      eventSeq: Schema.Int,
    }),
  ),
})

const analysisEvidence = Schema.Struct({
  workerId: Coordination.WorkerID,
  sessionId: Coordination.Thread.fields.sessionId,
  eventId: Schema.String,
  revision: Schema.Int,
})
const analysisExport = Schema.Struct({
  request: Schema.Struct({
    requestId: Schema.String,
    projectId: Coordination.ProjectID,
    targetWorkerId: Coordination.WorkerID,
    targetSessionId: Coordination.Thread.fields.sessionId,
    question: Schema.String,
    evidenceRefs: Schema.Array(analysisEvidence),
    createdAt: Schema.String,
  }),
  snapshot: Schema.Struct({
    schemaVersion: Schema.Literal(1),
    projectId: Coordination.ProjectID,
    workers: Schema.Array(
      Schema.Struct({
        workerId: Coordination.WorkerID,
        projectId: Coordination.ProjectID,
        ownerId: Schema.optional(Coordination.UserID),
      }),
    ),
    sharedSessions: Schema.Array(
      Schema.Struct({
        workerId: Coordination.WorkerID,
        sessionId: Coordination.Thread.fields.sessionId,
        ownerId: Coordination.UserID,
        title: Schema.String,
        featureTopic: Schema.String,
        relationship: Schema.Literals(["alternative", "unspecified"]),
        revision: Schema.Int,
        status: Schema.String,
      }),
    ),
    events: Schema.Array(
      Schema.Struct({
        eventId: Schema.String,
        projectId: Coordination.ProjectID,
        workerId: Coordination.WorkerID,
        sessionId: Coordination.Thread.fields.sessionId,
        revision: Schema.Int,
        kind: Schema.Literals(["message", "activity", "status"]),
        occurredAt: Schema.String,
        content: Schema.Struct({
          toolName: Schema.optional(Schema.String),
          toolStatus: Schema.optional(Schema.String),
          transition: Schema.optional(Schema.String),
          role: Schema.optional(Schema.String),
          text: Schema.optional(Schema.String),
        }),
      }),
    ),
  }),
  provenance: Schema.Array(
    Schema.Struct({
      threadId: Coordination.ThreadID,
      eventId: Schema.String,
      eventSeq: Schema.Int,
      threadActivitySeq: Schema.Int,
    }),
  ),
  bindings: Schema.Array(
    Schema.Struct({
      projectId: Coordination.ProjectID,
      threadId: Coordination.ThreadID,
      workerId: Coordination.WorkerID,
      sessionId: Coordination.Thread.fields.sessionId,
      ownerId: Coordination.UserID,
      title: Schema.String,
      featureTopic: Schema.String,
      relationship: Schema.Literals(["alternative", "unspecified"]),
      activitySeq: Schema.Int,
      evidenceRevision: Schema.Int,
      expectedVersion: Schema.Int,
      shared: Schema.Literal(true),
      deterministicStatus: Schema.Literals(["queued", "active", "blocked", "idle", "done"]),
      contributors: Schema.Array(Coordination.UserID),
    }),
  ),
  cooperationVersions: Schema.Record(Schema.String, Schema.Int),
})

export const CoordinationGroup = HttpApiGroup.make("server.coordination").add(
  HttpApiEndpoint.get("coordination.status", "/api/coordination/v1/status", {
    success: Schema.Struct({ ready: Schema.Boolean }),
    error: ServiceUnavailableError,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "v1.coordination.status",
      summary: "Check coordination adapter readiness",
      description: "Returns 503 until identity, queue, runner, event and work-card adapters are registered.",
    }),
  ),
)

export const CoordinationDataGroup = HttpApiGroup.make("server.coordination.data")
  .add(
    HttpApiEndpoint.get(
      "coordination.analysisAwarenessReceipt",
      "/api/coordination/v1/threads/:threadId/analysis/awareness/:reportId/:noteId",
      {
        params: { threadId: Coordination.ThreadID, reportId: Schema.String, noteId: Schema.String },
        success: Schema.Struct({
          sessionID: Coordination.Thread.fields.sessionId,
          messageID: SessionMessage.ID,
          admittedSeq: Schema.Int,
          promotedSeq: optional(Schema.Int),
          activeObserved: Schema.Boolean,
        }),
        error: errors,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "coordination.analysisResultRegister",
      "/api/coordination/v1/projects/:projectId/analysis/results",
      {
        params: { projectId: Coordination.ProjectID },
        payload: Coordination.AnalysisResultContent,
        success: Schema.Struct({ reportId: Schema.String, requestId: Schema.String, registered: Schema.Literal(true) }),
        error: errors,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "coordination.analysisAwarenessDeliver",
      "/api/coordination/v1/threads/:threadId/analysis/awareness",
      {
        params: { threadId: Coordination.ThreadID },
        payload: Schema.Struct({ reportId: Schema.String, noteId: Schema.String, messageId: SessionMessage.ID }),
        success: Schema.Struct({
          sessionID: Coordination.Thread.fields.sessionId,
          messageID: SessionMessage.ID,
          admittedSeq: Schema.Int,
          promotedSeq: optional(Schema.Int),
          activeObserved: Schema.Boolean,
        }),
        error: errors,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get("coordination.cooperationGet", "/api/coordination/v1/threads/:threadId/cooperation", {
      params: { threadId: Coordination.ThreadID },
      success: Coordination.CooperationSettings,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.put("coordination.cooperationPut", "/api/coordination/v1/threads/:threadId/cooperation", {
      params: { threadId: Coordination.ThreadID },
      payload: Schema.Struct({
        requestId: Schema.String,
        expectedVersion: Schema.Int,
        ...Coordination.CooperationContent.fields,
      }),
      success: Coordination.CooperationSettings,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("coordination.analysisExport", "/api/coordination/v1/projects/:projectId/analysis/export", {
      params: { projectId: Coordination.ProjectID },
      payload: Schema.Struct({
        requestId: Schema.String,
        sourceThreadId: Coordination.ThreadID,
        targetThreadId: Coordination.ThreadID,
      }),
      success: analysisExport,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("coordination.me", "/api/coordination/v1/me", {
      success: Schema.Struct({ userId: Coordination.UserID }),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("coordination.provisioningList", "/api/coordination/v1/provisioning", {
      success: Coordination.ProvisioningView,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("coordination.sessionProvision", "/api/coordination/v1/projects/:projectId/sessions", {
      params: { projectId: Coordination.ProjectID },
      payload: Schema.Struct({ requestId: Schema.String, title: Schema.String }),
      success: Coordination.ProvisionedSession,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("coordination.projectList", "/api/coordination/v1/projects", {
      success: Schema.Array(Coordination.SharedProject),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("coordination.projectCreate", "/api/coordination/v1/projects", {
      payload: Schema.Struct({ projectId: Coordination.ProjectID, name: Schema.String, requestId: Schema.String }),
      success: Coordination.SharedProject,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("coordination.projectGet", "/api/coordination/v1/projects/:projectId", {
      params: { projectId: Coordination.ProjectID },
      success: Schema.Struct({ project: Coordination.SharedProject, members: Schema.Array(Coordination.Membership) }),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("coordination.projectBriefGet", "/api/coordination/v1/projects/:projectId/brief", {
      params: { projectId: Coordination.ProjectID },
      success: Schema.Struct({ brief: Schema.optional(Coordination.ProjectBrief) }),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.put("coordination.projectBriefPut", "/api/coordination/v1/projects/:projectId/brief", {
      params: { projectId: Coordination.ProjectID },
      payload: Schema.Struct({
        requestId: Schema.String,
        expectedVersion: Schema.Int,
        content: Coordination.ProjectBriefContent,
      }),
      success: Coordination.ProjectBrief,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("coordination.personFocusList", "/api/coordination/v1/projects/:projectId/focus", {
      params: { projectId: Coordination.ProjectID },
      success: Schema.Array(Coordination.PersonFocus),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.put("coordination.personFocusPut", "/api/coordination/v1/projects/:projectId/focus/me", {
      params: { projectId: Coordination.ProjectID },
      payload: Schema.Struct({
        requestId: Schema.String,
        expectedVersion: Schema.Int,
        text: Schema.NullOr(Schema.String),
      }),
      success: Coordination.PersonFocus,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("coordination.memberGrant", "/api/coordination/v1/projects/:projectId/members", {
      params: { projectId: Coordination.ProjectID },
      payload: Schema.Struct({ targetUserId: Coordination.UserID, requestId: Schema.String }),
      success: Coordination.Membership,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("coordination.contributionList", "/api/coordination/v1/projects/:projectId/contributions", {
      params: { projectId: Coordination.ProjectID },
      query: Schema.Struct({ userId: Coordination.UserID.pipe(Schema.optional) }),
      success: Schema.Array(Coordination.Contribution),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("coordination.projectThreadList", "/api/coordination/v1/projects/:projectId/threads", {
      params: { projectId: Coordination.ProjectID },
      success: Schema.Array(Coordination.Thread),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("coordination.threadCreate", "/api/coordination/v1/projects/:projectId/threads", {
      params: { projectId: Coordination.ProjectID },
      payload: Schema.Struct({
        sessionId: Coordination.Thread.fields.sessionId,
        title: Schema.String,
        requestId: Schema.String,
      }),
      success: Coordination.Thread,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("coordination.threadGet", "/api/coordination/v1/threads/:threadId", {
      params: { threadId: Coordination.ThreadID },
      success: snapshot,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("coordination.commentList", "/api/coordination/v1/threads/:threadId/comments", {
      params: { threadId: Coordination.ThreadID },
      success: Schema.Array(Coordination.Comment),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("coordination.commentCreate", "/api/coordination/v1/threads/:threadId/comments", {
      params: { threadId: Coordination.ThreadID },
      payload: Schema.Struct({ requestId: Schema.String, body: Schema.String }),
      success: Coordination.Comment,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("coordination.instructionSubmit", "/api/coordination/v1/threads/:threadId/instructions", {
      params: { threadId: Coordination.ThreadID },
      payload: Schema.Struct({ requestId: Schema.String, text: Schema.String }),
      success: Schema.Struct({ instruction: Coordination.InstructionRequest, run: Coordination.Run }),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "coordination.instructionCancel",
      "/api/coordination/v1/threads/:threadId/instructions/:instructionId/cancel",
      {
        params: { threadId: Coordination.ThreadID, instructionId: Coordination.InstructionID },
        success: Coordination.Run,
        error: errors,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post("coordination.runnerReserve", "/api/coordination/v1/runner/threads/:threadId/reserve", {
      params: { threadId: Coordination.ThreadID },
      success: Schema.Struct({ run: Schema.optional(Coordination.Run) }),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("coordination.runnerReport", "/api/coordination/v1/runner/runs/:runId/events", {
      params: { runId: Coordination.RunID },
      payload: Schema.Struct({ callbackId: Schema.String, callback }),
      success: Coordination.Run,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "coordination.approvalClaim",
      "/api/coordination/v1/threads/:threadId/approvals/:approvalId/claim",
      {
        params: { threadId: Coordination.ThreadID, approvalId: Schema.String },
        payload: Schema.Struct({ expectedVersion: Schema.Int }),
        success: Coordination.Approval,
        error: errors,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "coordination.approvalDecide",
      "/api/coordination/v1/threads/:threadId/approvals/:approvalId/decision",
      {
        params: { threadId: Coordination.ThreadID, approvalId: Schema.String },
        payload: Schema.Struct({
          expectedVersion: Schema.Int,
          decisionId: Schema.String,
          decision: Schema.Literals(["approve", "reject"]),
        }),
        success: Coordination.Approval,
        error: errors,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get("coordination.projectReplay", "/api/coordination/v1/projects/:projectId/events", {
      params: { projectId: Coordination.ProjectID },
      query: replayQuery,
      success: Schema.Struct({ events: Schema.Array(Coordination.Event), cursor: Schema.Int, hasMore: Schema.Boolean }),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("coordination.projectStream", "/api/coordination/v1/projects/:projectId/events/stream", {
      params: { projectId: Coordination.ProjectID },
      query: replayQuery,
      success: HttpApiSchema.StreamSse({ data: Coordination.Event }),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("coordination.threadReplay", "/api/coordination/v1/threads/:threadId/events", {
      params: { threadId: Coordination.ThreadID },
      query: replayQuery,
      success: Schema.Struct({ events: Schema.Array(Coordination.Event), cursor: Schema.Int, hasMore: Schema.Boolean }),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("coordination.threadStream", "/api/coordination/v1/threads/:threadId/events/stream", {
      params: { threadId: Coordination.ThreadID },
      query: replayQuery,
      success: HttpApiSchema.StreamSse({ data: Coordination.Event }),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("coordination.workCardGet", "/api/coordination/v1/threads/:threadId/work-card", {
      params: { threadId: Coordination.ThreadID },
      success: Schema.Struct({ card: Schema.optional(Coordination.WorkCard) }),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.put("coordination.workCardUpdate", "/api/coordination/v1/threads/:threadId/work-card", {
      params: { threadId: Coordination.ThreadID },
      payload: Schema.Struct({
        expectedVersion: Schema.Int,
        sourceActivitySeq: Schema.Int,
        card: Schema.Struct({
          currentTask: Schema.String,
          progress: Schema.String,
          blockers: Schema.Array(Schema.String),
          status: Coordination.WorkCard.fields.status,
          summaryJobId: Schema.String,
          recentVerifiedOutcome: Coordination.WorkCard.fields.recentVerifiedOutcome,
          contributors: Coordination.WorkCard.fields.contributors,
          evidenceRefs: Coordination.WorkCard.fields.evidenceRefs,
          generatedAt: Coordination.WorkCard.fields.generatedAt,
        }),
      }),
      success: Coordination.WorkCard,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("coordination.workCardList", "/api/coordination/v1/projects/:projectId/work-cards", {
      params: { projectId: Coordination.ProjectID },
      success: Schema.Array(Coordination.WorkCard),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("coordination.activityList", "/api/coordination/v1/projects/:projectId/activity", {
      params: { projectId: Coordination.ProjectID },
      success: activityView,
      error: errors,
    }),
  )
  .middleware(CoordinationAuth)
