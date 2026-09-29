import { CoordinationAuth, CoordinationPrincipal } from "@opencode-ai/protocol/middleware/coordination-auth"
import { ServiceUnavailableError, UnauthorizedError } from "@opencode-ai/protocol/errors"
import { Effect, Encoding, Layer, Redacted } from "effect"
import { HttpEffect, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { CoordinationRuntime } from "../coordination-runtime"

const challenge = 'Basic realm="Coordination"'

export const coordinationAuthLayer = Layer.effect(
  CoordinationAuth,
  Effect.gen(function* () {
    const runtime = yield* CoordinationRuntime
    return CoordinationAuth.of((effect) =>
      Effect.gen(function* () {
        if (!runtime.authentication)
          return yield* new ServiceUnavailableError({
            service: "coordination",
            message: "Coordination identity roster is unavailable",
          })
        const request = yield* HttpServerRequest.HttpServerRequest
        const match = /^Basic\s+(.+)$/i.exec(request.headers.authorization ?? "")
        const decoded = match ? Encoding.decodeBase64String(match[1]) : undefined
        const credential = decoded?._tag === "Success" ? decoded.success : ""
        const separator = credential.indexOf(":")
        if (separator < 1) return yield* unauthorized()
        const principal = yield* runtime.authentication
          .authenticate({
            username: credential.slice(0, separator),
            password: Redacted.make(credential.slice(separator + 1)),
          })
          .pipe(
            Effect.catch((error) =>
              Effect.gen(function* () {
                if (error.code === "unavailable")
                  return yield* new ServiceUnavailableError({ service: "coordination", message: error.message })
                return yield* unauthorized()
              }),
            ),
          )
        return yield* effect.pipe(Effect.provideService(CoordinationPrincipal, principal))
      }),
    )
  }),
)

function unauthorized() {
  return HttpEffect.appendPreResponseHandler((_request, response) =>
    Effect.succeed(HttpServerResponse.setHeader(response, "www-authenticate", challenge)),
  ).pipe(Effect.andThen(new UnauthorizedError({ message: "Coordination credentials required" })))
}
