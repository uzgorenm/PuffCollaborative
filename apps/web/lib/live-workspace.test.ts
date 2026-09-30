import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { createCoordinationClient } from "./coordination-client.ts"
import { createLiveWorkspaceLoader } from "./live-workspace.ts"

const time = "2026-09-29T20:00:00.000Z"
const project = { id: "project-a", name: "Navigation", createdBy: "usr_alice", createdAt: time }
const thread = (id: string, user: string) => ({ id, projectId: project.id, sessionId: `session-${id}`, workerId: "worker-a", title: `Task ${id}`, createdBy: user, createdAt: time, activitySeq: 20 })
const threads = [thread("thread-a", "usr_alice"), thread("thread-b", "usr_bob")]
const instruction = { id: "instruction-a", requestId: "stable-a", threadId: "thread-a", actorId: "usr_alice", text: "Check navigation", queueSeq: 1, submittedAt: time, runId: "run-a" }
const card = { id: "card-a", projectId: project.id, threadId: "thread-a", version: 1, sourceActivitySeq: 20, currentTask: "Check navigation", progress: "Regression check completed", blockers: [], status: "done", recentVerifiedOutcome: "Focus returns to switcher", contributors: ["usr_alice"], evidenceRefs: [{ threadId: "thread-a", eventId: "event-20", seq: 20 }], generatedAt: time, submittedBy: "analysis-a", updatedAt: time, summaryJobId: "job-a" }
const brief = { projectId: project.id, version: 1, goal: "Build navigation safely", successCriteria: ["Keyboard works"], roles: [{ userId: "usr_alice", label: "Owner" }], tools: ["OpenCode"], sharingDefault: "private", suggestedAwarenessMode: "review-each-note", updatedBy: "usr_alice", updatedAt: time }
const focus = [{ projectId: project.id, userId: "usr_bob", version: 1, text: "Investigating persistent labels", updatedAt: time }]
const event10 = { id: "event-10", projectId: project.id, threadId: "thread-a", seq: 10, kind: "instruction.submitted", occurredAt: time, actorId: "usr_alice", instructionId: "instruction-a", payload: { requestId: "stable-a", text: "Check navigation" } }
const event20 = { id: "event-20", projectId: project.id, threadId: "thread-a", seq: 20, kind: "run.output", occurredAt: time, runId: "run-a", payload: { text: "Keyboard check passed for the switcher." } }

async function service(change?: (path: string, value: unknown) => unknown) {
  const paths: string[] = []
  const server = createServer((req, res) => {
    const path = (req.url ?? "").replace("/api/coordination", "")
    paths.push(path)
    let value: unknown
    if (path === "/api/connection") value = { connected: true, url: "http://127.0.0.1:4096", username: "alice", actorId: "usr_alice" }
    if (path === "/projects") value = [project]
    if (path === "/projects/project-a") value = { project, members: ["usr_alice", "usr_bob"].map(userId => ({ projectId: project.id, userId, role: userId === "usr_alice" ? "owner" : "member", joinedAt: time })) }
    if (path === "/projects/project-a/brief") value = { brief }
    if (path === "/projects/project-a/focus") value = focus
    if (path === "/projects/project-a/threads") value = threads
    if (path.startsWith("/threads/")) {
      const current = threads.find(item => path === `/threads/${item.id}`)
      if (current) value = { thread: current, ...(current.id === "thread-a" ? { ownerId: "usr_alice" } : {}), instructions: current.id === "thread-a" ? [instruction] : [], runs: [{ id: current.id === "thread-a" ? "run-a" : "run-b", threadId: current.id, instructionId: current.id === "thread-a" ? "instruction-a" : "instruction-b", state: current.id === "thread-a" ? "completed" : "running", attempt: 1, runnerMessageId: `message-${current.id}`, createdAt: time }], approvals: [], workCard: current.id === "thread-a" ? card : { ...card, id: "card-b", threadId: current.id, sourceActivitySeq: 19, evidenceRefs: [] }, cursor: 20 }
    }
    if (path.startsWith("/projects/project-a/events")) {
      const url = new URL(`http://fixture${path}`)
      const after = Number(url.searchParams.get("after"))
      value = after === 0 ? { events: [event10], cursor: 10, hasMore: true } : after === 10 ? { events: [event20], cursor: 20, hasMore: false } : after === 19 ? { events: [event20], cursor: 20, hasMore: false } : { events: [], cursor: after, hasMore: false }
    }
    const result = change ? change(path, value) : value
    if (result instanceof Response) { res.writeHead(result.status); void result.text().then(text => res.end(text)); return }
    if (result === undefined) { res.writeHead(404); res.end('{"message":"Missing fixture route"}'); return }
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(result))
  })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert(address && typeof address === "object")
  const api = createCoordinationClient((path, init) => fetch(`http://127.0.0.1:${address.port}${path}`, init))
  return { loader: createLiveWorkspaceLoader(api.coordinationRequest, api.readConnection), paths, close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }) }
}

