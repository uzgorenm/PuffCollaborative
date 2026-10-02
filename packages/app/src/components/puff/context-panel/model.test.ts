import { expect, test } from "bun:test"
import type { Coordination } from "@opencode-ai/schema/coordination"
import type { TeamThread } from "@/pages/puff/team-api"
import { canOfferDecisionRetry, selectContext } from "./model"

// Synthetic UI fixtures: these do not represent a live OpenCode receipt.
const thread = (id: string, sessionId: string, workerId = "worker-one") => ({
  id, projectId: "project-one", sessionId, workerId, title: id,
  createdBy: "serdar", createdAt: "2026-09-29T20:00:00Z", activitySeq: 12,
}) as Coordination.Thread

const snapshot = (id = "thread-a", sessionId = "session-a", workerId = "worker-one") => ({
  thread: thread(id, sessionId, workerId), instructions: [], runs: [], approvals: [], cursor: 12,
  workCard: {
    id: "card-a", threadId: id, version: 2, sourceActivitySeq: 12,
    currentTask: "Explore compact navigation", progress: "Checking keyboard focus",
    blockers: [], status: "active", updatedAt: "2026-09-29T20:01:00Z", summaryJobId: "job-a",
    recentVerifiedOutcome: "Focus constraint recorded",
    evidenceRefs: [{ threadId: id, eventId: "event-a", seq: 11 }],
  },
}) as unknown as TeamThread

test("a bound thread exposes only its own current card and run", () => {
  const a = snapshot()
  const ownRun = {
    id: "run-a", threadId: "thread-a", instructionId: "instruction-a", state: "running",
    attempt: 1, runnerMessageId: "message-a", createdAt: "2026-09-29T20:01:00Z",
  } as Coordination.Run
  const view = selectContext({
    target: { threadId: "thread-a", sessionId: "session-a", workerId: "worker-one" },
    snapshot: { ...a, runs: [ownRun, { ...ownRun, id: "run-b", threadId: "thread-b" } as unknown as Coordination.Run] },
    connected: true, loading: false,
  })
  expect(view.state).toBe("ready")
  expect(view.card?.currentTask).toBe("Explore compact navigation")
  expect(view.activeRuns.map((run) => String(run.id))).toEqual(["run-a"])
  expect(view.verifiedOutcome).toBe("Focus constraint recorded")
})

test("switching A to B immediately hides A's context even when A's response arrives late", () => {
  const a = snapshot()
  const view = selectContext({
    target: { threadId: "thread-b", sessionId: "session-b", workerId: "worker-one" },
    snapshot: a, related: [a.thread, thread("thread-b", "session-b")],
    connected: true, loading: false,
  })
  expect(view.state).toBe("unbound")
  expect(view.card).toBeUndefined()
  expect(view.sources).toEqual([])
  expect(view.activeRuns).toEqual([])
})

test("missing worker or thread identity never treats a same-owner session as bound", () => {
  const a = snapshot()
  for (const target of [{ sessionId: "session-a" }, { sessionId: "session-a", workerId: "worker-one" }]) {
    const view = selectContext({ target, snapshot: a, connected: true, loading: false })
    expect(view.state).toBe("unbound")
    expect(view.card).toBeUndefined()
  }
})

test("offline and failed refresh hide cached context rather than presenting it as current", () => {
  const a = snapshot()
  const input = {
    target: { threadId: "thread-a", sessionId: "session-a", workerId: "worker-one" },
    snapshot: a, connected: true, loading: false,
  }
  expect(selectContext({ ...input, connected: false }).state).toBe("offline")
  expect(selectContext({ ...input, error: "connection" }).state).toBe("unavailable")
  expect(selectContext({ ...input, error: "connection" }).card).toBeUndefined()
})

