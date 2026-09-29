export function externalServerUrl(value: string | null | undefined) {
  const input = value?.trim()
  if (!input || !/^https?:\/\/[^/\\\s]+/i.test(input) || /[\\\s]/.test(input) || !URL.canParse(input)) return
  const url = new URL(input)
  if (url.username || url.password || url.search || url.hash) return
  return input.replace(/\/+$/, "")
}

export function initializationData<A>(
  state: (() => A | undefined) & { error: unknown },
  defaultServer?: string | null,
) {
  if (state.error !== undefined) {
    if (externalServerUrl(defaultServer)) return
    throw markLocalServerStartup(state.error)
  }
  return state()
}

function markLocalServerStartup(error: unknown) {
  const failure = error instanceof Error ? error : new Error(String(error))
  const prefix = "Error invoking remote method 'await-initialization': Error: "
  if (failure.message.startsWith(prefix)) {
    const previous = failure.message
    failure.message = failure.message.slice(prefix.length)
    if (failure.stack) failure.stack = failure.stack.replace(`Error: ${previous}`, `Error: ${failure.message}`)
  }
  Object.defineProperty(failure, "localServerStartup", { value: true })
  return failure
}

export function initializationReady<A>(
  state: (() => A | undefined) & { error: unknown; loading: boolean },
  defaultServer?: string | null,
) {
  if (state.loading) return false
  initializationData(state, defaultServer)
  return true
}