test("live projection uses real done and running states, brief, focus, paginated actual output", async () => {
  const server = await service()
  try {
    const result = await server.loader.loadLiveWorkspace()
    assert.equal(result.source, "live")
    assert.equal(result.actorId, "usr_alice")
    assert.equal(result.workspace.project.goal, "Build navigation safely")
    const alice = result.workspace.sessions.find(item => item.id === "thread-a")!
    const bob = result.workspace.sessions.find(item => item.id === "thread-b")!
    assert.equal(alice.status, "complete")
    assert.equal(alice.owner, "You")
    assert.equal(alice.ownership, "owner")
    assert.equal(bob.ownership, "sharer")
    assert.equal(bob.ownerId, undefined)
    assert.equal(bob.status, "running")
    assert.equal(bob.freshness, "stale")
    assert.equal(result.workspace.project.members.find(member => member.name === "Bob")?.focus, "Investigating persistent labels")
    assert.deepEqual(alice.messages.map(message => message.text), ["Check navigation", "Keyboard check passed for the switcher."])
    assert.equal(alice.messages[1].eventId, "event-20")
    assert(server.paths.includes("/projects/project-a/events?after=10&limit=200"))
    assert.equal(alice.topic, "unspecified")
    assert.equal(alice.sourceActivitySeq, 20)
  } finally { await server.close() }
})

test("live projection rejects cross-project snapshots and mismatched source citations", async () => {
  for (const mutation of [
    (path: string, value: unknown) => path === "/threads/thread-a" ? { ...(value as object), thread: { ...threads[0], projectId: "private-project" } } : value,
    (path: string, value: unknown) => path === "/threads/thread-a" ? { ...(value as object), workCard: { ...card, threadId: "thread-b" } } : value,
    (path: string, value: unknown) => path === "/projects/project-a/focus" ? [{ ...focus[0], projectId: "private-project" }] : value,
    (path: string, value: unknown) => path === "/threads/thread-a" ? { ...(value as object), instructions: [{ ...instruction, threadId: "thread-b" }] } : value,
    (path: string, value: unknown) => path === "/projects/project-a/events?after=10&limit=200" ? { events: [{ ...event20, projectId: "private-project" }], cursor: 20, hasMore: false } : value,
  ]) {
    const server = await service(mutation)
    try { await assert.rejects(server.loader.loadLiveWorkspace(), /invalid|mismatch|project|source/i) } finally { await server.close() }
  }
})

test("exact source lookup validates project, thread, event and sequence together", async () => {
  const server = await service()
  try {
    const result = await server.loader.readLiveSource("project-a", { threadId: "thread-a", eventId: "event-20", seq: 20 })
    assert.equal(result.payload.text, "Keyboard check passed for the switcher.")
    await assert.rejects(server.loader.readLiveSource("project-a", { threadId: "thread-b", eventId: "event-20", seq: 20 }), /source|mismatch/i)
    await assert.rejects(server.loader.readLiveSource("project-a", { threadId: "thread-a", eventId: "invented", seq: 20 }), /source|mismatch/i)
  } finally { await server.close() }
})

