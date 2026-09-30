import { Duration, Effect, Fiber, FiberSet } from "effect"

/** Provider setup belongs to the server lifetime, never to a single catalogue request. */
export const makeModelReadiness = Effect.fn("makeModelReadiness")(function* (options?: {
  readonly responseTimeout?: Duration.Input
  readonly refreshMs?: number
}) {
  const fork = yield* FiberSet.makeRuntime<never, boolean, never>()
  const checks = new Map<string, { fiber: Fiber.Fiber<boolean>; startedAt: number }>()
  return (key: string, check: Effect.Effect<boolean>) =>
    Effect.suspend(() => {
      const previous = checks.get(key)
      const cached =
        previous &&
        (previous.fiber.pollUnsafe() === undefined || Date.now() - previous.startedAt < (options?.refreshMs ?? 2000))
      const current = cached ? previous : { fiber: fork(check), startedAt: Date.now() }
      checks.set(key, current)
      return Fiber.join(current.fiber).pipe(
        Effect.timeoutOption(options?.responseTimeout ?? "1500 millis"),
        Effect.map((value) => value._tag === "Some" && value.value),
      )
    })
})
