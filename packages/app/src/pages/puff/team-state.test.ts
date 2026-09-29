import { expect, test } from "bun:test"
import { mergeTeamEvents, submissionAttempt, teamEventText } from "./team-state"
import type { Coordination } from "@opencode-ai/schema/coordination"

const event = (id: string, seq: number, threadId = "thread-a") => ({
  id,
  seq,
  projectId: "project" as Coordination.ProjectID,
  threadId: threadId as Coordination.ThreadID,
  kind: "run.output" as const,
  occurredAt: "2026-09-29T19:00:00Z",
  payload: { text: "Finding" },
})

test("replayed_events_are_ordered_deduplicated_and_never_cross_threads", () => {
  expect(
    mergeTeamEvents([event("b", 2)], [event("a", 1), event("b", 2), event("x", 3, "thread-b")], "thread-a").map(
      (x) => x.id,
    ),
  ).toEqual(["a", "b"])
})

test("an_ambiguous_send_can_only_retry_the_same_text_mode_and_target", () => {
  const original = submissionAttempt(
    undefined,
    { threadId: "a", kind: "instruction", text: "Check focus" },
    () => "stable",
  )
  expect(
    submissionAttempt(original, { threadId: "a", kind: "instruction", text: "Check focus" }, () => "different"),
  ).toBe(original)
  expect(() => submissionAttempt(original, { threadId: "b", kind: "instruction", text: "Check focus" })).toThrow()
  expect(() => submissionAttempt(original, { threadId: "a", kind: "comment", text: "Check focus" })).toThrow()
  expect(() => submissionAttempt(original, { threadId: "a", kind: "instruction", text: "Changed" })).toThrow()
})

test("only_documented_event_text_is_rendered_and_it_stays_plain_text", () => {
  expect(teamEventText(event("a", 1))).toBe("Finding")
  expect(teamEventText({ ...event("b", 2), payload: { text: { html: "unsafe" } } })).toBe("")
  expect(teamEventText({ ...event("c", 3), payload: { text: "<img onerror=alert(1)>" } })).toBe(
    "<img onerror=alert(1)>",
  )
})
