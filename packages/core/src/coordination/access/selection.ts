import { Effect, Schema } from "effect"
import type { Coordination } from "@opencode-ai/schema/coordination"
import type { CoordinationContracts } from "../contracts"

export interface SessionSelection {
  readonly canShareSession: (
    userId: Coordination.UserID,
    projectId: Coordination.ProjectID,
    sessionId: Coordination.Thread["sessionId"],
    workerId: Coordination.WorkerID,
  ) => Effect.Effect<boolean, CoordinationContracts.Failure>
}

const SelectionGrants = Schema.Struct({
  allowed: Schema.Array(
    Schema.Struct({
      userId: Schema.String,
      projectId: Schema.String,
      sessionId: Schema.String,
      workerId: Schema.String,
    }),
  ),
})

const unavailable: CoordinationContracts.Failure = {
  code: "unavailable",
  message: "Development Session selections are unavailable",
}

export const loadDevSessionSelection = Effect.fn("CoordinationSessionSelection.loadDev")(function* (path: string) {
  const input = yield* Effect.tryPromise({ try: () => Bun.file(path).json(), catch: () => unavailable })
  const parsed = yield* Schema.decodeUnknownEffect(SelectionGrants)(input).pipe(Effect.mapError(() => unavailable))
  const allowed = new Set(
    parsed.allowed.map((entry) => JSON.stringify([entry.userId, entry.projectId, entry.sessionId, entry.workerId])),
  )
  return {
    canShareSession: (userId, projectId, sessionId, workerId) =>
      Effect.succeed(allowed.has(JSON.stringify([userId, projectId, sessionId, workerId]))),
  } satisfies SessionSelection
})
