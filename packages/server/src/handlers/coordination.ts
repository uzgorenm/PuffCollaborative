import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { ServiceUnavailableError } from "@opencode-ai/protocol/errors"
import { Api } from "../api"
import { CoordinationRuntime } from "../coordination-runtime"

export const CoordinationHandler = HttpApiBuilder.group(Api, "server.coordination", (handlers) =>
  handlers.handle("coordination.status", () =>
    Effect.gen(function* () {
      const runtime = yield* CoordinationRuntime
      if (runtime.services) return { ready: true as const }
      return yield* new ServiceUnavailableError({
        service: "coordination",
        message: `Missing coordination adapters: ${runtime.missing.join(", ")}`,
      })
    }),
  ),
)
