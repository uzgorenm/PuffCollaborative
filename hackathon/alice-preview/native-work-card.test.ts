import { expect, test } from "bun:test"
import { nativeWorkCard } from "./native-work-card"

const snapshot = {
  thread: { id: "thr_alice", activitySeq: 12, createdBy: "usr_alice" },
  instructions: [
    { id: "ins_actual", text: "Inspect server.ts and improve EADDRINUSE diagnostics.", runId: "run_actual" },
  ],
  runs: [{ id: "run_actual", state: "waiting_approval" }],
  workCard: { version: 2, sourceActivitySeq: 7, summaryJobId: "older" },
}
const events = [
  {
    id: "evt_instruction",
    threadId: "thr_alice",
    seq: 8,
    kind: "instruction.submitted",
    instructionId: "ins_actual",
    runId: "run_actual",
    payload: {},
  },
  {
    id: "evt_output",
    threadId: "thr_alice",
    seq: 11,
    kind: "run.output",
    runId: "run_actual",
    payload: { text: "I read server.ts. I will explain the port collision without terminating other processes." },
  },
  {
    id: "evt_approval",
    threadId: "thr_alice",
    seq: 12,
    kind: "run.approval.requested",
    runId: "run_actual",
    payload: {},
  },
]

test("paused native work has exact current evidence and no completed outcome", () => {
  const card = nativeWorkCard(snapshot, events)!
  expect(card.card.status).toBe("blocked")
  expect(card.card.recentVerifiedOutcome).toBeNull()
  expect(card.card.progress).toBe(events[1].payload.text!)
  expect(card.card.evidenceRefs.map((ref) => ref.eventId)).toEqual(["evt_instruction", "evt_output", "evt_approval"])
  expect(card.expectedVersion).toBe(2)
  expect(card.sourceActivitySeq).toBe(12)
})

test("foreign and later outputs never become current evidence", () => {
  const card = nativeWorkCard(snapshot, [
    events[0],
    { ...events[1], threadId: "thr_private", payload: { text: "private" } },
    { ...events[1], seq: 13, payload: { text: "future" } },
    { ...events[1], runId: "run_previous", payload: { text: "previous" } },
  ])!
  expect(card.card.progress).toContain("No assistant output")
  expect(card.card.evidenceRefs).toHaveLength(1)
  expect(card.card.recentVerifiedOutcome).toBeNull()
})

test("a fresh projection is not rewritten until actual native activity changes", () => {
  const card = nativeWorkCard(snapshot, events)!
  expect(
    nativeWorkCard(
      { ...snapshot, workCard: { version: 3, sourceActivitySeq: 12, summaryJobId: card.card.summaryJobId } },
      events,
    ),
  ).toBeUndefined()
  expect(nativeWorkCard({ ...snapshot, runs: [{ id: "run_actual", state: "completed" }] }, events)!.card.status).toBe(
    "done",
  )
})

test("preparation failure uses the exact owner task without fabricating a native output", () => {
  const failed = {
    ...snapshot,
    thread: { ...snapshot.thread, activitySeq: 4 },
    runs: [{ id: "run_actual", state: "recovery_required" }],
  }
  const card = nativeWorkCard(failed, [
    {
      id: "evt_owner_task",
      threadId: "thr_alice",
      seq: 4,
      kind: "comment.created",
      actorId: "usr_alice",
      payload: { body: snapshot.instructions[0].text },
    },
    ...events,
  ])!
  expect(card.card.status).toBe("blocked")
  expect(card.card.evidenceRefs).toEqual([{ threadId: "thr_alice", eventId: "evt_owner_task", seq: 4 }])
  expect(card.card.progress).toContain("No assistant output")
  expect(card.card.recentVerifiedOutcome).toBeNull()
})
