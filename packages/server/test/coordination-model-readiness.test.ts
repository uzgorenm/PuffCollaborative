import { expect, test } from "bun:test"
import { Deferred, Effect } from "effect"
import { makeModelReadiness } from "../src/coordination-model-readiness"

test("bounded readiness replies while provider initialization continues and is reused", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const gate = yield* Deferred.make<boolean>()
        const ready = yield* makeModelReadiness({ responseTimeout: "25 millis", refreshMs: 1000 })
        let attempts = 0
        const check = Effect.sync(() => {
          attempts++
        }).pipe(Effect.andThen(Deferred.await(gate)))
        expect(yield* ready("provider-model", check)).toBe(false)
        expect(yield* ready("provider-model", check)).toBe(false)
        expect(attempts).toBe(1)
        yield* Deferred.succeed(gate, true)
        expect(yield* ready("provider-model", check)).toBe(true)
        expect(attempts).toBe(1)
      }),
    ),
  )
})
