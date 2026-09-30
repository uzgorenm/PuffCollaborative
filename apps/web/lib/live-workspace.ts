import { coordinationRequest, readConnection, CoordinationError, type ConnectionState, type CoordinationOptions } from "./coordination-client.ts"
import type { WorkspaceSession, WorkspaceState } from "./workspace.ts"

export type EvidenceRef = { threadId: string; eventId: string; seq: number }
export type SourceEvent = { id: string; projectId: string; threadId?: string; seq: number; kind: string; occurredAt: string; actorId?: string; runId?: string; instructionId?: string; payload: Record<string, unknown> }
export type Thread = { id: string; projectId: string; sessionId: string; workerId: string; title: string; createdBy: string; createdAt: string; activitySeq: number; ownerUserId?: string; ownerId?: string }
export type Instruction = { id: string; requestId: string; threadId: string; actorId: string; text: string; queueSeq: number; submittedAt: string; runId: string }
export type Run = { id: string; threadId: string; instructionId: string; state: string; attempt: number; runnerMessageId: string; createdAt: string; startedAt?: string; endedAt?: string; executionOwner?: { workerId: string; instanceId: string }; leaseUntil?: string }
export type ApprovalReview = { permissionRequestId: string; sessionId: string; toolCallId: string; sourceMessageId: string; scopeHash: string; toolName: string; inputJson?: string; permission: string; patterns: string[]; savePatterns: string[]; metadataJson?: string; summary: string; complete: boolean }
export type Approval = { id: string; threadId: string; runId: string; toolCallId: string; version: number; state: "pending" | "claimed" | "approved" | "rejected"; requestedAt: string; deliveryState: "none" | "pending" | "delivered" | "failed"; claimedBy?: string; claimExpiresAt?: string; decisionId?: string; decision?: "approve" | "reject"; decidedBy?: string; decidedAt?: string; review?: ApprovalReview }
export type WorkCard = { id: string; projectId: string; threadId: string; version: number; sourceActivitySeq: number; currentTask: string; progress: string; blockers: string[]; status: "queued" | "active" | "blocked" | "idle" | "done"; recentVerifiedOutcome: string | null; contributors: string[]; evidenceRefs: EvidenceRef[]; generatedAt: string; submittedBy: string; updatedAt: string; summaryJobId: string }
export type ThreadSnapshot = { thread: Thread; instructions: Instruction[]; runs: Run[]; approvals: Approval[]; workCard?: WorkCard | null; cursor: number; ownerUserId?: string; ownerId?: string }
export type Brief = { projectId: string; version: number; goal: string; successCriteria: string[]; roles: { userId: string; label: string }[]; tools: string[]; sharingDefault: "private"; suggestedAwarenessMode: "off" | "review-each-note" | "allow-validated-topic-notes"; updatedBy: string; updatedAt: string }
export type Focus = { projectId: string; userId: string; version: number; text: string | null; updatedAt: string }
export type LiveMessage = { role: "user" | "assistant"; text: string; eventId?: string; seq?: number; kind?: string; actorId?: string; runId?: string; occurredAt?: string; instructionId?: string }
export type LiveSession = Omit<WorkspaceSession, "messages"> & { messages: LiveMessage[]; threadId: string; sessionId: string; workerId: string; ownerId?: string; sharedBy: string; ownership: "owner" | "sharer"; freshness: "current" | "stale" | "missing"; execution: string; sourceEvents: SourceEvent[]; evidenceRefs: EvidenceRef[]; summaryVersion?: number; sourceActivitySeq?: number }
export type LiveWorkspace = { source: "live"; projectId: string; actorId: string; projects: { id: string; name: string }[]; workspace: Omit<WorkspaceState, "sessions"> & { sessions: LiveSession[] }; snapshots: Record<string, ThreadSnapshot>; brief?: Brief; focus: Focus[] }
type Requester = <T>(path: string, options?: CoordinationOptions) => Promise<T>

const runStates = ["queued", "reserved", "running", "waiting_approval", "cancelling", "recovery_required", "completed", "failed", "cancelled"]
function invalid(label: string): never { throw new CoordinationError(`Invalid live ${label}`, 502) }
function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)) }
function integer(value: unknown, minimum = 0): value is number { return Number.isSafeInteger(value) && Number(value) >= minimum }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(item => typeof item === "string") }
function fields(value: unknown, keys: string[]): value is Record<string, unknown> { return record(value) && keys.every(key => typeof value[key] === "string") }
function timestamp(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)) }
function identifier(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value) }
function optionalIds(value: Record<string, unknown>, keys: string[]) { return keys.every(key => value[key] === undefined || identifier(value[key])) }
function array(value: unknown, label: string): unknown[] { return Array.isArray(value) ? value : invalid(label) }
function unique<T>(values: T[], identity: (value: T) => string, label: string): T[] {
  if (new Set(values.map(identity)).size !== values.length) invalid(`${label} identities`)
  return values
}