test("live projection never fabricates an assistant reply or substitutes a failed live request", async () => {
  const empty = await service((path, value) => path.startsWith("/projects/project-a/events") ? { events: [], cursor: 0, hasMore: false } : path === "/threads/thread-a" ? { ...(value as object), workCard: null, runs: [] } : value)
  const failed = await service((path, value) => path === "/projects/project-a/threads" ? Response.json({ message: "Worker unavailable" }, { status: 503 }) : value)
  try {
    const result = await empty.loader.loadLiveWorkspace()
    const session = result.workspace.sessions.find(item => item.id === "thread-a")!
    assert.equal(session.freshness, "missing")
    assert.equal(session.execution, "unknown")
    assert.equal(session.messages.filter(message => message.role === "assistant").length, 0)
    await assert.rejects(failed.loader.loadLiveWorkspace(), /Worker unavailable/)
    await assert.rejects(empty.loader.loadLiveWorkspace("other-project"), /project/i)
    const controller = new AbortController(); controller.abort()
    await assert.rejects(empty.loader.loadLiveWorkspace(undefined, controller.signal), (error: unknown) => error instanceof Error && error.name === "AbortError")
  } finally { await empty.close(); await failed.close() }
})

test("a newly queued attempt zero overrides an older completed work card", async () => {
  const server = await service((path, value) => path === "/threads/thread-a" ? { ...(value as object), runs: [{ id: "run-next", threadId: "thread-a", instructionId: "instruction-next", state: "queued", attempt: 0, runnerMessageId: "message-next", createdAt: "2026-09-29T20:01:00.000Z" }] } : value)
  try {
    const session = (await server.loader.loadLiveWorkspace()).workspace.sessions.find(item => item.id === "thread-a")!
    assert.equal(session.execution, "queued")
    assert.equal(session.status, "waiting")
  } finally { await server.close() }
})

test("loader rejects a response when the authenticated connection changes during its reads", async () => {
  let connectionReads = 0
  const server = await service((path, value) => path === "/api/connection" && ++connectionReads > 1 ? { connected: true, url: "http://127.0.0.1:4096", username: "bob", actorId: "usr_bob" } : value)
  try { await assert.rejects(server.loader.loadLiveWorkspace(), /connection changed/i) } finally { await server.close() }
})

test("project membership events with nullable optional identities do not block live loading", async () => {
  const server = await service((path, value) => path === "/projects/project-a/events?after=0&limit=200" ? { events: [{ id: "membership-event", projectId: project.id, seq: 10, kind: "membership.changed", occurredAt: time, threadId: null, actorId: "usr_alice", runId: null, instructionId: null, payload: { userId: "usr_bob" } }], cursor: 10, hasMore: true } : value)
  try {
    const result = await server.loader.loadLiveWorkspace()
    assert.equal(result.projectId, "project-a")
    assert.equal(result.workspace.sessions.length, 2)
    assert.equal(result.workspace.sessions.find(session => session.id === "thread-a")?.messages.filter(message => message.role === "assistant")[0]?.text, "Keyboard check passed for the switcher.")
  } finally { await server.close() }
})

test("approval review preserves verified native scope and rejects mismatched Session details", async () => {
  const review = { permissionRequestId: "permission-a", sessionId: "session-thread-a", toolCallId: "call-a", sourceMessageId: "message-source-a", scopeHash: "a".repeat(64), toolName: "bash", inputJson: '{"command":"echo hello"}', permission: "bash", patterns: ["echo hello"], savePatterns: ["*"], metadataJson: '{"command":"echo hello"}', summary: "bash: echo hello", complete: true }
  const approval = { id: "approval-a", threadId: "thread-a", runId: "run-a", toolCallId: "call-a", version: 1, state: "pending", requestedAt: time, deliveryState: "none", review }
  const good = await service((path, value) => path === "/threads/thread-a" ? { ...(value as object), approvals: [approval] } : value)
  const bad = await service((path, value) => path === "/threads/thread-a" ? { ...(value as object), approvals: [{ ...approval, review: { ...review, sessionId: "other-session" } }] } : value)
  try {
    const result = await good.loader.loadLiveWorkspace()
    assert.deepEqual(result.snapshots["thread-a"].approvals[0].review, review)
    await assert.rejects(bad.loader.loadLiveWorkspace(), /approval review/i)
  } finally { await good.close(); await bad.close() }
})
