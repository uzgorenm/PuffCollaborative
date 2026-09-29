import { expect, test } from "bun:test"
import { Coordination } from "@opencode-ai/schema/coordination"
import { Effect, Redacted } from "effect"
import { make as makeAuthentication } from "../../../src/coordination/access/identity"
import { RunnerCredentials } from "../../../src/runner-harness/security/credentials"

const owner = { workerId: Coordination.WorkerID.make("worker-fixture"), instanceId: "instance-fixture" }

test("runner service credential is checked against worker and instance scope", async () => {
  const authentication = await Effect.runPromise(
    makeAuthentication([
      {
        username: "runner-fixture",
        passwordHash: await Bun.password.hash("synthetic-service-secret"),
        auth: { kind: "runner", ...owner },
      },
      {
        username: "browser-fixture",
        passwordHash: await Bun.password.hash("synthetic-browser-secret"),
        auth: { kind: "member", userId: Coordination.UserID.make("user-fixture") },
      },
    ]),
  )

  const credentials = await Effect.runPromise(
    RunnerCredentials.make({
      authentication,
      username: "runner-fixture",
      password: Redacted.make("synthetic-service-secret"),
      runtimePassword: Redacted.make("synthetic-runtime-secret"),
      owner,
    }),
  )
  expect(await Effect.runPromise(credentials.principal(owner))).toEqual({ kind: "runner", ...owner })
  expect(
    await Effect.runPromise(Effect.flip(credentials.principal({ ...owner, instanceId: "other-instance" }))),
  ).toMatchObject({ code: "forbidden" })
  expect(
    await Effect.runPromise(
      Effect.flip(
        RunnerCredentials.make({
          authentication,
          username: "runner-fixture",
          password: Redacted.make("invalid-synthetic-secret"),
          runtimePassword: Redacted.make("synthetic-runtime-secret"),
          owner,
        }),
      ),
    ),
  ).toMatchObject({ code: "unauthorized" })
  expect(
    await Effect.runPromise(
      Effect.flip(
        RunnerCredentials.make({
          authentication,
          username: "browser-fixture",
          password: Redacted.make("synthetic-browser-secret"),
          runtimePassword: Redacted.make("synthetic-runtime-secret"),
          owner,
        }),
      ),
    ),
  ).toMatchObject({ code: "forbidden" })
  expect(
    await Effect.runPromise(
      Effect.flip(
        RunnerCredentials.make({
          authentication,
          username: "runner-fixture",
          password: Redacted.make("synthetic-service-secret"),
          runtimePassword: Redacted.make("synthetic-service-secret"),
          owner,
        }),
      ),
    ),
  ).toMatchObject({ code: "unavailable" })
})