function readThread(value: unknown): Thread {
  if (!fields(value, ["id", "projectId", "sessionId", "workerId", "title", "createdBy"]) || ![value.id, value.projectId, value.sessionId, value.workerId, value.createdBy].every(identifier) || !integer(value.activitySeq) || !timestamp(value.createdAt) || !optionalIds(value, ["ownerId", "ownerUserId"])) invalid("Thread")
  return value as Thread
}

function readCard(value: unknown, thread: Thread): WorkCard {
  if (!fields(value, ["id", "projectId", "threadId", "currentTask", "progress", "submittedBy", "summaryJobId"]) || !integer(value.version, 1) || !integer(value.sourceActivitySeq) || !["queued", "active", "blocked", "idle", "done"].includes(String(value.status)) || !strings(value.blockers) || !strings(value.contributors) || (value.recentVerifiedOutcome !== null && typeof value.recentVerifiedOutcome !== "string") || !timestamp(value.generatedAt) || !timestamp(value.updatedAt)) invalid("WorkCard")
  if (value.projectId !== thread.projectId || value.threadId !== thread.id || Number(value.sourceActivitySeq) > thread.activitySeq) invalid("WorkCard project or Thread mismatch")
  array(value.evidenceRefs, "WorkCard sources").forEach(ref => {
    if (!record(ref) || ref.threadId !== thread.id || !identifier(ref.eventId) || !integer(ref.seq, 1) || ref.seq > Number(value.sourceActivitySeq)) invalid("WorkCard source reference")
  })
  return value as WorkCard
}

function readSnapshot(value: unknown, expected: Thread): ThreadSnapshot {
  if (!record(value) || !integer(value.cursor)) invalid("Thread snapshot")
  const thread = readThread(value.thread)
  if (thread.projectId !== expected.projectId || thread.id !== expected.id || thread.workerId !== expected.workerId || thread.sessionId !== expected.sessionId || thread.activitySeq > Number(value.cursor)) invalid("Thread snapshot identity mismatch")
  const instructions = unique(array(value.instructions, "instructions").map(input => {
    if (!fields(input, ["id", "requestId", "threadId", "actorId", "text", "runId"]) || input.threadId !== thread.id || !integer(input.queueSeq, 1) || !timestamp(input.submittedAt)) invalid("instruction Thread mismatch")
    return input as Instruction
  }), input => input.id, "instruction")
  const runs = unique(array(value.runs, "Runs").map(input => {
    if (!fields(input, ["id", "threadId", "instructionId", "runnerMessageId"]) || input.threadId !== thread.id || !runStates.includes(String(input.state)) || !integer(input.attempt) || !timestamp(input.createdAt) || (input.startedAt !== undefined && !timestamp(input.startedAt)) || (input.endedAt !== undefined && !timestamp(input.endedAt))) invalid("Run Thread mismatch")
    if (input.executionOwner !== undefined && (!fields(input.executionOwner, ["workerId", "instanceId"]) || input.executionOwner.workerId !== thread.workerId)) invalid("Run worker mismatch")
    return input as Run
  }), input => input.id, "Run")
  const approvals = unique(array(value.approvals, "approvals").map(input => {
    if (!fields(input, ["id", "threadId", "runId", "toolCallId"]) || input.threadId !== thread.id || !runs.some(run => run.id === input.runId) || !integer(input.version, 1) || !["pending", "claimed", "approved", "rejected"].includes(String(input.state)) || !["none", "pending", "delivered", "failed"].includes(String(input.deliveryState)) || !timestamp(input.requestedAt)) invalid("tool approval")
    if (input.review !== undefined) {
      const review = input.review
      if (!fields(review, ["permissionRequestId", "sessionId", "toolCallId", "sourceMessageId", "scopeHash", "toolName", "permission", "summary"]) || review.sessionId !== thread.sessionId || review.toolCallId !== input.toolCallId || !/^[a-f0-9]{64}$/.test(String(review.scopeHash)) || typeof review.complete !== "boolean" || !strings(review.patterns) || !strings(review.savePatterns) || review.patterns.length > 32 || review.savePatterns.length > 32 || [...review.patterns, ...review.savePatterns, String(review.toolName), String(review.permission)].some(item => item.length > 512) || String(review.summary).length > 8_000 || (review.metadataJson !== undefined && (typeof review.metadataJson !== "string" || review.metadataJson.length > 8_000))) invalid("tool approval review identity or scope")
      if (review.inputJson !== undefined && (typeof review.inputJson !== "string" || review.inputJson.length > 8_000)) invalid("tool approval arguments")
      if (review.complete && (!review.toolName || !review.inputJson)) invalid("complete tool approval arguments")
    }
    return input as Approval
  }), input => input.id, "approval")
  if (!optionalIds(value, ["ownerId", "ownerUserId"])) invalid("Session owner identity")
  const workCard = value.workCard === undefined || value.workCard === null ? value.workCard : readCard(value.workCard, thread)
  return { ...value, thread, instructions, runs, approvals, workCard } as ThreadSnapshot
}

