import { Effect, Schema } from "effect"
import { Model } from "@opencode-ai/schema/model"
import { Coordination } from "@opencode-ai/schema/coordination"
import type { CoordinationProvisioning } from "./index"

const ConfigFile = Schema.Struct({
  workspaceRoot: Schema.String,
  worker: Schema.Struct({ workerId: Coordination.WorkerID, instanceId: Schema.String }),
  model: Schema.optional(Model.Ref),
  providerConfigPath: Schema.optional(Schema.String),
  projects: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      repositoryRoot: Schema.String,
      baseRevision: Schema.String,
      allowedUsers: Schema.Array(Coordination.UserID),
    }),
  ),
})

export const loadProvisioningConfig = (file: string): Effect.Effect<CoordinationProvisioning.Config | undefined> =>
  Effect.tryPromise({ try: () => Bun.file(file).json(), catch: () => undefined }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(ConfigFile)),
    Effect.match({ onFailure: () => undefined, onSuccess: (value) => value }),
  )
