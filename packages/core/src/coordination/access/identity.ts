import { Effect, Redacted, Schema } from "effect"
import { Coordination } from "@opencode-ai/schema/coordination"
import type { CoordinationContracts } from "../contracts"

const Roster = Schema.Struct({
  identities: Schema.Array(
    Schema.Struct({
      username: Schema.String,
      passwordHash: Schema.String,
      auth: Coordination.AuthContext,
    }),
  ),
})

export type Entry = (typeof Roster.Type)["identities"][number]

const unavailable: CoordinationContracts.Failure = {
  code: "unavailable",
  message: "Coordination identity is unavailable",
}
const unauthorized: CoordinationContracts.Failure = {
  code: "unauthorized",
  message: "Invalid coordination credentials",
}

export const load = Effect.fn("CoordinationIdentity.load")(function* (path: string) {
  const input = yield* Effect.tryPromise({
    try: () => Bun.file(path).json(),
    catch: () => unavailable,
  })
  const roster = yield* Schema.decodeUnknownEffect(Roster)(input).pipe(Effect.mapError(() => unavailable))
  return yield* make(roster.identities)
})

export const make = Effect.fn("CoordinationIdentity.make")(function* (input: ReadonlyArray<Entry>) {
  const entries = new Map<string, Entry>()
  const principals = new Set<string>()
  const members = new Set<Coordination.UserID>()
  for (const entry of input) {
    if (!entry.username || !entry.passwordHash || entries.has(entry.username)) return yield* Effect.fail(unavailable)
    const principal =
      entry.auth.kind === "member"
        ? `member:${entry.auth.userId}`
        : entry.auth.kind === "runner"
          ? `runner:${entry.auth.workerId}:${entry.auth.instanceId}`
          : `analysis:${entry.auth.serviceId}`
    if (principals.has(principal)) return yield* Effect.fail(unavailable)
    entries.set(entry.username, entry)
    principals.add(principal)
    if (entry.auth.kind === "member") members.add(entry.auth.userId)
  }
  if (entries.size === 0) return yield* Effect.fail(unavailable)

  const authenticate: CoordinationContracts.Authentication["authenticate"] = (credentials) =>
    Effect.gen(function* () {
      const entry = entries.get(credentials.username)
      if (!entry) return yield* Effect.fail(unauthorized)
      const valid = yield* Effect.tryPromise({
        try: () => Bun.password.verify(Redacted.value(credentials.password), entry.passwordHash),
        catch: () => unavailable,
      })
      if (!valid) return yield* Effect.fail(unauthorized)
      return entry.auth
    })

  return {
    authenticate,
    hasMember: (userId: Coordination.UserID) => members.has(userId),
  } satisfies CoordinationContracts.Authentication & { readonly hasMember: (userId: Coordination.UserID) => boolean }
})
