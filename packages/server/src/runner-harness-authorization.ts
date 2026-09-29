import { ServerAuth } from "./auth"
import { Authorization } from "@opencode-ai/protocol/middleware/authorization"
import { UnauthorizedError } from "@opencode-ai/protocol/errors"
import { Effect, Layer, Option } from "effect"
import { HttpEffect, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { createHash, timingSafeEqual } from "node:crypto"

const challenge = 'Basic realm="OpenCode Runtime"'

/** Harness mode requires a separate runtime credential for all non-coordination API routes. */
export const runnerHarnessAuthorizationLayer = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const config = yield* ServerAuth.Config
    return Authorization.of((effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const pathname = new URL(request.url, "http://localhost").pathname
        if (pathname.startsWith("/api/coordination/v1/") || pathname === "/api/health") return yield* effect
        if (runtimeAuthorized(request.headers.authorization, config)) return yield* effect
        yield* HttpEffect.appendPreResponseHandler((_request, response) =>
          Effect.succeed(HttpServerResponse.setHeader(response, "www-authenticate", challenge)),
        )
        return yield* new UnauthorizedError({ message: "Runtime service credentials required" })
      }),
    )
  }),
)

export function runtimeAuthorized(header: string | undefined, config: ServerAuth.Info) {
  if (Option.isNone(config.password) || !config.password.value) return false
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/.exec(header ?? "")
  if (!match) return false
  const raw = Buffer.from(match[1], "base64")
  if (raw.toString("base64") !== match[1]) return false
  const separator = raw.indexOf(58)
  if (separator < 1) return false
  const username = raw.subarray(0, separator).toString("utf8")
  const password = raw.subarray(separator + 1).toString("utf8")
  return (
    username === config.username &&
    timingSafeEqual(
      createHash("sha256").update(password).digest(),
      createHash("sha256").update(config.password.value).digest(),
    )
  )
}
