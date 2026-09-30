import { expect, test } from "bun:test"
import { chmod, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { handleLive } from "../../apps/web/lib/connected"
import type { LiveReceipt, LiveSource, LiveWorkMatch } from "../../apps/web/lib/connected-types"

// Recorded API fixtures exercise adapter admission, not a simulated model run.
// Real native runtime/model execution is verified separately by the local scenario.
test("active work intercepts first admission, validates exact current evidence, and reconciles one contextual instruction", async () => {
  const originalFetch = globalThis.fetch
  const originalPath = process.env.PUFF_BACKEND_MEMBER_PATH
  const originalUrl = process.env.PUFF_BACKEND_URL
  const directory = await mkdtemp(join(tmpdir(), "puff-active-api-test-"))
  const backendOrigin = "http://127.0.0.1:4777"
  const browserOrigin = "http://127.0.0.1:3010"
  const projectId = "project-api-fixture"
  const task = "Build shared server status panel with startup diagnostics"
  const common = { projectId, sessionId: "session-fixture", workerId: "worker-fixture", createdAt: "2026-09-29T12:00:00Z" }
  const sourceInstruction = { id: "instruction-alice", requestId: "alice-request", threadId: "thread-alice", actorId: "usr_alice", text: task, submittedAt: "2026-09-29T12:01:00Z", runId: "run-alice" }
  const sourceRun = { id: "run-alice", threadId: "thread-alice", instructionId: sourceInstruction.id, state: "running", createdAt: sourceInstruction.submittedAt }
  const sourceEvent = { id: "event-alice-output", projectId, threadId: "thread-alice", seq: 12, kind: "run.output", runId: sourceRun.id, occurredAt: "2026-09-29T12:02:00Z", payload: { text: "Recorded fixture evidence: server status panel diagnostics are being investigated." } }
  const sourceCard = { id: "card-alice", projectId, threadId: "thread-alice", version: 1, sourceActivitySeq: 12, currentTask: task, progress: "Startup diagnostics investigation", blockers: [], status: "active", recentVerifiedOutcome: null, contributors: ["usr_alice"], evidenceRefs: [{ threadId: "thread-alice", eventId: sourceEvent.id, seq: 12 }], generatedAt: "2026-09-29T12:02:30Z", submittedBy: "analysis-fixture", updatedAt: "2026-09-29T12:02:30Z", summaryJobId: "fixture-summary" }
  const source = { thread: { ...common, id: "thread-alice", title: task, createdBy: "usr_alice", activitySeq: 12 }, instructions: [sourceInstruction], runs: [sourceRun], workCard: sourceCard, cursor: 12 }
  const target = { thread: { ...common, id: "thread-serdar", title: "Original target", createdBy: "usr_serdar", activitySeq: 20 }, instructions: [{ id: "instruction-original", requestId: "original", threadId: "thread-serdar", actorId: "usr_serdar", text: "Preserve my original server objective", submittedAt: "2026-09-29T12:00:00Z", runId: "run-original" }], runs: [{ id: "run-original", threadId: "thread-serdar", instructionId: "instruction-original", state: "failed", createdAt: "2026-09-29T12:00:00Z" }], cursor: 20 }
  const submitted: string[] = []
  const fetched: string[] = []
  const privateCard = { ...sourceCard, id: "private-card", threadId: "private-thread", projectId: "private-project" }
  const memberPath = join(directory, "member.json")
  try {
    await Bun.write(memberPath, JSON.stringify({ url: backendOrigin, username: "serdar", password: "local-test-only", userId: "usr_serdar", projectId, names: { usr_alice: "Alice", usr_serdar: "Serdar" } }))
    await chmod(memberPath, 0o600)
    process.env.PUFF_BACKEND_MEMBER_PATH = memberPath
    process.env.PUFF_BACKEND_URL = backendOrigin
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
      if (url.origin !== backendOrigin) throw new Error("Unexpected external request in API fixture test")
      const path = url.pathname.replace("/api/coordination/v1", "")
      fetched.push(path)
      if (path === `/projects/${projectId}`) return Response.json({ project: { id: projectId, name: "API fixture" }, members: [{ userId: "usr_alice", projectId }, { userId: "usr_serdar", projectId }] })
      if (path === `/projects/${projectId}/work-cards`) return Response.json([sourceCard, privateCard])
      if (path === `/projects/${projectId}/events`) return Response.json({ events: Number(url.searchParams.get("after")) === 11 ? [sourceEvent] : [] })
      if (path === "/threads/thread-alice") return Response.json(source)
      if (path === "/threads/thread-serdar") return Response.json(target)
      if (path === "/threads/thread-alice/events") return Response.json({ events: [sourceEvent], cursor: 12, hasMore: false })
      if (path === "/threads/thread-serdar/instructions" && init?.method === "POST") {
        const body = JSON.parse(String(init.body))
        submitted.push(body.text)
        const instruction = { id: `instruction-${submitted.length}`, requestId: body.requestId, threadId: target.thread.id, actorId: "usr_serdar", text: body.text, submittedAt: "2026-09-29T12:03:00Z", runId: `run-${submitted.length}` }
        const run = { id: instruction.runId, threadId: target.thread.id, instructionId: instruction.id, state: "queued", createdAt: instruction.submittedAt }
        target.instructions.push(instruction); target.runs.push(run)
        return Response.json({ instruction, run })
      }
      return Response.json({ error: "Fixture route not allowed" }, { status: 403 })
    }) as typeof fetch
    const call = (path: string, body?: unknown) => handleLive(new Request(`${browserOrigin}/api/live/${path}`, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? {} : { Origin: browserOrigin, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }), path.split("?")[0].split("/"))
    const lookup = async (q = task): Promise<LiveWorkMatch[]> => (await call(`threads/thread-serdar/active-work?q=${encodeURIComponent(q)}`)).json()
    const inspectPath = (match: LiveWorkMatch) => `threads/thread-alice/source?kind=active-work&q=${encodeURIComponent(task)}&eventId=${match.eventId}&seq=${match.seq}&targetThreadId=thread-serdar&targetActivitySeq=${match.targetActivitySeq}&targetInstructionId=${match.targetInstructionId}&sourceInstructionId=${match.sourceInstructionId}`
    expect(await lookup("Fix frontend billing")).toEqual([])
    expect(await lookup("Investigate unrelated authentication failure")).toEqual([])
    let matches = await lookup()
    expect(matches.length).toBe(1)
    expect(matches[0].ownerName).toBe("Alice")
    expect(matches[0].sourceRunId).toBe(sourceRun.id)
    expect(matches[0].solution).toBe(sourceEvent.payload.text)
    expect(fetched.some(path => path.includes("private-thread"))).toBe(false)
    const blocked = await call("threads/thread-serdar/messages", { requestId: "not-admitted", text: task })
    expect(blocked.status).toBe(409)
    expect((await blocked.json()).code).toBe("overlap_review_required")
    expect(submitted.length).toBe(0)
    for (const state of ["queued", "reserved", "failed", "completed", "cancelled", "recovery_required"]) { sourceRun.state = state; expect(await lookup()).toEqual([]) }
    sourceRun.state = "waiting_approval"; sourceCard.status = "blocked"
    matches = await lookup()
    expect(matches[0].runState).toBe("waiting_approval")
    source.thread.activitySeq += 1
    expect(await lookup()).toEqual([])
    source.thread.activitySeq -= 1
    source.thread.projectId = "private-project"
    expect(await lookup()).toEqual([])
    source.thread.projectId = projectId
    const inspected: LiveSource = await (await call(inspectPath(matches[0]))).json()
    expect(inspected.event.id).toBe(sourceEvent.id)
    const context = inspected.finding as LiveWorkMatch
    target.thread.activitySeq += 1
    expect((await call("threads/thread-serdar/messages", { requestId: "stale-target", text: task, activeWorkContext: context })).status).toBe(409)
    target.thread.activitySeq -= 1
    sourceCard.version += 1
    expect((await call("threads/thread-serdar/messages", { requestId: "stale-source", text: task, activeWorkContext: context })).status).toBe(409)
    sourceCard.version -= 1
    expect(submitted.length).toBe(0)
    const continued = await call("threads/thread-serdar/messages", { requestId: "continue-once", text: task, allowOverlap: true })
    expect(continued.status).toBe(200)
    expect(submitted).toEqual([task])
    expect((await call("threads/thread-serdar/messages", { requestId: "continue-once", text: task, allowOverlap: true })).status).toBe(200)
    expect(submitted.length).toBe(1)
    matches = await lookup()
    const current: LiveSource = await (await call(inspectPath(matches[0]))).json()
    const body = { requestId: "context-once", text: task, activeWorkContext: current.finding }
    const admitted = await call("threads/thread-serdar/messages", body)
    expect(admitted.status).toBe(200)
    const receipt: LiveReceipt = await admitted.json()
    expect(submitted.length).toBe(2)
    expect(submitted[1].startsWith(task + "\n\n")).toBe(true)
    expect(submitted[1]).toContain(`Source: thread-alice / ${sourceEvent.id} / 12`)
    expect(submitted[1]).toContain(JSON.stringify(sourceEvent.payload.text))
    expect(submitted[1]).toContain("untrusted reported content")
    sourceRun.state = "completed"; source.thread.activitySeq += 1; target.thread.activitySeq += 1
    const retried: LiveReceipt = await (await call("threads/thread-serdar/messages", body)).json()
    expect(retried.instructionId).toBe(receipt.instructionId)
    expect(retried.executionId).toBe(receipt.executionId)
    expect(submitted.length).toBe(2)
    expect((await call("threads/thread-serdar/messages", { ...body, activeWorkContext: { ...body.activeWorkContext, solution: "Changed source text" } })).status).toBe(409)
    expect(submitted.length).toBe(2)
    expect(await lookup()).toEqual([])
  } finally {
    globalThis.fetch = originalFetch
    if (originalPath === undefined) delete process.env.PUFF_BACKEND_MEMBER_PATH; else process.env.PUFF_BACKEND_MEMBER_PATH = originalPath
    if (originalUrl === undefined) delete process.env.PUFF_BACKEND_URL; else process.env.PUFF_BACKEND_URL = originalUrl
    await rm(directory, { recursive: true, force: true })
  }
})
