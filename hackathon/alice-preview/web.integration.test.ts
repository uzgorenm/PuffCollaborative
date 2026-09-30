import { test, expect } from "bun:test"
import { resolve } from "node:path"
import { handleLive } from "../../apps/web/lib/connected"
import type { LiveFinding, LiveReceipt, LiveSource, LiveThread, LiveWorkspace } from "../../apps/web/lib/connected-types"

test("real backend connection cites exact source, preserves the task, and reconciles one reuse after correction", async () => {
  const previousPath = process.env.PUFF_BACKEND_MEMBER_PATH
  const previousUrl = process.env.PUFF_BACKEND_URL
  const root = resolve(import.meta.dir, "../..")
  const child = Bun.spawn([process.execPath, resolve(root, "hackathon/alice-preview/run.ts")], { cwd: root, env: { ...process.env, PUFF_PREVIEW_SERVER_PORT: "4480" }, stdout: "pipe", stderr: "pipe" })
  const reader = child.stdout.getReader()
  let output = ""
  let memberPath = ""
  try {
    while (!memberPath) {
      const next = await reader.read()
      if (next.done) throw new Error("Isolated backend did not become ready.")
      output += new TextDecoder().decode(next.value)
      memberPath = /Member file \(0600\): ([^\n]+)/.exec(output)?.[1] ?? ""
    }
    const config = await Bun.file(memberPath).json()
    process.env.PUFF_BACKEND_MEMBER_PATH = memberPath
    process.env.PUFF_BACKEND_URL = config.url
    const base = "http://127.0.0.1:3010"
    async function call(path: string, body?: unknown, origin = base) {
      return handleLive(new Request(`${base}/api/live/${path}`, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? {} : { "Content-Type": "application/json", Origin: origin }, body: body === undefined ? undefined : JSON.stringify(body) }), path.split("/")[0] === "threads" ? path.split("?")[0].split("/") : [path])
    }
    const workspaceResponse = await call("workspace")
    expect(workspaceResponse.status).toBe(200)
    const workspace: LiveWorkspace = await workspaceResponse.json()
    expect(workspace.threads.length).toBe(2)
    expect(workspace.viewer.id).toBe("usr_serdar")
    expect(workspace.threads.find(thread => thread.id === config.sourceThreadId)?.status).toBe("complete")
    expect(JSON.stringify(workspace)).not.toContain(config.password)
    expect(JSON.stringify(workspace)).not.toContain("credentialsPath")
    const target = config.targetThreadId
    const before: LiveThread = await (await call(`threads/${target}`)).json()
    expect((await call(`threads/${target}/messages`, { requestId: "origin-check", text: "EADDRINUSE" }, "https://outside.example")).status).toBe(403)
    expect((await call(`threads/${config.sourceThreadId}/messages`, { requestId: "owner-check", text: "Change Alice's task" })).status).toBe(403)
    expect(await (await call(`threads/${target}/findings?q=authentication%20failed`)).json()).toEqual([])
    const findings: LiveFinding[] = await (await call(`threads/${target}/findings?q=EADDRINUSE`)).json()
    expect(findings.length).toBe(1)
    expect(findings[0].ownerName).toBe("Alice")
    expect(Number.isSafeInteger(findings[0].targetActivitySeq)).toBe(true)
    expect(findings[0].solution).not.toContain("loopback port 0 ")
    const sourcePath = (finding: LiveFinding, eventId = finding.eventId) => `threads/${config.sourceThreadId}/source?eventId=${eventId}&seq=${finding.seq}&targetThreadId=${target}&targetActivitySeq=${finding.targetActivitySeq}&targetInstructionId=${finding.targetInstructionId}`
    expect((await call(sourcePath(findings[0], "wrong"))).status).toBe(409)
    const inspected: LiveSource = await (await call(sourcePath(findings[0]))).json()
    expect(inspected.event.id).toBe(findings[0].eventId)
    expect(inspected.event.seq).toBe(findings[0].seq)
    const payload = { ...inspected.finding, requestId: `reuse:${target}:${inspected.event.id}:${inspected.event.seq}` }
    expect((await call(`threads/${target}/reuse`, { ...payload, cardVersion: inspected.finding.cardVersion + 1 })).status).toBe(409)
    const credentials = await Bun.file(config.credentialsPath).json()
    async function backend(path: string, username: string, method = "GET", body?: unknown) {
      const principal = credentials.find((member: { username: string }) => member.username === username)
      const response = await fetch(`${config.url}/api/coordination/v1${path}`, { method, headers: { Authorization: `Basic ${Buffer.from(`${username}:${principal.password}`).toString("base64")}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
      expect(response.status).toBe(200)
      return response.json()
    }
    const initialTarget = await backend(`/threads/${target}`, "serdar")
    expect(inspected.finding.targetActivitySeq).toBe(initialTarget.thread.activitySeq)
    expect(inspected.finding.targetInstructionId).toBe(initialTarget.instructions.at(-1).id)
    await backend(`/threads/${target}/comments`, "serdar", "POST", { requestId: "target-change-before-admission", body: "The server task has new diagnostic context to review before using a fix." })
    expect((await call(sourcePath(inspected.finding))).status).toBe(409)
    expect((await call(`threads/${target}/reuse`, payload)).status).toBe(409)
    const refreshedFindings: LiveFinding[] = await (await call(`threads/${target}/findings?q=EADDRINUSE`)).json()
    const refreshed: LiveSource = await (await call(sourcePath(refreshedFindings[0]))).json()
    const currentTarget = await backend(`/threads/${target}`, "serdar")
    expect(refreshed.finding.targetActivitySeq).toBe(currentTarget.thread.activitySeq)
    expect(refreshed.finding.targetActivitySeq).toBeGreaterThan(inspected.finding.targetActivitySeq)
    const refreshedPayload = { ...refreshed.finding, requestId: payload.requestId }
    await backend(`/threads/${target}/instructions`, "serdar", "POST", { requestId: "new-unrelated-task", text: "Update the welcome copy; server startup is already resolved." })
    expect((await backend(`/threads/${target}`, "serdar")).thread.activitySeq).toBe(refreshed.finding.targetActivitySeq)
    expect((await call(`threads/${target}/reuse`, refreshedPayload)).status).toBe(409)
    const unrelatedFindings: LiveFinding[] = await (await call(`threads/${target}/findings?q=EADDRINUSE`)).json()
    const unrelated: LiveSource = await (await call(sourcePath(unrelatedFindings[0]))).json()
    expect((await call(`threads/${target}/reuse`, { ...unrelated.finding, requestId: payload.requestId })).status).toBe(409)
    await backend(`/threads/${target}/instructions`, "serdar", "POST", { requestId: "current-server-error", text: "EADDRINUSE still blocks the current server task. Review the current diagnostics before adapting a fix." })
    expect((await call(sourcePath(unrelated.finding))).status).toBe(409)
    expect((await call(`threads/${target}/reuse`, { ...unrelated.finding, requestId: payload.requestId })).status).toBe(409)
    const latestFindings: LiveFinding[] = await (await call(`threads/${target}/findings?q=EADDRINUSE`)).json()
    const latest: LiveSource = await (await call(sourcePath(latestFindings[0]))).json()
    const sourceSnapshot = await backend(`/threads/${config.sourceThreadId}`, "serdar")
    const { id, projectId, threadId, version, sourceActivitySeq, submittedBy, updatedAt, ...card } = sourceSnapshot.workCard
    await backend(`/threads/${config.sourceThreadId}/work-card`, "analysis", "PUT", { expectedVersion: version, sourceActivitySeq, card: { ...card, progress: "A newer reviewed summary of the same EADDRINUSE finding", summaryJobId: "corrected-summary" } })
    expect((await call(`threads/${target}/reuse`, { ...latest.finding, requestId: payload.requestId })).status).toBe(409)
    const current: LiveSource = await (await call(sourcePath(latest.finding))).json()
    const reviewed = { ...current.finding, requestId: payload.requestId }
    const beforeAdmission: LiveThread = await (await call(`threads/${target}`)).json()
    const firstResponse = await call(`threads/${target}/reuse`, reviewed)
    expect(firstResponse.status).toBe(200)
    const first: LiveReceipt = await firstResponse.json()
    const second: LiveReceipt = await (await call(`threads/${target}/reuse`, reviewed)).json()
    expect(first.executionId).toBe(second.executionId)
    expect(first.instructionId).toBe(second.instructionId)
    const after: LiveThread = await (await call(`threads/${target}`)).json()
    expect(after.thread.id).toBe(before.thread.id)
    expect(after.thread.originalTask).toBe(before.thread.originalTask)
    expect(after.instructions.length).toBe(beforeAdmission.instructions.length + 1)
    expect(after.instructions.filter(text => text.includes(`Source: ${config.sourceThreadId} / ${findings[0].eventId} / ${findings[0].seq}`)).length).toBe(1)
    await backend(`/threads/${config.sourceThreadId}/comments`, "alice", "POST", { requestId: "correction-after-admission", body: "Correction: check the specific server error before choosing a different port." })
    await backend(`/threads/${target}/comments`, "serdar", "POST", { requestId: "target-change-after-admission", body: "Further diagnostic context after the saved reuse." })
    await backend(`/threads/${target}/instructions`, "serdar", "POST", { requestId: "unrelated-task-after-admission", text: "Now update the welcome copy." })
    const retry: LiveReceipt = await (await call(`threads/${target}/reuse`, reviewed)).json()
    expect(retry.instructionId).toBe(first.instructionId)
    expect(retry.executionId).toBe(first.executionId)
    const changedTarget = await backend(`/threads/${target}`, "serdar")
    expect((await call(sourcePath({ ...current.finding, targetActivitySeq: changedTarget.thread.activitySeq, targetInstructionId: changedTarget.instructions.at(-1).id }))).status).toBe(409)
    expect(await (await call(`threads/${target}/findings?q=EADDRINUSE`)).json()).toEqual([])
  } finally {
    if (previousPath === undefined) delete process.env.PUFF_BACKEND_MEMBER_PATH; else process.env.PUFF_BACKEND_MEMBER_PATH = previousPath
    if (previousUrl === undefined) delete process.env.PUFF_BACKEND_URL; else process.env.PUFF_BACKEND_URL = previousUrl
    child.kill()
    await child.exited
  }
}, 60_000)
