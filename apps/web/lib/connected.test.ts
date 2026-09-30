import { test } from "node:test"
import assert from "node:assert/strict"
import { matchingActiveWork, matchingError, validActiveWorkRun, validActiveWorkSource, validFindingSource, workspaceOrigin } from "./connected-protocol.ts"

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

test("active-work matching uses the current task and ignores generic or unrelated requests", () => {
  assert.equal(matchingActiveWork("Check server startup diagnostics", "Investigate server startup diagnostics"), true)
  assert.equal(matchingActiveWork("Please build the project navigation menu", "Implement project navigation menu"), true)
  assert.equal(matchingActiveWork("Fix EADDRINUSE on port 3000", "Investigate EADDRINUSE on port 3000"), true)
  assert.equal(matchingActiveWork("Fix EADDRINUSE on port 8080", "Investigate EADDRINUSE on port 3000"), false)
  assert.equal(matchingActiveWork("Help with this app", "Implement project navigation menu"), false)
  assert.equal(matchingActiveWork("Check server authentication", "Investigate server startup diagnostics"), false)
  assert.equal(matchingActiveWork("Fix frontend billing", "Fix frontend navigation"), false)
  assert.equal(matchingActiveWork("Implement backend API billing", "Implement backend API navigation"), false)
  assert.equal(matchingActiveWork("Investigate server startup on port 8080", "Investigate server startup on port 3000"), false)
  assert.equal(matchingActiveWork("Investigate server startup http://localhost:8080", "Investigate server startup http://localhost:3000"), false)
  assert.equal(matchingActiveWork("Build navigation menu for TASK-43", "Build navigation menu for TASK-42"), false)
  assert.equal(matchingActiveWork("Build navigation menu for TASK-42", "Build navigation menu for task 42"), true)
})

test("already-working evidence is bound to a current nonterminal run and owner instruction", () => {
  const active = { ...card, status: "active", recentVerifiedOutcome: null }
  const instruction = { id: "instruction-a", actorId: "usr_alice", submittedAt: "2026-09-29T12:00:30Z", text: "Investigate server startup" }
  const run = { id: "run-a", threadId: thread.id, instructionId: instruction.id, state: "running" }
  assert.equal(validActiveWorkRun(thread, active, event, instruction, run), true)
  assert.equal(validActiveWorkRun(thread, active, event, instruction, { ...run, state: "waiting_approval" }), true)
  for (const state of ["queued", "reserved", "completed", "failed", "cancelled", "recovery_required"]) assert.equal(validActiveWorkRun(thread, active, event, instruction, { ...run, state }), false)
  assert.equal(validActiveWorkRun(thread, active, event, instruction, { ...run, instructionId: "older-task" }), false)
  assert.equal(validActiveWorkRun(thread, active, event, { ...instruction, actorId: "usr_bob" }, run), false)
  assert.equal(validActiveWorkRun(thread, active, { ...event, actorId: "usr_bob" }, instruction, run), false)
  assert.equal(validActiveWorkRun(thread, active, { ...event, kind: "run.output", runId: "older-run", payload: { text: "Actual text" } }, instruction, run), false)
  assert.equal(validActiveWorkRun(thread, active, { ...event, kind: "run.output", runId: run.id, payload: { text: "Actual text" } }, instruction, run), true)
})

test("active awareness requires a fresh exact permitted source and no completed outcome", () => {
  const active = { ...card, status: "active", recentVerifiedOutcome: null }
  assert.equal(validActiveWorkSource("project-1", thread, active, event), true)
  assert.equal(validActiveWorkSource("project-1", thread, { ...active, status: "blocked" }, event), true)
  assert.equal(validActiveWorkSource("project-1", thread, card, event), false)
  assert.equal(validActiveWorkSource("project-1", { ...thread, activitySeq: 13 }, active, event), false)
  assert.equal(validActiveWorkSource("project-1", thread, active, { ...event, projectId: "private-project" }), false)
  assert.equal(validActiveWorkSource("project-1", thread, active, { ...event, id: "unlisted-event" }), false)
  assert.equal(validActiveWorkSource("project-1", thread, active, { ...event, kind: "work-card.updated" }), false)
  assert.equal(validActiveWorkSource("project-1", thread, active, { ...event, payload: { body: " " } }), false)
  assert.equal(validActiveWorkSource("project-1", thread, active, { ...event, kind: "instruction.submitted", payload: { text: "Check server startup diagnostics" } }), true)
})
