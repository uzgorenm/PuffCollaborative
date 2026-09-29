import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { ServiceUnavailableError } from "@opencode-ai/protocol/errors"
import { Api } from "../api"
import { CoordinationConfig } from "../coordination-config"

export const CoordinationHandler = HttpApiBuilder.group(Api, "server.coordination", (handlers) =>
  handlers.handle("coordination.status", () =>
    Effect.fail(
      new ServiceUnavailableError({
        service: "coordination",
        message: CoordinationConfig.identitiesPath()
          ? "Coordination adapters are not registered"
          : "Coordination identities and adapters are not configured",
      }),
    ),
  ),
)