function readEvent(value: unknown, projectId: string): SourceEvent {
  const identities = ["threadId", "actorId", "runId", "instructionId"]
  if (!fields(value, ["id", "projectId", "kind"]) || !identifier(value.id) || value.projectId !== projectId || !integer(value.seq, 1) || !timestamp(value.occurredAt) || !identities.every(key => value[key] === null || value[key] === undefined || identifier(value[key])) || !record(value.payload)) invalid("source event project or identity")
  // SQLite project-scoped events serialize an absent Thread as null.
  return { ...value, ...Object.fromEntries(identities.map(key => [key, value[key] ?? undefined])) } as SourceEvent
}

function readReplay(value: unknown, projectId: string, after: number) {
  if (!record(value) || !integer(value.cursor) || typeof value.hasMore !== "boolean") invalid("event page")
  const events = array(value.events, "events").map(event => readEvent(event, projectId))
  events.forEach((event, index) => { if (event.seq <= (events[index - 1]?.seq ?? after)) invalid("event ordering") })
  if (value.cursor !== (events.at(-1)?.seq ?? after) || (value.hasMore && !events.length)) invalid("event cursor progress")
  return { events, cursor: value.cursor as number, hasMore: value.hasMore }
}

function readBrief(value: unknown, projectId: string): Brief | undefined {
  if (!record(value)) invalid("project brief response")
  if (value.brief === undefined || value.brief === null) return undefined
  const brief = value.brief
  if (!fields(brief, ["projectId", "goal", "updatedBy"]) || brief.projectId !== projectId || !integer(brief.version, 1) || !strings(brief.successCriteria) || !strings(brief.tools) || !timestamp(brief.updatedAt) || brief.sharingDefault !== "private" || !["off", "review-each-note", "allow-validated-topic-notes"].includes(String(brief.suggestedAwarenessMode))) invalid("project brief")
  array(brief.roles, "project roles").forEach(role => { if (!fields(role, ["userId", "label"])) invalid("project role") })
  return brief as Brief
}

function owner(snapshot: ThreadSnapshot, memberIds: Set<string>) {
  const owners = [snapshot.ownerId, snapshot.ownerUserId, snapshot.thread.ownerId, snapshot.thread.ownerUserId].filter((value): value is string => typeof value === "string")
  if (new Set(owners).size > 1 || owners.some(id => !memberIds.has(id))) invalid("Session owner binding")
  return owners[0]
}

function messages(snapshot: ThreadSnapshot, events: SourceEvent[]): LiveMessage[] {
  const projected = events.flatMap((event): LiveMessage[] => {
    const text = event.kind === "instruction.submitted" || event.kind === "run.output" ? event.payload.text : event.kind === "comment.created" ? event.payload.body : undefined
    if (typeof text !== "string" || !text) return []
    return [{ role: event.kind === "run.output" ? "assistant" : "user", text, eventId: event.id, seq: event.seq, kind: event.kind, actorId: event.actorId, runId: event.runId, occurredAt: event.occurredAt, instructionId: event.instructionId }]
  })
  const missing = snapshot.instructions.filter(instruction => !events.some(event => event.instructionId === instruction.id && event.kind === "instruction.submitted" || event.kind === "instruction.submitted" && event.payload.requestId === instruction.requestId)).map((instruction): LiveMessage => ({ role: "user", text: instruction.text, instructionId: instruction.id, actorId: instruction.actorId, runId: instruction.runId, occurredAt: instruction.submittedAt, kind: "instruction.submitted" }))
  return [...missing, ...projected].toSorted((left, right) => (left.occurredAt ?? "").localeCompare(right.occurredAt ?? "") || (left.seq ?? 0) - (right.seq ?? 0))
}

