import { Deferred, Effect } from "effect"
import { isAbsolute } from "node:path"

export function developmentStartup(input: { packaged: boolean; serverUrl?: string; profilePath?: string }) {
  if (input.packaged) return {}
  const profilePath = input.profilePath?.trim()
  if (input.profilePath !== undefined && (!profilePath || !isAbsolute(profilePath)))
    throw new TypeError("OPENCODE_DESKTOP_PROFILE must be an absolute path")
  const serverUrl = input.serverUrl?.trim()
  if (input.serverUrl !== undefined) {
    if (!serverUrl || !/^https?:\/\/[^/\\\s]+/i.test(serverUrl) || /[\\\s]/.test(serverUrl) || !URL.canParse(serverUrl))
      throw new TypeError("OPENCODE_DESKTOP_SERVER_URL must be an explicit HTTP(S) URL")
    const url = new URL(serverUrl)
    if (url.username || url.password || url.search || url.hash)
      throw new TypeError("OPENCODE_DESKTOP_SERVER_URL cannot contain credentials, a query, or a fragment")
  }
  return {
    ...(serverUrl ? { serverUrl: serverUrl.replace(/\/+$/, "") } : {}),
    ...(profilePath ? { profilePath } : {}),
  }
}

export function forwardInitializationFailure<A>(initialization: Deferred.Deferred<A, unknown>) {
  return <B, E, R>(effect: Effect.Effect<B, E, R>) =>
    effect.pipe(Effect.tapCause((cause) => Deferred.failCause(initialization, cause)))
}
