import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ServiceUnavailableError } from "../errors"

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
