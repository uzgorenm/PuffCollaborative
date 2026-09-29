import type { Coordination } from "@opencode-ai/schema/coordination"
import { Context } from "effect"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { ServiceUnavailableError, UnauthorizedError } from "../errors"

export class CoordinationPrincipal extends Context.Service<CoordinationPrincipal, Coordination.AuthContext>()(
  "@opencode/HttpApiCoordinationPrincipal",
) {}

export class CoordinationAuth extends HttpApiMiddleware.Service<
  CoordinationAuth,
  { provides: CoordinationPrincipal }
>()("@opencode/HttpApiCoordinationAuth", {
  error: [UnauthorizedError, ServiceUnavailableError],
}) {}
