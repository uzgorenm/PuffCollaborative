import { Context, Effect, Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { createRoutes } from "../src/routes"
import { makeRunnerFactory } from "../src/runner-harness-composition"
import { RunnerHarnessConfig } from "../src/runner-harness-config"

if (process.env.R13_RUNNER_FIXTURE !== "1") throw new Error("R13 process fixture is disabled")

const unavailable = { code: "unavailable" as const, message: "R13 coordinator callback fixture is offline" }
const config = await Effect.runPromise(RunnerHarnessConfig.load())
const factory = makeRunnerFactory(config)
const app = HttpRouter.toWebHandler(
  createRoutes(undefined, {
    runnerFactory: (input) =>
      Effect.map(factory(input), (assembled) => ({
        ...assembled,
        ready: (runner) =>
          assembled.ready({
            ...runner,
            report: (request) =>
              Effect.gen(function* () {
                if (yield* Effect.promise(() => Bun.file(process.env.R13_CALLBACK_OUTAGE_PATH!).exists()))
                  return yield* Effect.fail(unavailable)
                return yield* runner.report(request)
              }),
          }),
      })),
  }).pipe(Layer.provide(HttpServer.layerServices)),
  { disableLogger: true },
)
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request) => app.handler(request, Context.empty() as Parameters<typeof app.handler>[1]),
})
await Bun.write(process.env.R13_READY_PATH!, `http://127.0.0.1:${server.port}`)
process.on("SIGTERM", () => {
  server.stop(true)
  void app.dispose().then(() => process.exit(0))
})