function displayName(id: string, actorId: string) {
  if (id === actorId) return "You"
  const name = id.replace(/^usr_/, "").replace(/[_-]/g, " ")
  return name.replace(/\b\p{L}/gu, letter => letter.toUpperCase())
}

function projectSession(snapshot: ThreadSnapshot, events: SourceEvent[], actorId: string, memberIds: Set<string>, colors: Map<string, WorkspaceSession["color"]>): LiveSession {
  const card = snapshot.workCard
  const ordered = snapshot.runs.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
  const run = ordered.find(item => ["reserved", "running", "waiting_approval", "cancelling", "recovery_required"].includes(item.state)) ?? ordered[0]
  const execution = run?.state ?? "unknown"
  const status = execution === "running" || execution === "cancelling" ? "running" : execution === "completed" || (!run && card?.status === "done") ? "complete" : "waiting"
  const recentActivity = events.filter(event => ["run.output", "run.tool", "run.workspace", "run.diff", "run.started", "run.completed", "run.failed"].includes(event.kind)).at(-1)?.seq ?? 0
  const freshness = !card ? "missing" : card.sourceActivitySeq !== snapshot.thread.activitySeq || recentActivity > snapshot.thread.activitySeq ? "stale" : "current"
  const ownerId = owner(snapshot, memberIds)
  const personId = ownerId ?? snapshot.thread.createdBy
  if (!memberIds.has(personId)) invalid("Session sharer membership")
  const name = displayName(personId, actorId)
  const timestamps = [snapshot.thread.createdAt, card?.updatedAt, ...snapshot.runs.map(item => item.endedAt ?? item.startedAt ?? item.createdAt), ...events.map(event => event.occurredAt)].filter((value): value is string => typeof value === "string").toSorted()
  return {
    id: snapshot.thread.id, title: snapshot.thread.title, owner: name, initials: name === "You" ? "Y" : name.split(/\s+/).slice(0, 2).map(part => part[0]).join(""), color: colors.get(personId) ?? "orange",
    status, summary: card ? `${freshness === "stale" ? "Stale summary: " : ""}${card.progress}` : "No current summary is available.", updatedAt: timestamps.at(-1) ?? snapshot.thread.createdAt,
    task: card?.currentTask || snapshot.instructions.at(-1)?.text || snapshot.thread.title, scope: "project", topic: "unspecified", messages: messages(snapshot, events),
    threadId: snapshot.thread.id, sessionId: snapshot.thread.sessionId, workerId: snapshot.thread.workerId, ownerId, sharedBy: snapshot.thread.createdBy, ownership: ownerId ? "owner" : "sharer", freshness, execution, sourceEvents: events, evidenceRefs: card?.evidenceRefs ?? [], summaryVersion: card?.version, sourceActivitySeq: card?.sourceActivitySeq,
  }
}

