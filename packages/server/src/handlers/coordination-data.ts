import { CoordinationEvents } from "@opencode-ai/core/coordination/events/events"
import type { CoordinationContracts } from "@opencode-ai/core/coordination/contracts"
import { CoordinationPrincipal } from "@opencode-ai/protocol/middleware/coordination-auth"
import {
  ConflictError,
  CoordinationNotFoundError,
  ForbiddenError,
  InvalidRequestError,
  ServiceUnavailableError,
  UnauthorizedError,
} from "@opencode-ai/protocol/errors"
import { Effect, Stream } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Sse } from "effect/unstable/encoding"
import { Api } from "../api"
import { CoordinationRuntime } from "../coordination-runtime"
import type { CoordinationServices } from "../coordination-runtime"
import { CoordinationProvisioning } from "@opencode-ai/core/coordination/provisioning/index"
import { Database } from "@opencode-ai/core/database/database"
import { CoordinationAnalysisExport } from "@opencode-ai/core/coordination/analysis/export"
import { CoordinationCooperation } from "@opencode-ai/core/coordination/cooperation/index"

type AuthContext = Parameters<CoordinationContracts.Access["authorize"]>[0]
type Event = CoordinationContracts.ReplayPage["events"][number]

export const CoordinationDataHandler = HttpApiBuilder.group(Api, "server.coordination.data", (handlers) =>
  Effect.gen(function* () {
    const runtime = yield* CoordinationRuntime
    const database = yield* Database.Service
    const use = <A>(
      invoke: (
        services: CoordinationServices,
        principal: AuthContext,
      ) => Effect.Effect<A, CoordinationContracts.Failure>,
    ) =>
      Effect.flatMap(CoordinationPrincipal, (principal) =>
        runtime.services
          ? invoke(runtime.services, principal).pipe(Effect.mapError(httpFailure))
          : Effect.fail(unavailable()),
      )
    const useContext = <A>(
      invoke: (
        context: CoordinationContracts.ProjectContext,
        principal: AuthContext,
      ) => Effect.Effect<A, CoordinationContracts.Failure>,
    ) => use((services, principal) => invoke(services.projectContext, principal))
    const requireOwner = (
      services: CoordinationServices,
      principal: AuthContext,
      threadId: Parameters<CoordinationContracts.Access["getThread"]>[1],
      action: CoordinationContracts.Action,
    ) =>
      Effect.gen(function* () {
        const thread = yield* services.access.getThread(principal, threadId, action)
        const ownerId = yield* CoordinationProvisioning.ownerOf(database.db, thread)
        if (ownerId && (principal.kind !== "member" || principal.userId !== ownerId))
          return yield* Effect.fail({ code: "forbidden" as const, message: "Session owner must control coding work" })
      })

    return handlers
      .handle("coordination.analysisAwarenessReceipt", (ctx) =>
        use((services, principal) =>
          services.analysisResults.receipt(principal, ctx.params.threadId, ctx.params.reportId, ctx.params.noteId),
        ),
      )
      .handle("coordination.analysisResultRegister", (ctx) =>
        use((services, principal) =>
          CoordinationCooperation.withStableConsent(
            services.analysisResults.register(principal, ctx.params.projectId, ctx.payload),
          ),
        ),
      )
      .handle("coordination.analysisAwarenessDeliver", (ctx) =>
        use((services, principal) =>
          CoordinationCooperation.withStableConsent(
            services.analysisResults.deliver(principal, ctx.params.threadId, ctx.payload),
          ),
        ),
      )
      .handle("coordination.cooperationGet", (ctx) =>
        use((services, principal) => services.cooperation.get(principal, ctx.params.threadId)),
      )
      .handle("coordination.cooperationPut", (ctx) =>
        use((services, principal) => {
          const { requestId, expectedVersion, ...content } = ctx.payload
          return services.cooperation.put({
            principal,
            threadId: ctx.params.threadId,
            requestId,
            expectedVersion,
            content,
          })
        }),
      )
      .handle("coordination.analysisExport", (ctx) =>
        use((services, auth) =>
          CoordinationCooperation.withStableConsent(
            Effect.gen(function* () {
              const ids = [ctx.payload.sourceThreadId, ctx.payload.targetThreadId]
              const before = yield* Effect.forEach(ids, (id) => services.cooperation.get(auth, id))
              const captured = yield* CoordinationAnalysisExport.captureSelected({
                auth,
                projectId: ctx.params.projectId,
                ...ctx.payload,
                access: services.access,
                binding: services.sessionBinding,
                selection: services.cooperation.selection,
                events: services.events,
              })
              const bindings = yield* Effect.forEach(ids, (id, index) =>
                Effect.gen(function* () {
                  const settings = yield* services.cooperation.get(auth, id)
                  const snapshot = yield* services.snapshot.thread(auth, id)
                  const evidence = captured.snapshot.sharedSessions[index]
                  const provenance = captured.provenance.find((item) => item.threadId === id)
                  if (
                    !settings.analysisEnabled ||
                    settings.version !== before[index].version ||
                    !settings.ownerId ||
                    settings.ownerId !== evidence.ownerId ||
                    settings.sourceActivitySeq !== snapshot.thread.activitySeq ||
                    provenance?.threadActivitySeq !== snapshot.thread.activitySeq
                  )
                    return yield* Effect.fail({
                      code: "conflict" as const,
                      message: "Selected consent or activity changed during export",
                    })
                  const states = snapshot.runs.map((run) => run.state)
                  const deterministicStatus = states.includes("waiting_approval")
                    ? ("blocked" as const)
                    : states.some((state) => state === "running" || state === "cancelling")
                      ? ("active" as const)
                      : states.some((state) => state === "queued" || state === "reserved")
                        ? ("queued" as const)
                        : snapshot.runs.at(-1)?.state === "completed"
                          ? ("done" as const)
                          : ("idle" as const)
                  return {
                    projectId: snapshot.thread.projectId,
                    threadId: id,
                    workerId: snapshot.thread.workerId,
                    sessionId: snapshot.thread.sessionId,
                    ownerId: settings.ownerId,
                    title: evidence.title,
                    featureTopic: evidence.featureTopic,
                    relationship: evidence.relationship,
                    activitySeq: snapshot.thread.activitySeq,
                    evidenceRevision: evidence.revision,
                    expectedVersion: snapshot.workCard?.version ?? 0,
                    shared: true as const,
                    deterministicStatus,
                    contributors: [],
                    cooperationVersion: settings.version,
                  }
                }),
              )
              return {
                ...captured,
                snapshot: { ...captured.snapshot, schemaVersion: 1 as const },
                bindings: bindings.map(({ cooperationVersion, ...binding }) => binding),
                cooperationVersions: Object.fromEntries(
                  bindings.map((binding) => [binding.threadId, binding.cooperationVersion]),
                ),
              }
            }),
          ),
        ),
      )
      .handle("coordination.me", () =>
        Effect.flatMap(CoordinationPrincipal, (principal) =>
          principal.kind === "member"
            ? Effect.succeed({ userId: principal.userId })
            : Effect.fail(new ForbiddenError({ message: "Member credentials required" })),
        ),
      )
      .handle("coordination.provisioningList", () =>
        use((services, principal) =>
          principal.kind !== "member"
            ? Effect.fail({ code: "forbidden" as const, message: "Member credentials required" })
            : services.provisioning
              ? services.provisioning.list(principal)
              : Effect.succeed({ projects: [], privateSessions: false as const }),
        ),
      )
      .handle("coordination.sessionProvision", (ctx) =>
        use((services, principal) =>
          principal.kind !== "member"
            ? Effect.fail({ code: "forbidden" as const, message: "Member credentials required" })
            : services.provisioning
              ? services.provisioning.provision({ principal, projectId: ctx.params.projectId, ...ctx.payload })
              : Effect.fail({ code: "unavailable" as const, message: "Coding Session provisioning is not configured" }),
        ),
      )
      .handle("coordination.projectList", () => use((services, auth) => services.projects.list(auth)))
      .handle("coordination.projectCreate", (ctx) =>
        use((services, auth) => services.projects.create({ auth, ...ctx.payload })),
      )
      .handle("coordination.projectGet", (ctx) =>
        use((services, auth) => services.projects.get(auth, ctx.params.projectId)),
      )
      .handle("coordination.projectBriefGet", (ctx) =>
        useContext((context, auth) =>
          context.readBrief(auth, ctx.params.projectId).pipe(Effect.map((brief) => ({ brief }))),
        ),
      )
      .handle("coordination.projectBriefPut", (ctx) =>
        useContext((context, principal) =>
          context.putBrief({ principal, projectId: ctx.params.projectId, ...ctx.payload }),
        ),
      )
      .handle("coordination.personFocusList", (ctx) =>
        useContext((context, auth) => context.listFocus(auth, ctx.params.projectId)),
      )
      .handle("coordination.personFocusPut", (ctx) =>
        useContext((context, principal) =>
          context.putFocus({ principal, projectId: ctx.params.projectId, ...ctx.payload }),
        ),
      )
      .handle("coordination.memberGrant", (ctx) =>
        use((services, auth) =>
          services.projects.grantMember({ auth, projectId: ctx.params.projectId, ...ctx.payload }),
        ),
      )
      .handle("coordination.contributionList", (ctx) =>
        use((services, auth) => services.projects.contributions(auth, ctx.params.projectId, ctx.query.userId)),
      )
      .handle("coordination.projectThreadList", (ctx) =>
        use((services, auth) => services.projects.listThreads(auth, ctx.params.projectId)),
      )
      .handle("coordination.threadCreate", (ctx) =>
        use((services, auth) =>
          services.projects.createThread({ auth, projectId: ctx.params.projectId, ...ctx.payload }),
        ),
      )
      .handle("coordination.threadGet", (ctx) =>
        use((services, auth) =>
          Effect.gen(function* () {
            const value = yield* services.snapshot.thread(auth, ctx.params.threadId)
            const ownerId = yield* CoordinationProvisioning.ownerOf(database.db, value.thread)
            const approvals = yield* Effect.forEach(value.approvals, (approval) =>
              services.approvalReview
                ? services
                    .approvalReview(approval, value.thread)
                    .pipe(Effect.map((review) => ({ ...approval, ...(review ? { review } : {}) })))
                : Effect.succeed(approval),
            )
            return { ...value, approvals, ...(ownerId ? { ownerId } : {}) }
          }),
        ),
      )
      .handle("coordination.commentList", (ctx) =>
        use((services, auth) => services.comments.list(auth, ctx.params.threadId)),
      )
      .handle("coordination.commentCreate", (ctx) =>
        use((services, auth) => services.comments.create({ auth, threadId: ctx.params.threadId, ...ctx.payload })),
      )
      .handle("coordination.instructionSubmit", (ctx) =>
        use((services, principal) =>
          Effect.gen(function* () {
            yield* requireOwner(services, principal, ctx.params.threadId, "submit")
            return yield* services.queue.submit({ principal, threadId: ctx.params.threadId, ...ctx.payload })
          }),
        ),
      )
      .handle("coordination.instructionCancel", (ctx) =>
        use((services, principal) =>
          Effect.gen(function* () {
            yield* requireOwner(services, principal, ctx.params.threadId, "cancel")
            return yield* services.runner.cancel({
              principal,
              threadId: ctx.params.threadId,
              instructionId: ctx.params.instructionId,
            })
          }),
        ),
      )
      .handle("coordination.runnerReserve", (ctx) =>
        use((services, principal) =>
          Effect.gen(function* () {
            if (principal.kind !== "runner")
              return yield* Effect.fail({ code: "forbidden" as const, message: "Runner credential required" })
            const owner = { workerId: principal.workerId, instanceId: principal.instanceId }
            const run = yield* services.runner.claim(principal, ctx.params.threadId, owner)
            return { run }
          }),
        ),
      )
      .handle("coordination.runnerReport", (ctx) =>
        use((services, principal) => services.runner.report({ principal, runId: ctx.params.runId, ...ctx.payload })),
      )
      .handle("coordination.approvalClaim", (ctx) =>
        use((services, principal) =>
          Effect.gen(function* () {
            yield* requireOwner(services, principal, ctx.params.threadId, "approve")
            return yield* services.runner.claimApproval({
              principal,
              threadId: ctx.params.threadId,
              approvalId: ctx.params.approvalId,
              ...ctx.payload,
            })
          }),
        ),
      )
      .handle("coordination.approvalDecide", (ctx) =>
        use((services, principal) =>
          Effect.gen(function* () {
            yield* requireOwner(services, principal, ctx.params.threadId, "approve")
            return yield* services.runner.decideApproval({
              principal,
              threadId: ctx.params.threadId,
              approvalId: ctx.params.approvalId,
              ...ctx.payload,
            })
          }),
        ),
      )
      .handle("coordination.projectReplay", (ctx) =>
        use((services, auth) =>
          CoordinationEvents.authorizedReplayProject(
            services.access,
            services.events,
            auth,
            ctx.params.projectId,
            ctx.query.after ?? -1,
            ctx.query.limit ?? 100,
          ),
        ),
      )
      .handleRaw("coordination.projectStream", (ctx) =>
        use((services, auth) =>
          CoordinationEvents.authorizedSubscribeProject(
            services.access,
            services.events,
            auth,
            ctx.params.projectId,
            ctx.query.after ?? -1,
          ).pipe(Effect.map(sseResponse)),
        ),
      )
      .handle("coordination.threadReplay", (ctx) =>
        use((services, auth) =>
          CoordinationEvents.authorizedReplayThread(
            services.access,
            services.events,
            auth,
            ctx.params.threadId,
            ctx.query.after ?? -1,
            ctx.query.limit ?? 100,
          ),
        ),
      )
      .handleRaw("coordination.threadStream", (ctx) =>
        use((services, auth) =>
          CoordinationEvents.authorizedSubscribeThread(
            services.access,
            services.events,
            auth,
            ctx.params.threadId,
            ctx.query.after ?? -1,
          ).pipe(Effect.map(sseResponse)),
        ),
      )
      .handle("coordination.workCardGet", (ctx) =>
        use((services, auth) =>
          services.workCards.read(auth, ctx.params.threadId).pipe(Effect.map((card) => ({ card }))),
        ),
      )
      .handle("coordination.workCardUpdate", (ctx) =>
        use((services, principal) =>
          CoordinationCooperation.withStableConsent(
            Effect.gen(function* () {
              const thread = yield* services.access.getThread(principal, ctx.params.threadId, "update_work_card")
              const ownerId = yield* CoordinationProvisioning.ownerOf(database.db, thread)
              if (ownerId) {
                const consent = yield* services.cooperation.get({ kind: "member", userId: ownerId }, thread.id)
                if (!consent.analysisEnabled)
                  return yield* Effect.fail({
                    code: "forbidden" as const,
                    message: "Current Session analysis consent required",
                  })
              }
              return yield* services.workCards.update({ principal, threadId: ctx.params.threadId, ...ctx.payload })
            }),
          ),
        ),
      )
      .handle("coordination.workCardList", (ctx) =>
        use((services, auth) => services.workCards.list(auth, ctx.params.projectId)),
      )
      .handle("coordination.activityList", (ctx) =>
        use((services, auth) => services.activity.read(auth, ctx.params.projectId)),
      )
  }),
)

