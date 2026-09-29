export * as RunnerHarnessConfig from "./runner-harness-config"

import { Effect, Redacted, Schema } from "effect"
import { Global } from "@opencode-ai/core/global"
import type { RunnerHarnessContracts } from "@opencode-ai/core/runner-harness/contracts"
import type { Config } from "./runner-harness-composition"

const File = Schema.Struct({
  owner: Schema.Struct({ workerId: Schema.String, instanceId: Schema.String }),
  username: Schema.String,
  workspaceRoot: Schema.String,
  projects: Schema.Array(
    Schema.Struct({
      projectId: Schema.String,
      repositoryRoot: Schema.String,
      baseRevision: Schema.String,
    }),
  ),
  toolPath: Schema.String,
  destinations: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  allowedDestinationHosts: Schema.optional(Schema.Array(Schema.String)),
  allowLoopbackDestination: Schema.optional(Schema.Boolean),
  deliveryBatchSize: Schema.optional(Schema.Int),
  deliveryIntervalMs: Schema.optional(Schema.Int),
})

const unavailable: RunnerHarnessContracts.Failure = {
  code: "unavailable",
  message: "Runner configuration is unavailable",
}

export function path() {
  return process.env.OPENCODE_RUNNER_CONFIG_PATH?.trim() || undefined
}

/** The file contains approved locations; service passwords come only from process secrets. */
export const load = Effect.fn("RunnerHarnessConfig.load")(function* () {
  const file = path()
  const password = process.env.OPENCODE_RUNNER_PASSWORD
  const runtimePassword = process.env.OPENCODE_SERVER_PASSWORD
  if (!file || !password || !runtimePassword || password === runtimePassword) return yield* Effect.fail(unavailable)
  const document = yield* Effect.tryPromise({ try: () => Bun.file(file).json(), catch: () => unavailable })
  const parsed = yield* Schema.decodeUnknownEffect(File)(document).pipe(Effect.mapError(() => unavailable))
  if (
    !parsed.owner.workerId.trim() ||
    !parsed.owner.instanceId.trim() ||
    !parsed.username.trim() ||
    !parsed.workspaceRoot.trim() ||
    !parsed.toolPath.trim() ||
    !parsed.projects.length ||
    parsed.projects.some((item) => !item.projectId.trim() || !item.repositoryRoot.trim())
  )
    return yield* Effect.fail(unavailable)
  return {
    owner: parsed.owner as Config["owner"],
    username: parsed.username,
    password: Redacted.make(password),
    runtimePassword: Redacted.make(runtimePassword),
    workspaceRoot: parsed.workspaceRoot,
    projects: parsed.projects as Config["projects"],
    toolPath: parsed.toolPath,
    destinations: parsed.destinations,
    allowedDestinationHosts: parsed.allowedDestinationHosts,
    allowLoopbackDestination: parsed.allowLoopbackDestination,
    dataDirectory: Global.Path.data,
    deliveryBatchSize: parsed.deliveryBatchSize,
    deliveryIntervalMs: parsed.deliveryIntervalMs,
  } satisfies Config
})
