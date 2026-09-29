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

    return handlers
      .handle("coordination.projects.list", () => use((services, auth) => services.projects.list(auth)))
      .handle("coordination.projects.create", (ctx) =>
        use((services, auth) => services.projects.create({ auth, ...ctx.payload })),
      )
      .handle("coordination.projects.get", (ctx) =>
        use((services, auth) => services.projects.get(auth, ctx.params.projectId)),
      )
      .handle("coordination.projects.members", (ctx) =>
        use((services, auth) =>
          services.projects.grantMember({ auth, projectId: ctx.params.projectId, ...ctx.payload }),
        ),
      )
      .handle("coordination.projects.contributions", (ctx) =>
        use((services, auth) => services.projects.contributions(auth, ctx.params.projectId, ctx.query.userId)),
      )
      .handle("coordination.projects.threads", (ctx) =>
        use((services, auth) => services.projects.listThreads(auth, ctx.params.projectId)),
      )
      .handle("coordination.threads.create", (ctx) =>
        use((services, auth) =>
          services.projects.createThread({ auth, projectId: ctx.params.projectId, ...ctx.payload }),
        ),
      )
      .handle("coordination.threads.get", (ctx) =>
        use((services, auth) => services.snapshot.thread(auth, ctx.params.threadId)),
      )
      .handle("coordination.comments.list", (ctx) =>
        use((services, auth) => services.comments.list(auth, ctx.params.threadId)),
      )
      .handle("coordination.comments.create", (ctx) =>
        use((services, auth) => services.comments.create({ auth, threadId: ctx.params.threadId, ...ctx.payload })),
      )
      .handle("coordination.instructions.submit", (ctx) =>
        use((services, principal) =>
          services.queue.submit({ principal, threadId: ctx.params.threadId, ...ctx.payload }),
        ),
      )
      .handle("coordination.instructions.cancel", (ctx) =>
        use((services, principal) =>
          services.runner.cancel({ principal, threadId: ctx.params.threadId, instructionId: ctx.params.instructionId }),
        ),
      )
      .handle("coordination.runner.reserve", (ctx) =>
        use((services, principal) =>
          principal.kind === "runner"
            ? services.runner
                .claim(principal, ctx.params.threadId, {
                  workerId: principal.workerId,
                  instanceId: principal.instanceId,
                })
                .pipe(Effect.map((run) => ({ run })))
            : Effect.fail({ code: "forbidden" as const, message: "Runner credential required" }),
        ),
      )
      .handle("coordination.runner.report", (ctx) =>
        use((services, principal) => services.runner.report({ principal, runId: ctx.params.runId, ...ctx.payload })),
      )
      .handle("coordination.approvals.claim", (ctx) =>
        use((services, principal) =>
          services.runner.claimApproval({
            principal,
            threadId: ctx.params.threadId,
            approvalId: ctx.params.approvalId,
            ...ctx.payload,
          }),
        ),
      )
      .handle("coordination.approvals.decide", (ctx) =>
        use((services, principal) =>
          services.runner.decideApproval({
            principal,
            threadId: ctx.params.threadId,
            approvalId: ctx.params.approvalId,
            ...ctx.payload,
          }),
        ),
      )
      .handle("coordination.projectEvents.replay", (ctx) =>
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
      .handleRaw("coordination.projectEvents.stream", (ctx) =>
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
      .handle("coordination.threadEvents.replay", (ctx) =>
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
      .handleRaw("coordination.threadEvents.stream", (ctx) =>
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
      .handle("coordination.workCard.get", (ctx) =>
        use((services, auth) =>
          services.access.getThread(auth, ctx.params.threadId, "read").pipe(
            Effect.andThen(services.workCards.get(ctx.params.threadId)),
            Effect.map((card) => ({ card })),
          ),
        ),
      )
      .handle("coordination.workCard.update", (ctx) =>
        use((services, principal) =>
          services.workCards.update({ principal, threadId: ctx.params.threadId, ...ctx.payload }),
        ),
      )
      .handle("coordination.workCards.list", () => Effect.fail(unavailable()))
      .handle("coordination.activity.list", () => Effect.fail(unavailable()))
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
