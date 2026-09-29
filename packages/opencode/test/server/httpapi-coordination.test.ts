import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { httpApiLayer, request } from "./httpapi-layer"

const unconfiguredCoordination = Layer.effectDiscard(
  Effect.gen(function* () {
    const original = new Map(
      [
        "OPENCODE_COORDINATION_IDENTITIES_PATH",
        "OPENCODE_COORDINATION_ADMISSIONS_PATH",
        "OPENCODE_COORDINATION_MOCK_RUNNER",
      ].map((key) => [key, process.env[key]]),
    )
    original.forEach((_, key) => delete process.env[key])
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        original.forEach((value, key) => {
          if (value === undefined) {
            delete process.env[key]
            return
          }
          process.env[key] = value
        })
      }),
    )
  }),
)

const it = testEffect(httpApiLayer.pipe(Layer.provide(unconfiguredCoordination)))

describe("legacy HttpApi coordination startup", () => {
  it.live("serves health while unconfigured coordination returns unavailable", () =>
    Effect.gen(function* () {
      const health = yield* request("/api/health")
      expect(health.status).toBe(200)
      expect(yield* health.json).toEqual({ healthy: true })

      const status = yield* request("/api/coordination/v1/status")
      expect(status.status).toBe(503)
      expect(yield* status.json).toMatchObject({
        _tag: "ServiceUnavailableError",
        service: "coordination",
      })

      const projects = yield* request("/api/coordination/v1/projects")
      expect(projects.status).toBe(503)
      expect(yield* projects.json).toMatchObject({
        _tag: "ServiceUnavailableError",
        service: "coordination",
      })
    }),
  )
})