test("older card is marked stale and a future or wrong-thread card is withheld", () => {
  const a = snapshot()
  const input = {
    target: { threadId: "thread-a", sessionId: "session-a", workerId: "worker-one" },
    connected: true, loading: false,
  }
  expect(selectContext({ ...input, snapshot: { ...a, workCard: { ...a.workCard!, sourceActivitySeq: 10 } } as TeamThread }).stale).toBe(true)
  expect(selectContext({ ...input, snapshot: { ...a, workCard: { ...a.workCard!, sourceActivitySeq: 13 } } as TeamThread }).card).toBeUndefined()
  expect(selectContext({ ...input, snapshot: { ...a, workCard: { ...a.workCard!, threadId: "thread-b" } } as unknown as TeamThread }).card).toBeUndefined()
})

test("source links require an accessible same-project thread and a bounded sequence", () => {
  const a = snapshot()
  const b = thread("thread-b", "session-b")
  const privateThread = { ...thread("thread-private", "session-private"), projectId: "other-project" } as unknown as Coordination.Thread
  const view = selectContext({
    target: { threadId: "thread-a", sessionId: "session-a", workerId: "worker-one" },
    snapshot: { ...a, workCard: { ...a.workCard!, evidenceRefs: [
      { threadId: "thread-a", eventId: "event-a", seq: 11 },
      { threadId: "thread-b", eventId: "event-b", seq: 10 },
      { threadId: "thread-private", eventId: "event-private", seq: 10 },
      { threadId: "thread-b", eventId: "event-future", seq: 99 },
    ] } } as unknown as TeamThread,
    related: [a.thread, b, privateThread], connected: true, loading: false,
  })
  expect(view.sources.map((source) => source.eventId)).toEqual(["event-a", "event-b"])
  expect(view.alternatives).toEqual([])
})

test("a card without source receipts cannot advertise a verified outcome", () => {
  const a = snapshot()
  const view = selectContext({
    target: { threadId: "thread-a", sessionId: "session-a", workerId: "worker-one" },
    snapshot: { ...a, workCard: { ...a.workCard!, evidenceRefs: [] } } as TeamThread,
    connected: true, loading: false,
  })
  expect(view.verifiedOutcome).toBeUndefined()
  expect(view.sources).toEqual([])
})

test("decided tool approvals keep pending and failed delivery visible without calling them completed", () => {
  const a = snapshot()
  const approval = (id: string, threadId: string, deliveryState: "pending" | "failed" | "delivered") => ({
    id, threadId, runId: "run-a", toolCallId: "tool-a", version: 2, state: "rejected",
    requestedAt: "2026-09-29T20:00:00Z", deliveryState,
  }) as unknown as Coordination.Approval
  const view = selectContext({
    target: { threadId: "thread-a", sessionId: "session-a", workerId: "worker-one" },
    snapshot: { ...a, approvals: [
      approval("pending", "thread-a", "pending"), approval("failed", "thread-a", "failed"),
      approval("delivered", "thread-a", "delivered"), approval("other", "thread-b", "pending"),
    ] },
    connected: true, loading: false,
  })
  expect(view.deliveryIssues.map((item) => [item.id, item.deliveryState])).toEqual([
    ["pending", "pending"], ["failed", "failed"],
  ])
  expect(view.approvals).toEqual([])
})

test("retry requires a decided unresolved approval and an exact-attempt capability", () => {
  const pending = {
    id: "approval-a", threadId: "thread-a", runId: "run-a", toolCallId: "tool-a", version: 2,
    state: "rejected", requestedAt: "2026-09-29T20:00:00Z", deliveryState: "pending",
  } as unknown as Coordination.Approval
  const action = () => {}
  expect(canOfferDecisionRetry(pending, () => true, action)).toBe(true)
  expect(canOfferDecisionRetry(pending, () => false, action)).toBe(false)
  expect(canOfferDecisionRetry(pending, () => true, undefined)).toBe(false)
  expect(canOfferDecisionRetry({ ...pending, deliveryState: "delivered" }, () => true, action)).toBe(false)
  expect(canOfferDecisionRetry({ ...pending, state: "pending" }, () => true, action)).toBe(false)
})