function unavailable() {
  return new ServiceUnavailableError({
    service: "coordination",
    message: "Coordination adapters are not all configured",
  })
}

function httpFailure(error: CoordinationContracts.Failure) {
  switch (error.code) {
    case "invalid":
      return new InvalidRequestError({ message: error.message })
    case "unauthorized":
      return new UnauthorizedError({ message: error.message })
    case "forbidden":
      return new ForbiddenError({ message: error.message })
    case "not_found":
      return new CoordinationNotFoundError({ message: error.message })
    case "conflict":
      return new ConflictError({ message: error.message })
    case "unavailable":
      return new ServiceUnavailableError({ service: "coordination", message: error.message })
  }
}

function sseResponse(events: Stream.Stream<Event, CoordinationContracts.Failure>) {
  const output = events.pipe(
    Stream.map(
      (event): Sse.Event => ({
        _tag: "Event",
        event: "message",
        id: String(event.seq),
        data: JSON.stringify(event),
      }),
    ),
    Stream.pipeThroughChannel(Sse.encode()),
  )
  const heartbeat = Stream.tick("15 seconds").pipe(Stream.map(() => ": heartbeat\n\n"))
  return HttpServerResponse.stream(output.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }), Stream.encodeText), {
    contentType: "text/event-stream",
    headers: { "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  })
}
