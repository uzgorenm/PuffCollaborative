import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { EventV2 } from "@opencode-ai/core/event"
import { Git } from "@opencode-ai/core/git"
import { AppProcess } from "@opencode-ai/core/process"
import { ProjectV2 } from "@opencode-ai/core/project"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { CoordinationEvents } from "@opencode-ai/core/coordination/events/events"
import { Credential } from "@opencode-ai/core/credential"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { PtyTicket } from "@opencode-ai/core/pty/ticket"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { SessionExecutionLocal } from "@opencode-ai/core/session/execution/local"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Layer, Option } from "effect"
import { Api } from "./api"
import { ServerAuth } from "./auth"
import { handlers } from "./handlers"
import { authorizationLayer } from "./middleware/authorization"
import { schemaErrorLayer } from "./middleware/schema-error"
import { PtyEnvironment } from "./pty-environment"
import { layer as locationLayer } from "./location"
import { sessionLocationLayer } from "./middleware/session-location"
import { coordinationAuthLayer } from "./middleware/coordination-auth"
import { coordinationLayer } from "./coordination-composition"
import type { CoordinationPorts } from "./coordination-composition"
import { configuredRunnerFactory } from "./runner-harness-composition"
import { RunnerHarnessConfig } from "./runner-harness-config"
import { runnerHarnessAuthorizationLayer } from "./runner-harness-authorization"
import { runnerHarnessBoundaryLayer } from "./runner-harness-boundary"

const applicationServices = LayerNode.group([
  Database.node,
  EventV2.node,
  Git.node,
  AppProcess.node,
  ProjectV2.node,
  EffectFlock.node,
  httpClient,
  ToolOutputStore.cleanupNode,
  SessionV2.node,
  SessionExecution.node,
  PermissionSaved.node,
  PtyTicket.node,
  Credential.node,
  PtyEnvironment.node,
  LocationServiceMap.node,
])

export function createRoutes<R = never>(password?: string, coordinationPorts: CoordinationPorts<R> = {}) {
  return makeRoutes(
    password
      ? ServerAuth.Config.configLayer({ username: "opencode", password: Option.some(password) })
      : ServerAuth.Config.layer,
    coordinationPorts,
  )
}

export function createEmbeddedRoutes<R = never>(coordinationPorts: CoordinationPorts<R> = {}) {
  return makeRoutes(ServerAuth.Config.configLayer({ username: "opencode", password: Option.none() }), coordinationPorts)
}

function makeRoutes<AuthError, AuthServices, R>(
  auth: Layer.Layer<ServerAuth.Config, AuthError, AuthServices>,
  coordinationPorts: CoordinationPorts<R>,
) {
  const serviceLayer = AppNodeBuilder.build(applicationServices, [[SessionExecution.node, SessionExecutionLocal.node]])

  return HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }).pipe(
    Layer.provide(handlers),
    Layer.provide(sessionLocationLayer),
    Layer.provide(locationLayer),
    Layer.provide(RunnerHarnessConfig.path() ? runnerHarnessAuthorizationLayer : authorizationLayer),
    Layer.provide(runnerHarnessBoundaryLayer),
    Layer.provide(coordinationAuthLayer),
    Layer.provide(coordinationLayer(coordinationPorts)),
    Layer.provide(CoordinationEvents.layer),
    Layer.provide(schemaErrorLayer),
    Layer.provide(auth),
    Layer.provide(serviceLayer),
  )
}

const runnerFactory = configuredRunnerFactory()
export const routes = createRoutes(undefined, runnerFactory ? { runnerFactory } : {})

export const webHandler = () =>
  HttpRouter.toWebHandler(routes.pipe(Layer.provide(HttpServer.layerServices)), { disableLogger: true })
