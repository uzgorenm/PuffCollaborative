import { Database } from "bun:sqlite"
import type { CoordinationContracts } from "@opencode-ai/core/coordination/contracts"
import type { SessionSelection } from "@opencode-ai/core/coordination/access/selection"
import { Project } from "@opencode-ai/core/project"
import { Context, Effect, Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { createRoutes } from "../../src/routes"

if (process.env.PUFF_COORDINATION_E2E !== "1") throw new Error("Test entry point is disabled")

const databasePath = process.env.OPENCODE_DB!
const fakeUrl = process.env.PUFF_E2E_FAKE_URL!
const workerId = process.env.PUFF_E2E_WORKER_ID!

const remote = <A>(path: string, payload: unknown) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(`${fakeUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!response.ok) throw new Error(`Fake runner returned ${response.status}`)
      return (await response.json()) as A
    },
    catch: (error): CoordinationContracts.Failure => ({
      code: "unavailable",
      message: error instanceof Error ? error.message : "Fake runner unavailable",
    }),
  })

const runnerPort: CoordinationContracts.RunnerPort = {
  start: (command) => remote("/start", command),
  interrupt: (command) => remote("/interrupt", command).pipe(Effect.asVoid),
  resolveApproval: (command) => remote("/decision", command).pipe(Effect.asVoid),
  reconcile: (runnerMessageId) => remote("/reconcile", { runnerMessageId }),
}

// The external Session fixture adapter reads real OpenCode rows. Project.createThread
// still checks that the resolved project matches the requested shared project.
const sessionBinding: CoordinationContracts.SessionBinding = {
  resolve: (sessionId) =>
    Effect.gen(function* () {
      const row = yield* Effect.try({
        try: () => {
          const db = new Database(databasePath, { readonly: true })
          const result = db.query("SELECT project_id FROM session WHERE id = ?").get(sessionId) as {
            project_id: string
          } | null
          db.close()
          return result
        },
        catch: (): CoordinationContracts.Failure => ({ code: "unavailable", message: "Session lookup failed" }),
      })
      if (!row) return yield* Effect.fail({ code: "not_found" as const, message: "OpenCode session not found" })
      return {
        projectId: Project.ID.make(row.project_id),
        workerId: workerId as CoordinationContracts.RunnerCommand["executionOwner"]["workerId"],
      }
    }),
}

const sessionSelection: SessionSelection = {
  canShareSession: (userId, projectId, sessionId, selectedWorkerId) =>
    Effect.try({
      try: () => {
        const db = new Database(databasePath, { readonly: true })
        try {
          return !!db
            .query(
              "SELECT 1 FROM puff_e2e_session_selection WHERE user_id = ? AND project_id = ? AND session_id = ? AND worker_id = ?",
            )
            .get(userId, projectId, sessionId, selectedWorkerId)
        } finally {
          db.close()
        }
      },
      catch: (): CoordinationContracts.Failure => ({ code: "unavailable", message: "Fixture selection unavailable" }),
    }),
}

const app = HttpRouter.toWebHandler(
  createRoutes(undefined, { runnerPort, sessionBinding, sessionSelection }).pipe(Layer.provide(HttpServer.layerServices)),
  { disableLogger: true },
)
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PUFF_E2E_COORDINATOR_PORT),
  fetch: (request) => app.handler(request, Context.empty() as Parameters<typeof app.handler>[1]),
})

console.log(`coordinator ready ${server.port}`)
process.on("SIGTERM", () => {
  server.stop(true)
  void app.dispose().then(() => process.exit(0))
})
