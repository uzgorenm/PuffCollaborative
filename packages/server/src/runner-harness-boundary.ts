import { Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { RunnerHarnessConfig } from "./runner-harness-config"

/** A configured harness exposes only coordinator commands and liveness over HTTP. */
export const runnerHarnessBoundaryLayer = HttpRouter.middleware()(
  Effect.gen(function* () {
    return (effect) =>
      Effect.gen(function* () {
        if (!RunnerHarnessConfig.path()) return yield* effect
        const request = yield* HttpServerRequest.HttpServerRequest
        const pathname = new URL(request.url, "http://localhost").pathname
        if (!request.headers.upgrade && pathname.startsWith("/api/coordination/v1/")) return yield* effect
        if (!request.headers.upgrade && request.method === "GET" && pathname === "/api/health") return yield* effect
        return HttpServerResponse.jsonUnsafe(
          { code: "forbidden", message: "OpenCode runtime routes are closed in harness mode" },
          { status: 403 },
        )
      })
  }),
).layer
