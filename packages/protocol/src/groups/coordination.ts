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
  thread: Coordination.Thread,
  instructions: Schema.Array(Coordination.InstructionRequest),
  runs: Schema.Array(Coordination.Run),
  approvals: Schema.Array(Coordination.Approval),
  workCard: Schema.optional(Coordination.WorkCard),
  cursor: Schema.Int,
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
    HttpApiEndpoint.get("coordination.projects.list", "/api/coordination/v1/projects", {
      success: Schema.Array(Coordination.SharedProject),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("coordination.projects.create", "/api/coordination/v1/projects", {
      payload: Schema.Struct({ projectId: Coordination.ProjectID, name: Schema.String, requestId: Schema.String }),
      success: Coordination.SharedProject,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("coordination.projects.get", "/api/coordination/v1/projects/:projectId", {
      params: { projectId: Coordination.ProjectID },
      success: Schema.Struct({ project: Coordination.SharedProject, members: Schema.Array(Coordination.Membership) }),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("coordination.projects.members", "/api/coordination/v1/projects/:projectId/members", {
      params: { projectId: Coordination.ProjectID },
      payload: Schema.Struct({ targetUserId: Coordination.UserID, requestId: Schema.String }),
      success: Coordination.Membership,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get(
      "coordination.projects.contributions",
      "/api/coordination/v1/projects/:projectId/contributions",
      {
        params: { projectId: Coordination.ProjectID },
        query: Schema.Struct({ userId: Coordination.UserID.pipe(Schema.optional) }),
        success: Schema.Array(Coordination.Contribution),
        error: errors,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get("coordination.projects.threads", "/api/coordination/v1/projects/:projectId/threads", {
      params: { projectId: Coordination.ProjectID },
      success: Schema.Array(Coordination.Thread),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("coordination.threads.create", "/api/coordination/v1/projects/:projectId/threads", {
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
    HttpApiEndpoint.get("coordination.threads.get", "/api/coordination/v1/threads/:threadId", {
      params: { threadId: Coordination.ThreadID },
      success: snapshot,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("coordination.comments.list", "/api/coordination/v1/threads/:threadId/comments", {
      params: { threadId: Coordination.ThreadID },
      success: Schema.Array(Coordination.Comment),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("coordination.comments.create", "/api/coordination/v1/threads/:threadId/comments", {
      params: { threadId: Coordination.ThreadID },
      payload: Schema.Struct({ requestId: Schema.String, body: Schema.String }),
      success: Coordination.Comment,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("coordination.instructions.submit", "/api/coordination/v1/threads/:threadId/instructions", {
      params: { threadId: Coordination.ThreadID },
      payload: Schema.Struct({ requestId: Schema.String, text: Schema.String }),
      success: Schema.Struct({ instruction: Coordination.InstructionRequest, run: Coordination.Run }),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "coordination.instructions.cancel",
      "/api/coordination/v1/threads/:threadId/instructions/:instructionId/cancel",
      {
        params: { threadId: Coordination.ThreadID, instructionId: Coordination.InstructionID },
        success: Coordination.Run,
        error: errors,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post("coordination.runner.reserve", "/api/coordination/v1/runner/threads/:threadId/reserve", {
      params: { threadId: Coordination.ThreadID },
      success: Schema.Struct({ run: Schema.optional(Coordination.Run) }),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("coordination.runner.report", "/api/coordination/v1/runner/runs/:runId/events", {
      params: { runId: Coordination.RunID },
      payload: Schema.Struct({ callbackId: Schema.String, callback }),
      success: Coordination.Run,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "coordination.approvals.claim",
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
      "coordination.approvals.decide",
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
    HttpApiEndpoint.get("coordination.projectEvents.replay", "/api/coordination/v1/projects/:projectId/events", {
      params: { projectId: Coordination.ProjectID },
      query: replayQuery,
      success: Schema.Struct({ events: Schema.Array(Coordination.Event), cursor: Schema.Int, hasMore: Schema.Boolean }),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("coordination.projectEvents.stream", "/api/coordination/v1/projects/:projectId/events/stream", {
      params: { projectId: Coordination.ProjectID },
      query: replayQuery,
      success: HttpApiSchema.StreamSse({ data: Coordination.Event }),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("coordination.threadEvents.replay", "/api/coordination/v1/threads/:threadId/events", {
      params: { threadId: Coordination.ThreadID },
      query: replayQuery,
      success: Schema.Struct({ events: Schema.Array(Coordination.Event), cursor: Schema.Int, hasMore: Schema.Boolean }),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("coordination.threadEvents.stream", "/api/coordination/v1/threads/:threadId/events/stream", {
      params: { threadId: Coordination.ThreadID },
      query: replayQuery,
      success: HttpApiSchema.StreamSse({ data: Coordination.Event }),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("coordination.workCard.get", "/api/coordination/v1/threads/:threadId/work-card", {
      params: { threadId: Coordination.ThreadID },
      success: Schema.Struct({ card: Schema.optional(Coordination.WorkCard) }),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.put("coordination.workCard.update", "/api/coordination/v1/threads/:threadId/work-card", {
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
        }),
      }),
      success: Coordination.WorkCard,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("coordination.workCards.list", "/api/coordination/v1/projects/:projectId/work-cards", {
      params: { projectId: Coordination.ProjectID },
      success: Schema.Array(Coordination.WorkCard),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("coordination.activity.list", "/api/coordination/v1/projects/:projectId/activity", {
      params: { projectId: Coordination.ProjectID },
      success: Schema.Unknown,
      error: errors,
    }),
  )
  .middleware(CoordinationAuth)
