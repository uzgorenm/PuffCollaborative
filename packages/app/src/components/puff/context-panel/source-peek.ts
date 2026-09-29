import type { Coordination } from "@opencode-ai/schema/coordination"
import { ProjectApiError } from "@/pages/puff/project-api"

export type SourceRef = { threadId: string; eventId: string; seq: number }
export type SourceResolver = (ref: SourceRef, signal: AbortSignal) => Promise<Coordination.Event>
export type SourcePeekState =
  | { status: "closed" }
  | { status: "loading" | "missing" | "no-access" | "unavailable"; ref: SourceRef }
  | { status: "ready"; ref: SourceRef; event: Coordination.Event }

export function createSourcePeek(onChange: (state: SourcePeekState) => void) {
  let current: SourcePeekState = { status: "closed" }
  let scope = ""
  let resolver: SourceResolver | undefined
  let controller: AbortController | undefined
  let trigger: HTMLElement | undefined
  let generation = 0
  const publish = (state: SourcePeekState) => {
    current = state
    onChange(state)
  }
  const clear = () => {
    controller?.abort()
    controller = undefined
    generation++
    if (current.status !== "closed") publish({ status: "closed" })
  }
  return {
    state: () => current,
    setScope(nextScope: string, nextResolver?: SourceResolver) {
      if (scope === nextScope && resolver === nextResolver) return
      clear()
      trigger = undefined
      scope = nextScope
      resolver = nextResolver
    },
    async inspect(ref: SourceRef, projectId: string, nextTrigger?: HTMLElement) {
      if (!scope || !resolver) return
      clear()
      trigger = nextTrigger
      const expected = { threadId: ref.threadId, eventId: ref.eventId, seq: ref.seq }
      const request = ++generation
      const signal = (controller = new AbortController()).signal
      const source = resolver
      const selectedScope = scope
      publish({ status: "loading", ref: expected })
      try {
        const task = source(expected, signal)
        const event = await task
        if (request !== generation || signal.aborted || scope !== selectedScope || resolver !== source) return
        publish(event.projectId === projectId && event.threadId === expected.threadId &&
          event.id === expected.eventId && event.seq === expected.seq
          ? { status: "ready", ref: expected, event }
          : { status: "missing", ref: expected })
      } catch (error) {
        if (request !== generation || signal.aborted || scope !== selectedScope || resolver !== source) return
        publish({ status: error instanceof ProjectApiError && [401, 403].includes(error.status) ? "no-access"
          : error instanceof ProjectApiError && error.status === 404 ? "missing" : "unavailable", ref: expected })
      }
    },
    close(returnFocus = false) {
      const restore = trigger
      clear()
      trigger = undefined
      if (returnFocus && restore?.isConnected) restore.focus()
    },
  }
}
