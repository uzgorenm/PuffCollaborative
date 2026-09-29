import { expect, test } from "bun:test"
import { Effect, Exit, Redacted } from "effect"
import { Coordination } from "@opencode-ai/schema/coordination"
import { make } from "../../../src/coordination/access/identity"

test("individual Basic credentials resolve stable member identities", async () => {
  const authentication = await Effect.runPromise(
    make([
      {
        username: "alice",
        passwordHash: await Bun.password.hash("alice-secret"),
        auth: { kind: "member", userId: Coordination.UserID.make("usr_alice") },
      },
      {
        username: "bob",
        passwordHash: await Bun.password.hash("bob-secret"),
        auth: { kind: "member", userId: Coordination.UserID.make("usr_bob") },
      },
    ]),
  )

  expect(
    await Effect.runPromise(
      authentication.authenticate({ username: "alice", password: Redacted.make("alice-secret") }),
    ),
  ).toEqual({ kind: "member", userId: Coordination.UserID.make("usr_alice") })
  expect(
    await Effect.runPromise(authentication.authenticate({ username: "bob", password: Redacted.make("bob-secret") })),
  ).toEqual({ kind: "member", userId: Coordination.UserID.make("usr_bob") })
  expect(authentication.hasMember(Coordination.UserID.make("usr_bob"))).toBe(true)
  expect(authentication.hasMember(Coordination.UserID.make("usr_unseeded"))).toBe(false)
  const rejected = await Effect.runPromise(
    Effect.exit(authentication.authenticate({ username: "alice", password: Redacted.make("bob-secret") })),
  )
  expect(Exit.isFailure(rejected)).toBe(true)
  if (Exit.isFailure(rejected)) {
    const reason = rejected.cause.reasons[0]
    expect(reason?._tag).toBe("Fail")
    if (reason?._tag === "Fail") expect(reason.error.code).toBe("unauthorized")
  }
  const duplicate = await Effect.runPromise(
    Effect.exit(
      make([
        {
          username: "alice",
          passwordHash: await Bun.password.hash("alice-secret"),
          auth: { kind: "member", userId: Coordination.UserID.make("usr_alice") },
        },
        {
          username: "alice-alias",
          passwordHash: await Bun.password.hash("alias-secret"),
          auth: { kind: "member", userId: Coordination.UserID.make("usr_alice") },
        },
      ]),
    ),
  )
  expect(Exit.isFailure(duplicate)).toBe(true)
})
