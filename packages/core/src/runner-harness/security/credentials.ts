export * as RunnerCredentials from "./credentials"

import { Coordination } from "@opencode-ai/schema/coordination"
import { Effect, Redacted } from "effect"
import type { CoordinationContracts } from "../../coordination/contracts"
import type { RunnerHarnessContracts } from "../contracts"

export interface Config {
  readonly authentication: CoordinationContracts.Authentication
  readonly username: string
  readonly password: Redacted.Redacted
  readonly runtimePassword: Redacted.Redacted
  readonly providerPasswords?: ReadonlyArray<Redacted.Redacted>
  readonly owner: Coordination.ExecutionOwner
}

const unavailable: RunnerHarnessContracts.Failure = {
  code: "unavailable",
  message: "Runner service credentials are not configured",
}
const unauthorized: RunnerHarnessContracts.Failure = {
  code: "unauthorized",
  message: "Runner service credentials are invalid",
}
const forbidden: RunnerHarnessContracts.Failure = {
  code: "forbidden",
  message: "Runner execution owner does not match the configured service identity",
}

export const make = Effect.fn("RunnerCredentials.make")(function* (config: Config) {
  if (!config.username.trim() || !Redacted.value(config.password)) return yield* Effect.fail(unavailable)
  if (!config.owner.workerId || !config.owner.instanceId) return yield* Effect.fail(unavailable)
  const servicePassword = Redacted.value(config.password)
  const runtimePassword = Redacted.value(config.runtimePassword)
  if (!runtimePassword || servicePassword === runtimePassword) return yield* Effect.fail(unavailable)
  if (
    config.providerPasswords?.some((password) => [servicePassword, runtimePassword].includes(Redacted.value(password)))
  )
    return yield* Effect.fail(unavailable)

  const identity = yield* config.authentication
    .authenticate({ username: config.username, password: config.password })
    .pipe(Effect.mapError((error) => (error.code === "unavailable" ? error : unauthorized)))
  if (identity.kind !== "runner") return yield* Effect.fail(forbidden)
  if (identity.workerId !== config.owner.workerId || identity.instanceId !== config.owner.instanceId)
    return yield* Effect.fail(forbidden)

  const principal: RunnerHarnessContracts.Credentials["principal"] = (owner) =>
    owner.workerId === identity.workerId && owner.instanceId === identity.instanceId
      ? Effect.succeed(identity)
      : Effect.fail(forbidden)

  return {
    principal,
    verify: (owner) => principal(owner).pipe(Effect.asVoid),
  } satisfies RunnerHarnessContracts.Credentials
})
