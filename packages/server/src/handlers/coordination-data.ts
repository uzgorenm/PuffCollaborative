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

type AuthContext = Parameters<CoordinationContracts.Access["authorize"]>[0]
type Event = CoordinationContracts.ReplayPage["events"][number]

export const CoordinationDataHandler = HttpApiBuilder.group(Api, "server.coordination.data", (handlers) =>
  Effect.gen(function* () {
    const runtime = yield* CoordinationRuntime
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
    ) =>
      use((services, principal) => {
        // Composition owns this service after the backend freeze; until then these routes fail closed.
        const context =
          "projectContext" in services ? (services.projectContext as CoordinationContracts.ProjectContext) : undefined
        return context
          ? invoke(context, principal)
          : Effect.fail({ code: "unavailable", message: "Project context is not configured" })
      })

    return handlers
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
        use((services, auth) => services.snapshot.thread(auth, ctx.params.threadId)),
      )
      .handle("coordination.commentList", (ctx) =>
        use((services, auth) => services.comments.list(auth, ctx.params.threadId)),
      )
      .handle("coordination.commentCreate", (ctx) =>
        use((services, auth) => services.comments.create({ auth, threadId: ctx.params.threadId, ...ctx.payload })),
      )
      .handle("coordination.instructionSubmit", (ctx) =>
        use((services, principal) =>
          services.queue.submit({ principal, threadId: ctx.params.threadId, ...ctx.payload }),
        ),
      )
      .handle("coordination.instructionCancel", (ctx) =>
        use((services, principal) =>
          services.runner.cancel({ principal, threadId: ctx.params.threadId, instructionId: ctx.params.instructionId }),
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
          services.runner.claimApproval({
            principal,
            threadId: ctx.params.threadId,
            approvalId: ctx.params.approvalId,
            ...ctx.payload,
          }),
        ),
      )
      .handle("coordination.approvalDecide", (ctx) =>
        use((services, principal) =>
          services.runner.decideApproval({
            principal,
            threadId: ctx.params.threadId,
            approvalId: ctx.params.approvalId,
            ...ctx.payload,
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
          services.workCards.update({ principal, threadId: ctx.params.threadId, ...ctx.payload }),
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
