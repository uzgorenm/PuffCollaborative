import { expect, test } from "bun:test"
import type { Coordination } from "@opencode-ai/schema/coordination"
import { ProjectApiError } from "@/pages/puff/project-api"
import { createSourcePeek } from "./source-peek"

// Synthetic source fixtures only; these are not live delivery or use evidence.
const ref = { threadId: "thread-a", eventId: "event-a", seq: 11 }
const event = { id: "event-a", projectId: "project-one", threadId: "thread-a", seq: 11,
  kind: "comment.created", occurredAt: "2026-09-29T20:00:00Z", payload: { body: "A source finding" },
} as unknown as Coordination.Event

test("only an exact project/thread/event/sequence citation becomes inspectable", async () => {
  const states: string[] = []
  const peek = createSourcePeek((state) => states.push(state.status))
  peek.setScope("service-one:member-one:session-b", async () => ({ ...event, id: "event-other" }))
  await peek.inspect(ref, "project-one")
  expect(peek.state().status).toBe("missing")
  peek.setScope("service-one:member-one:session-b", async () => event)
  await peek.inspect(ref, "project-one")
  expect(peek.state().status).toBe("ready")
  expect(states).toEqual(["loading", "missing", "closed", "loading", "ready"])
})

test("target or service change aborts and rejects a late response", async () => {
  let release!: (value: Coordination.Event) => void
  let signal: AbortSignal | undefined
  const peek = createSourcePeek(() => {})
  peek.setScope("service-one:member-one:session-b", (_ref, next) => {
    signal = next
    return new Promise((resolve) => { release = resolve })
  })
  const pending = peek.inspect(ref, "project-one")
  expect(peek.state().status).toBe("loading")
  peek.setScope("service-two:member-two:session-c", async () => event)
  expect(signal?.aborted).toBe(true)
  release(event)
  await pending
  expect(peek.state().status).toBe("closed")
})

test("inspection pins the clicked citation even if its source object changes while loading", async () => {
  let release!: (value: Coordination.Event) => void
  const clicked = { ...ref }
  const peek = createSourcePeek(() => {})
  peek.setScope("scope", async () => new Promise((resolve) => { release = resolve }))
  const pending = peek.inspect(clicked, "project-one")
  clicked.eventId = "event-other"
  release(event)
  await pending
  const result = peek.state()
  expect(result.status).toBe("ready")
  expect(result.status === "ready" && result.ref.eventId).toBe("event-a")
})

test("forbidden, missing, and offline reads remain distinct", async () => {
  const peek = createSourcePeek(() => {})
  peek.setScope("scope", async () => { throw new ProjectApiError("unauthorized", 403) })
  await peek.inspect(ref, "project-one")
  expect(peek.state().status).toBe("no-access")
  peek.setScope("scope", async () => { throw new ProjectApiError("request", 404) })
  await peek.inspect(ref, "project-one")
  expect(peek.state().status).toBe("missing")
  peek.setScope("scope", async () => { throw new ProjectApiError("connection") })
  await peek.inspect(ref, "project-one")
  expect(peek.state().status).toBe("unavailable")
})

test("explicit close returns focus to Inspect while a scope change does not focus an old trigger", async () => {
  const inspect = document.createElement("button")
  const other = document.createElement("button")
  document.body.append(inspect, other)
  const peek = createSourcePeek(() => {})
  const resolver = async () => event
  peek.setScope("session-a", resolver)
  await peek.inspect(ref, "project-one", inspect)
  other.focus()
  peek.close(true)
  expect(document.activeElement).toBe(inspect)
  await peek.inspect(ref, "project-one", inspect)
  other.focus()
  peek.setScope("session-b", resolver)
  expect(document.activeElement).toBe(other)
  inspect.remove()
  other.remove()
})
