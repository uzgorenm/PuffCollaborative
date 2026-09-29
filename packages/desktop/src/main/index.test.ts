import { describe, expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber } from "effect"
import { developmentStartup, forwardInitializationFailure } from "./initialization"

describe("desktop initialization", () => {
  test("keeps ordinary development startup local", () => {
    expect(developmentStartup({ packaged: false })).toEqual({})
  })

  test("ignores development overrides in packaged apps", () => {
    expect(developmentStartup({ packaged: true, serverUrl: "invalid", profilePath: "relative" })).toEqual({})
  })

  test.each(["http://127.0.0.1:4466", "https://server.example"])(
    "accepts explicit external development server %s with an isolated profile",
    (serverUrl) => {
      expect(developmentStartup({ packaged: false, serverUrl, profilePath: "/tmp/puff-desktop-test" })).toEqual({
        serverUrl,
        profilePath: "/tmp/puff-desktop-test",
      })
    },
  )

  test.each([
    "",
    "sidecar",
    "localhost:4466",
    "file:///tmp/server",
    "https:///server.example",
    "https://server.example:invalid",
    "https://server.example\\path",
    "https://server.example/path with spaces",
    "https://user:secret@server.example",
    "https://server.example?token=secret",
    "https://server.example#fragment",
  ])("rejects invalid explicit development server %s without falling back to a sidecar", (serverUrl) => {
    expect(() => developmentStartup({ packaged: false, serverUrl })).toThrow()
  })

  test("requires an absolute development profile path", () => {
    expect(() => developmentStartup({ packaged: false, profilePath: "relative/profile" })).toThrow()
  })

  const failure = new Error("sidecar startup failed")
  const expectFailure = (exit: Exit.Exit<unknown, unknown>) => {
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isSuccess(exit)) return
    expect(Cause.squash(exit.cause)).toBe(failure)
  }

  test("forwards loading task failures before renderer initialization", () => {
    const exit = Effect.runSync(
      Effect.gen(function* () {
        const initialization = yield* Deferred.make<never, unknown>()
        yield* forwardInitializationFailure(initialization)(Effect.die(failure)).pipe(Effect.exit)
        return yield* Deferred.await(initialization).pipe(Effect.exit)
      }),
    )

    expectFailure(exit)
  })

  test("forwards loading task failures while renderer initialization waits", () => {
    const exit = Effect.runSync(
      Effect.gen(function* () {
        const initialization = yield* Deferred.make<never, unknown>()
        const waiting = yield* Deferred.await(initialization).pipe(Effect.exit, Effect.forkChild)
        yield* forwardInitializationFailure(initialization)(Effect.die(failure)).pipe(Effect.exit)
        return yield* Fiber.join(waiting)
      }),
    )

    expectFailure(exit)
  })
})
