import { Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { RunnerHarnessConfig } from "./runner-harness-config"

const readMethods = new Set(["GET", "HEAD", "OPTIONS"])

/** In harness mode, only coordinator commands may mutate an existing Session. */
export const runnerHarnessBoundaryLayer = HttpRouter.middleware()(
  Effect.gen(function* () {
    return (effect) =>
      Effect.gen(function* () {
        if (!RunnerHarnessConfig.path()) return yield* effect
        const request = yield* HttpServerRequest.HttpServerRequest
        const pathname = new URL(request.url, "http://localhost").pathname
        if (pathname.startsWith("/api/coordination/v1/")) return yield* effect
        if (
          !process.env.OPENCODE_SERVER_PASSWORD &&
          pathname !== "/api/health"
        )
          return HttpServerResponse.jsonUnsafe(
            { code: "unavailable", message: "Runner runtime credentials are unavailable" },
            { status: 503 },
          )
        if (
          !request.headers.upgrade &&
          !pathname.startsWith("/tui/") &&
          (readMethods.has(request.method) || (request.method === "POST" && pathname === "/api/session"))
        )
          return yield* effect
        return HttpServerResponse.jsonUnsafe(
          { code: "forbidden", message: "Runtime mutations require a coordinator Run" },
          { status: 403 },
        )
      })
  }),
).layer
