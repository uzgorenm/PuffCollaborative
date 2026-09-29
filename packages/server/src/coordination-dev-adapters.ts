import type { CoordinationContracts } from "@opencode-ai/core/coordination/contracts"
import type { Database } from "@opencode-ai/core/database/database"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { eq } from "drizzle-orm"
import { Effect, Schema } from "effect"

const Admissions = Schema.Struct({
  allowed: Schema.Array(Schema.Struct({ userId: Schema.String, projectId: Schema.String })),
})

const unavailable: CoordinationContracts.Failure = {
  code: "unavailable",
  message: "Trusted project admissions are unavailable",
}

export const loadProjectAdmission = Effect.fn("CoordinationDevAdapters.loadProjectAdmission")(function* (path: string) {
  const input = yield* Effect.tryPromise({ try: () => Bun.file(path).json(), catch: () => unavailable })
  const parsed = yield* Schema.decodeUnknownEffect(Admissions)(input).pipe(Effect.mapError(() => unavailable))
  const allowed = new Set(parsed.allowed.map((entry) => `${entry.userId}\u0000${entry.projectId}`))
  return {
    canShareExistingProject: (userId, projectId) => Effect.succeed(allowed.has(`${userId}\u0000${projectId}`)),
  } satisfies CoordinationContracts.ProjectAdmission
})

export function mockSessionBinding(
  db: Database.Interface["db"],
  workerId: Parameters<CoordinationContracts.Runner["claim"]>[2]["workerId"],
): CoordinationContracts.SessionBinding {
  return {
    resolve: (sessionId) =>
      Effect.gen(function* () {
        const row = yield* db
          .select({ projectId: SessionTable.project_id })
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionId))
          .get()
          .pipe(Effect.orDie)
        if (!row) return yield* Effect.fail({ code: "not_found" as const, message: "OpenCode session not found" })
        return { projectId: row.projectId, workerId }
      }),
  }
}