export function createLiveWorkspaceLoader(request: Requester = coordinationRequest, connection: (signal?: AbortSignal) => Promise<ConnectionState> = readConnection) {
  async function sameConnection(expected: ConnectionState, signal?: AbortSignal) {
    const current = await connection(signal)
    signal?.throwIfAborted()
    if (!current.connected || current.actorId !== expected.actorId || current.url !== expected.url || current.username !== expected.username) throw new CoordinationError("Connection changed while loading project data", 409)
  }
  return {
    async loadLiveWorkspace(projectId?: string, signal?: AbortSignal): Promise<LiveWorkspace> {
      signal?.throwIfAborted()
      const connected = await connection(signal)
      if (!connected.connected || !connected.actorId) throw new CoordinationError("Connect to the backend first", 401)
      const actorId = connected.actorId
      const projects = unique(array(await request("/projects", { signal }), "projects").map(value => {
        if (!fields(value, ["id", "name", "createdBy"]) || !identifier(value.id) || !timestamp(value.createdAt)) invalid("project")
        return { id: String(value.id), name: String(value.name) }
      }), value => value.id, "project")
      const selected = projectId ? projects.find(project => project.id === projectId) : projects[0]
      if (projectId && !selected) throw new CoordinationError("Project is not available to this member", 404)
      if (!selected) {
        await sameConnection(connected, signal)
        return { source: "live", projectId: "", actorId, projects, workspace: { project: { name: "Your workspace", goal: "No shared project selected", members: [{ name: "You", initials: "Y", color: "green", focus: "No stated focus." }] }, sessions: [] }, snapshots: {}, focus: [] }
      }
      const root = `/projects/${selected.id}`
      const [detail, briefResponse, focusResponse, threadsResponse] = await Promise.all([request(root, { signal }), request(`${root}/brief`, { signal }), request(`${root}/focus`, { signal }), request(`${root}/threads`, { signal })])
      if (!record(detail) || !fields(detail.project, ["id", "name", "createdBy"]) || detail.project.id !== selected.id) invalid("project detail mismatch")
      const members = unique(array(detail.members, "members").map(member => {
        if (!fields(member, ["projectId", "userId"]) || member.projectId !== selected.id || !identifier(member.userId) || !["owner", "member"].includes(String(member.role)) || !timestamp(member.joinedAt)) invalid("project membership")
        return { userId: String(member.userId) }
      }), member => member.userId, "member")
      const memberIds = new Set(members.map(member => member.userId))
      if (!memberIds.has(actorId)) invalid("viewer membership")
      const brief = readBrief(briefResponse, selected.id)
      const focus = unique(array(focusResponse, "focus").map(value => {
        if (!fields(value, ["projectId", "userId"]) || value.projectId !== selected.id || !memberIds.has(String(value.userId)) || !integer(value.version, 1) || (value.text !== null && typeof value.text !== "string") || !timestamp(value.updatedAt)) invalid("person focus project mismatch")
        return value as Focus
      }), value => value.userId, "focus")
      const threads = unique(array(threadsResponse, "Threads").map(value => {
        const thread = readThread(value)
        if (thread.projectId !== selected.id) invalid("Thread project mismatch")
        return thread
      }), thread => thread.id, "Thread")
      const loaded = await Promise.all(threads.map(async thread => readSnapshot(await request(`/threads/${thread.id}`, { signal }), thread)))
      const events: SourceEvent[] = []
      let after = 0
      for (let page = 0; page < 100; page++) {
        const replay = readReplay(await request(`${root}/events?after=${after}&limit=200`, { signal }), selected.id, after)
        events.push(...replay.events)
        after = replay.cursor
        if (!replay.hasMore) break
        if (page === 99) throw new CoordinationError("Project event history exceeds the supported page limit", 413)
      }
      unique(events, event => event.id, "source event")
      signal?.throwIfAborted()
      await sameConnection(connected, signal)
      const colors = new Map(members.map((member, index): [string, WorkspaceSession["color"]] => [member.userId, member.userId === actorId ? "green" : (["purple", "blue", "orange"] as const)[index % 3]]))
      const sessions = loaded.map(snapshot => projectSession(snapshot, events.filter(event => event.threadId === snapshot.thread.id), actorId, memberIds, colors))
      return {
        source: "live", projectId: selected.id, actorId, projects, brief, focus, snapshots: Object.fromEntries(loaded.map(snapshot => [snapshot.thread.id, snapshot])),
        workspace: { project: { name: String(detail.project.name), goal: brief?.goal ?? "Project brief has not been set.", members: members.map(member => ({ name: displayName(member.userId, actorId), initials: member.userId === actorId ? "Y" : displayName(member.userId, actorId).split(/\s+/).slice(0, 2).map(part => part[0]).join(""), color: colors.get(member.userId) ?? "orange", focus: focus.find(value => value.userId === member.userId)?.text?.trim() || "No stated focus." })) }, sessions },
      }
    },
    async readLiveSource(projectId: string, ref: EvidenceRef, signal?: AbortSignal): Promise<SourceEvent> {
      if (!identifier(projectId) || !identifier(ref.threadId) || !identifier(ref.eventId) || !integer(ref.seq, 1)) invalid("source reference")
      signal?.throwIfAborted()
      const page = readReplay(await request(`/projects/${projectId}/events?after=${ref.seq - 1}&limit=1`, { signal }), projectId, ref.seq - 1)
      const event = page.events[0]
      if (page.events.length !== 1 || !event || event.threadId !== ref.threadId || event.id !== ref.eventId || event.seq !== ref.seq) invalid("source identity mismatch")
      signal?.throwIfAborted()
      return event
    },
  }
}
const loader = createLiveWorkspaceLoader()
export const loadLiveWorkspace = loader.loadLiveWorkspace
export const readLiveSource = loader.readLiveSource
