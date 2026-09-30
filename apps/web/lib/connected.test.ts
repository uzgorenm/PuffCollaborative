import { test } from "node:test"
import assert from "node:assert/strict"
import { matchingError, validFindingSource, workspaceOrigin } from "./connected-protocol.ts"

const thread = { id: "thread-a", projectId: "project-1", sessionId: "ses-a", workerId: "worker-a", title: "Investigate server startup", createdBy: "usr_alice", createdAt: "2026-09-29T12:00:00Z", activitySeq: 12 }
const event = { id: "event-a", projectId: "project-1", threadId: "thread-a", seq: 12, kind: "comment.created", occurredAt: "2026-09-29T12:01:00Z", actorId: "usr_alice", payload: { commentId: "comment-a", body: "EADDRINUSE: port 3000 is occupied. Use port 3005 after checking the owning process." } }
const card = { id: "card-a", projectId: "project-1", threadId: "thread-a", version: 1, sourceActivitySeq: 12, currentTask: "Investigate server startup", progress: "Recorded port conflict resolution", blockers: [], status: "done", recentVerifiedOutcome: "Server responds on 3005", contributors: ["usr_alice"], evidenceRefs: [{ threadId: "thread-a", eventId: "event-a", seq: 12 }], generatedAt: "2026-09-29T12:02:00Z", submittedBy: "analysis", updatedAt: "2026-09-29T12:02:00Z", summaryJobId: "job-a" }

test("origin guard accepts the browser Host when Next normalizes its internal URL and rejects foreign origins", () => {
  assert.equal(workspaceOrigin(new Request("http://localhost:3010/api/live", { headers: { Host: "127.0.0.1:3010", Origin: "http://127.0.0.1:3010", "Sec-Fetch-Site": "same-origin" } })), true)
  assert.equal(workspaceOrigin(new Request("http://localhost:3010/api/live", { headers: { Host: "127.0.0.1:3010", Origin: "https://foreign.example", "Sec-Fetch-Site": "cross-site" } })), false)
  assert.equal(workspaceOrigin(new Request("http://localhost:3010/api/live", { headers: { Host: "127.0.0.1:3010", Origin: "http://127.0.0.1:3011" } })), false)
  assert.equal(workspaceOrigin(new Request("http://localhost:3010/api/live")), false)
})

test("matching server conflict recognizes the source error without matching unrelated failures", () => {
  assert.equal(matchingError("EADDRINUSE on port 3000", String(event.payload.body)), true)
  assert.equal(matchingError("EADDRINUSE on port 8080", String(event.payload.body)), false)
  assert.equal(matchingError("My server authentication failed on port 3000", String(event.payload.body)), false)
  assert.equal(matchingError("EADDRINUSE", "Connection refused on port 3000"), false)
})
test("only fresh done cards citing the exact same-project content event are reusable", () => {
  assert.equal(validFindingSource("project-1", thread, card, event), true)
  assert.equal(validFindingSource("project-1", { ...thread, activitySeq: 13 }, card, event), false)
  assert.equal(validFindingSource("project-1", thread, { ...card, status: "active" }, event), false)
  assert.equal(validFindingSource("project-1", thread, card, { ...event, projectId: "private-project" }), false)
  assert.equal(validFindingSource("project-1", thread, card, { ...event, id: "different-event" }), false)
  assert.equal(validFindingSource("project-1", thread, card, { ...event, seq: 11 }), false)
  assert.equal(validFindingSource("project-1", thread, card, { ...event, kind: "work-card.updated" }), false)
  assert.equal(validFindingSource("project-1", thread, { ...card, recentVerifiedOutcome: " " }, event), false)
  assert.equal(validFindingSource("project-1", thread, card, { ...event, payload: { body: " " } }), false)
  assert.equal(validFindingSource("project-1", thread, { ...card, evidenceRefs: [{ threadId: thread.id, eventId: event.id, seq: 13 }] }, { ...event, seq: 13 }), false)
})
