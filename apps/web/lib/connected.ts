import { readFile } from "node:fs/promises"
import { matchingError, validFindingSource, workspaceOrigin } from "./connected-protocol"
import type { SourceEvent, ThreadRecord, WorkCardRecord } from "./connected-protocol"
import type { LiveEvent, LiveFinding, LiveReceipt, LiveSource, LiveThread, LiveThreadSummary, LiveWorkspace } from "./connected-types"

type Config = { url: string; username: string; password: string; userId: string; projectId: string; targetThreadId?: string; names?: Record<string, string>; runnerAvailability?: string }
type Instruction = { id: string; requestId: string; threadId: string; actorId: string; text: string; submittedAt: string; runId: string }
type Run = { id: string; threadId: string; instructionId: string; state: string; createdAt: string; endedAt?: string }
type Snapshot = { thread: ThreadRecord; instructions: Instruction[]; runs: Run[]; workCard?: WorkCardRecord | null; cursor: number }
type Project = { project: { id: string; name: string }; members: { userId: string; projectId: string }[] }
class LiveError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status } }

async function configuration(): Promise<Config> {
  const path = process.env.PUFF_BACKEND_MEMBER_PATH
  if (!path) throw new LiveError(503, "Connect the coordination backend to open your project.")
  const config: Config = JSON.parse(await readFile(path, "utf8"))
  config.url = process.env.PUFF_BACKEND_URL || config.url
  if (!config.username || config.username.includes(":") || !config.password || !config.userId || !config.projectId) throw new LiveError(503, "The backend connection needs a valid member identity.")
  const url = new URL(config.url)
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new LiveError(503, "The backend service address is invalid.")
  config.url = url.origin
  return config
}
function client(config: Config) {
  return async function request<T>(path: string, body?: unknown): Promise<T> {
    const result = await fetch(`${config.url}/api/coordination/v1${path}`, {
      method: body === undefined ? "GET" : "POST", cache: "no-store", redirect: "error",
      headers: { Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    }).catch(() => { throw new LiveError(503, "The coordination backend is unreachable. Your draft is preserved; retry when it reconnects.") })
    if (!result.ok) throw new LiveError(result.status, result.status === 409 ? "The backend rejected an outdated or conflicting request. Refresh and review the source again." : [401, 403].includes(result.status) ? "Your member identity cannot access this project or session." : "The backend could not complete this request.")
    return result.json() as Promise<T>
  }
}
type Requester = ReturnType<typeof client>
const encoded = encodeURIComponent
const name = (config: Config, id: string) => config.names?.[id] || id
async function project(config: Config, request: Requester) {
  const result = await request<Project>(`/projects/${encoded(config.projectId)}`)
  if (result.project.id !== config.projectId || !result.members.some(member => member.userId === config.userId && member.projectId === config.projectId)) throw new LiveError(403, "Your member identity is not part of this project.")
  return result
}
async function snapshot(config: Config, request: Requester, id: string, write = false) {
  const result = await request<Snapshot>(`/threads/${encoded(id)}`)
  if (result.thread.id !== id || result.thread.projectId !== config.projectId) throw new LiveError(403, "This session belongs to a different project.")
  if (write && result.thread.createdBy !== config.userId) throw new LiveError(403, "Only your own sessions can receive an instruction from this workspace.")
  return result
}
function summary(record: Snapshot): LiveThreadSummary {
  const runs = [...record.runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const latest = runs.at(-1)
  const original = [...record.instructions].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))[0]
  const freshCard = record.workCard?.sourceActivitySeq === record.thread.activitySeq ? record.workCard : undefined
  const status = latest ? ["running", "reserved"].includes(latest.state) ? "running" : latest.state === "completed" ? "complete" : ["failed", "recovery_required", "waiting_approval", "cancelling"].includes(latest.state) ? "blocked" : "waiting" : freshCard?.status === "done" ? "complete" : "unknown"
  return { id: record.thread.id, title: record.thread.title, ownerId: record.thread.createdBy, status, originalTask: original?.text || freshCard?.currentTask || record.thread.title, summary: freshCard?.progress || original?.text || "No current work summary recorded.", updatedAt: latest?.endedAt || freshCard?.updatedAt || record.thread.createdAt }
}
function eventView(config: Config, event: SourceEvent, thread: ThreadRecord): LiveEvent {
  const text = event.kind === "comment.created" ? event.payload.body : event.payload.text
  return { id: event.id, seq: event.seq, kind: event.kind, text: typeof text === "string" ? text : typeof event.payload.message === "string" ? event.payload.message : event.kind.replaceAll(".", " "), createdAt: event.occurredAt, author: event.actorId ? name(config, event.actorId) : event.kind === "run.output" ? "Agent" : name(config, thread.createdBy) }
}
async function replay(request: Requester, id: string) {
  const events: SourceEvent[] = []
  let after = 0
  for (let pageIndex = 0; pageIndex < 50; pageIndex++) {
    const page = await request<{ events: SourceEvent[]; cursor: number; hasMore: boolean }>(`/threads/${encoded(id)}/events?after=${after}&limit=200`)
    events.push(...page.events)
    if (!page.hasMore) return events
    if (page.cursor <= after) break
    after = page.cursor
  }
  throw new LiveError(503, "This session history is too large to load completely. No partial source was used.")
}
async function detail(config: Config, request: Requester, record: Snapshot): Promise<LiveThread> {
  const events = await replay(request, record.thread.id)
  if (events.some(event => event.projectId !== config.projectId || event.threadId !== record.thread.id)) throw new LiveError(502, "The backend returned a mismatched session history.")
  const views = events.map(event => eventView(config, event, record.thread))
  return {
    thread: summary(record), instructions: record.instructions.map(instruction => instruction.text), events: views,
    messages: views.filter(event => ["comment.created", "instruction.submitted", "run.output"].includes(event.kind)).map(event => ({ ...event, role: event.kind === "run.output" ? "assistant" : "user" })),
    executions: record.runs.map(run => ({ id: run.id, status: run.state, detail: events.filter(event => event.runId === run.id && event.kind === "run.failed").map(event => String(event.payload.message || event.payload.error || "The configured runner could not complete this turn.")).join(" ") || undefined })),
  }
}
// Coordination snapshots return instructions in their durable queue order.
const latestInstruction = (record: Snapshot) => record.instructions.at(-1)
function assertTargetReview(record: Snapshot, activitySeq: unknown, instructionId: unknown) {
  if (typeof activitySeq !== "number" || !Number.isSafeInteger(activitySeq) || activitySeq < 0 || record.thread.activitySeq !== activitySeq || typeof instructionId !== "string" || (latestInstruction(record)?.id || "") !== instructionId) throw new LiveError(409, "Your session changed after this finding was reviewed. Refresh and review it again before adding the fix.")
}
async function source(config: Config, request: Requester, memberProject: Project, id: string, eventId: string, seq: number, target: Snapshot): Promise<LiveSource> {
  if (!eventId || !Number.isSafeInteger(seq) || seq < 1) throw new LiveError(400, "A precise source event is required.")
  const record = await snapshot(config, request, id)
  const page = await request<{ events: SourceEvent[] }>(`/projects/${encoded(config.projectId)}/events?after=${seq - 1}&limit=1`)
  const event = page.events[0]
  const card = record.workCard
  if (page.events.length !== 1 || !event || event.id !== eventId || event.seq !== seq || !card || !validFindingSource(config.projectId, record.thread, card, event)) throw new LiveError(409, "This finding changed or its source is no longer current. Review the latest source.")
  const authorId = event.kind === "comment.created" ? event.actorId : record.thread.createdBy
  if (!authorId || !memberProject.members.some(member => member.userId === authorId) || !card.contributors.includes(authorId)) throw new LiveError(409, "The finding's author cannot be established from the current project.")
  const view = eventView(config, event, record.thread)
  const finding: LiveFinding = { sourceThreadId: id, eventId, seq, ownerName: name(config, authorId), threadTitle: record.thread.title, title: card.currentTask, problem: card.progress, solution: view.text, cardVersion: card.version, sourceActivitySeq: card.sourceActivitySeq, targetActivitySeq: target.thread.activitySeq, targetInstructionId: latestInstruction(target)?.id || "" }
  return { finding, thread: summary(record), event: view, messages: (await detail(config, request, record)).messages }
}
function receipt(instruction: Instruction, run: Run): LiveReceipt {
  if (run.instructionId !== instruction.id || run.threadId !== instruction.threadId || run.id !== instruction.runId) throw new LiveError(502, "The backend returned an inconsistent instruction receipt.")
  return { requestId: instruction.requestId, status: run.state, executionId: run.id, instructionId: instruction.id, detail: "Saved in this session. Execution progress is shown separately." }
}
function string(value: unknown) { return typeof value === "string" ? value : "" }
export async function handleLive(request: Request, path: string[]): Promise<Response> {
  try {
    if (request.method === "POST" && (!workspaceOrigin(request) || !request.headers.get("content-type")?.startsWith("application/json"))) throw new LiveError(403, "This action must originate from your Puff workspace.")
    const config = await configuration()
    const api = client(config)
    const memberProject = await project(config, api)
    if (request.method === "GET" && path.join("/") === "workspace") {
      const threads = await api<ThreadRecord[]>(`/projects/${encoded(config.projectId)}/threads`)
      const records = await Promise.all(threads.map(thread => snapshot(config, api, thread.id)))
      const workspace: LiveWorkspace = { project: { id: memberProject.project.id, name: memberProject.project.name }, viewer: { id: config.userId, name: name(config, config.userId) }, members: memberProject.members.map((member, index) => ({ id: member.userId, name: name(config, member.userId), initials: name(config, member.userId).slice(0, 1).toUpperCase(), color: (["green", "blue", "purple", "orange"] as const)[index % 4] })), threads: records.map(summary), defaultThreadId: config.targetThreadId, runnerAvailability: config.runnerAvailability }
      return Response.json(workspace, { headers: { "Cache-Control": "no-store" } })
    }
    if (path[0] !== "threads" || !path[1] || path.length > 3) throw new LiveError(404, "Unknown workspace action.")
    const id = path[1]
    const target = await snapshot(config, api, id, request.method === "POST")
    const query = new URL(request.url).searchParams
    if (request.method === "GET" && !path[2]) return Response.json(await detail(config, api, target))
    if (request.method === "GET" && path[2] === "source") {
      const targetId = query.get("targetThreadId") || ""
      if (!targetId || targetId === id || !query.has("targetActivitySeq")) throw new LiveError(400, "The finding must identify the session being reviewed.")
      const reviewedTarget = await snapshot(config, api, targetId)
      assertTargetReview(reviewedTarget, Number(query.get("targetActivitySeq")), query.get("targetInstructionId"))
      return Response.json(await source(config, api, memberProject, id, query.get("eventId") || "", Number(query.get("seq")), reviewedTarget))
    }
    if (request.method === "GET" && path[2] === "findings") {
      const question = query.get("q") || ""
      if (!/\bEADDRINUSE\b/i.test(question)) return Response.json([])
      const cards = await api<WorkCardRecord[]>(`/projects/${encoded(config.projectId)}/work-cards`)
      const candidates = cards.filter(card => card.threadId !== id && card.status === "done" && card.recentVerifiedOutcome && matchingError(question, `${card.currentTask} ${card.progress} ${card.recentVerifiedOutcome}`))
      const findings: LiveFinding[] = []
      for (const card of candidates) for (const ref of card.evidenceRefs) {
        if (ref.threadId !== card.threadId) continue
        const inspected = await source(config, api, memberProject, ref.threadId, ref.eventId, ref.seq, target).catch(error => { if (error instanceof LiveError && [403, 404, 409].includes(error.status)) return undefined; throw error })
        if (inspected && matchingError(question, inspected.finding.solution)) findings.push(inspected.finding)
      }
      return Response.json(findings)
    }
    if (request.method !== "POST") throw new LiveError(404, "Unknown workspace action.")
    const body: Record<string, unknown> = await request.json()
    const requestId = string(body.requestId)
    if (!requestId || requestId.length > 256) throw new LiveError(400, "A stable request identity is required.")
    if (path[2] === "messages") {
      const text = string(body.text)
      if (!text.trim() || text.length > 8000 || requestId.startsWith("reuse:")) throw new LiveError(400, "Enter a message of 1 to 8,000 characters.")
      const result = await api<{ instruction: Instruction; run: Run }>(`/threads/${encoded(id)}/instructions`, { requestId, text })
      if (result.instruction.threadId !== id || result.instruction.requestId !== requestId || result.instruction.text !== text || result.instruction.actorId !== config.userId) throw new LiveError(502, "The backend returned a mismatched instruction.")
      return Response.json(receipt(result.instruction, result.run))
    }
    if (path[2] !== "reuse") throw new LiveError(404, "Unknown workspace action.")
    const sourceId = string(body.sourceThreadId), eventId = string(body.eventId), seq = Number(body.seq)
    if (sourceId === id || requestId !== `reuse:${id}:${eventId}:${seq}`) throw new LiveError(400, "The finding must come from another session with its original request identity.")
    const previous = target.instructions.find(instruction => instruction.requestId === requestId && instruction.actorId === config.userId)
    if (previous) {
      const run = target.runs.find(run => run.id === previous.runId)
      if (!run || !previous.text.includes(`Source: ${sourceId} / ${eventId} / ${seq}`)) throw new LiveError(409, "This request identity already belongs to a different instruction.")
      return Response.json(receipt(previous, run))
    }
    assertTargetReview(target, body.targetActivitySeq, body.targetInstructionId)
    const inspected = await source(config, api, memberProject, sourceId, eventId, seq, target)
    if (inspected.finding.cardVersion !== Number(body.cardVersion) || inspected.finding.sourceActivitySeq !== Number(body.sourceActivitySeq)) throw new LiveError(409, "The source changed after you inspected it. Review it again before adding the fix.")
    const currentTarget = await snapshot(config, api, id, true)
    assertTargetReview(currentTarget, body.targetActivitySeq, body.targetInstructionId)
    const targetText = latestInstruction(currentTarget)?.text || ""
    if (!matchingError(targetText, inspected.finding.solution)) throw new LiveError(409, "This recorded fix does not match an error reported in your current session.")
    const text = `Review ${inspected.finding.ownerName}'s recorded finding and adapt it to this session if applicable. Preserve the original task: ${summary(target).originalTask}\n\nSource: ${sourceId} / ${eventId} / ${seq}\nSource work summary version: ${inspected.finding.cardVersion}; activity: ${inspected.finding.sourceActivitySeq}\n${inspected.finding.solution}\n\nCompare this with this session's actual error. Check the process that owns the port, preserve unrelated processes, then perform and report a concrete verification. A source report alone is not proof this target is fixed.`
    if (text.length > 8000) throw new LiveError(400, "This source is too long to add as one instruction. Keep the source and choose a smaller finding.")
    const result = await api<{ instruction: Instruction; run: Run }>(`/threads/${encoded(id)}/instructions`, { requestId, text })
    if (result.instruction.threadId !== id || result.instruction.requestId !== requestId || result.instruction.text !== text || result.instruction.actorId !== config.userId) throw new LiveError(502, "The backend returned a mismatched context instruction.")
    return Response.json(receipt(result.instruction, result.run))
  } catch (error) {
    return Response.json({ error: error instanceof LiveError ? error.message : "The backend connection could not be read. Check its local configuration." }, { status: error instanceof LiveError ? error.status : 503, headers: { "Cache-Control": "no-store" } })
  }
}
