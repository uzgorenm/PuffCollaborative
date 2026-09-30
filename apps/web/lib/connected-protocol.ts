export type ThreadRecord = { id: string; projectId: string; sessionId: string; workerId: string; title: string; createdBy: string; createdAt: string; activitySeq: number }
export type SourceEvent = { id: string; projectId: string; threadId?: string; seq: number; kind: string; occurredAt: string; actorId?: string; runId?: string; instructionId?: string; payload: Record<string, unknown> }
export type WorkCardRecord = { id: string; projectId: string; threadId: string; version: number; sourceActivitySeq: number; currentTask: string; progress: string; blockers: string[]; status: string; recentVerifiedOutcome: string | null; contributors: string[]; evidenceRefs: { threadId: string; eventId: string; seq: number }[]; generatedAt: string; submittedBy: string; updatedAt: string; summaryJobId: string }

export function workspaceOrigin(request: Request) {
  const url = new URL(request.url)
  return request.headers.get("sec-fetch-site") !== "cross-site"
    && request.headers.get("origin") === `${url.protocol}//${request.headers.get("host") || url.host}`
}

export function matchingError(query: string, source: string) {
  if (!/\bEADDRINUSE\b/i.test(query) || !/\bEADDRINUSE\b/i.test(source)) return false
  const requestedPort = query.match(/(?:port\s*[:=]?\s*|:)(\d{2,5})\b/i)?.[1]
  return !requestedPort || new RegExp(`(?:port\\s*[:=]?\\s*|:)${requestedPort}\\b`, "i").test(source)
}
export function validFindingSource(projectId: string, thread: ThreadRecord, card: WorkCardRecord, event: SourceEvent) {
  return thread.projectId === projectId && card.projectId === projectId && event.projectId === projectId
    && card.threadId === thread.id && event.threadId === thread.id
    && card.status === "done" && Boolean(card.recentVerifiedOutcome?.trim())
    && card.sourceActivitySeq === thread.activitySeq
    && Number.isSafeInteger(event.seq) && event.seq > 0 && event.seq <= card.sourceActivitySeq
    && ["comment.created", "run.output"].includes(event.kind)
    && card.evidenceRefs.some(ref => ref.threadId === thread.id && ref.eventId === event.id && ref.seq === event.seq)
    && typeof (event.kind === "comment.created" ? event.payload.body : event.payload.text) === "string"
    && Boolean(String(event.kind === "comment.created" ? event.payload.body : event.payload.text).trim())
}

const workStopWords = new Set("a an and are as at be been build can check could do doing fix for from help i implement in investigate is it me my of on our please project task that the this to with work working you your app application feature code".split(" "))
const broadWorkWords = new Set(["frontend", "backend", "api", "server", "service", "component", "interface", "system"])
function workWords(text: string) {
  return new Set((text.toLowerCase().match(/[a-z0-9][a-z0-9_.:/-]*/g) || [])
    .map(word => word.length > 5 && word.endsWith("s") ? word.slice(0, -1) : word)
    .filter(word => word.length > 2 && !workStopWords.has(word)))
}
export function matchingActiveWork(query: string, currentTask: string) {
  const requestedPorts = [...query.matchAll(/(?:\bport\s*[:=]?\s*|:)(\d{2,5})\b/gi)].map(match => match[1])
  if (requestedPorts.some(port => !new RegExp(`(?:\\bport\\s*[:=]?\\s*|:)${port}\\b`, "i").test(currentTask))) return false
  const ids = (text: string) => [...text.matchAll(/\b(?:task|ticket|issue|pr|wf)[-_:# ]*[a-z]*\d+\b/gi)].map(match => match[0].toLowerCase().replace(/[-_:# ]/g, ""))
  const requestedIds = ids(query), sourceIds = new Set(ids(currentTask))
  if (requestedIds.some(id => !sourceIds.has(id))) return false
  if (/\bEADDRINUSE\b/i.test(query)) return matchingError(query, currentTask)
  const requested = workWords(query), current = workWords(currentTask)
  const shared = [...requested].filter(word => current.has(word))
  return shared.length >= 2 && shared.some(word => !broadWorkWords.has(word))
}
export function validActiveWorkRun(thread: ThreadRecord, card: WorkCardRecord, event: SourceEvent, instruction: { id: string; actorId: string; submittedAt: string; text: string } | undefined, run: { id: string; threadId: string; instructionId: string; state: string } | undefined) {
  if (!instruction || !run || !["running", "waiting_approval"].includes(run.state) || run.threadId !== thread.id || run.instructionId !== instruction.id || instruction.actorId !== thread.createdBy || !matchingActiveWork(instruction.text, card.currentTask) || card.updatedAt < instruction.submittedAt) return false
  if (event.kind === "run.output") return event.runId === run.id
  if (event.actorId !== thread.createdBy || event.occurredAt < instruction.submittedAt) return false
  return event.kind !== "instruction.submitted" || event.instructionId === instruction.id
}
export function validActiveWorkSource(projectId: string, thread: ThreadRecord, card: WorkCardRecord, event: SourceEvent) {
  return thread.projectId === projectId && card.projectId === projectId && event.projectId === projectId
    && card.threadId === thread.id && event.threadId === thread.id
    && ["active", "blocked"].includes(card.status) && Boolean(card.currentTask.trim())
    && card.sourceActivitySeq === thread.activitySeq
    && Number.isSafeInteger(event.seq) && event.seq > 0 && event.seq <= card.sourceActivitySeq
    && ["comment.created", "run.output", "instruction.submitted"].includes(event.kind)
    && card.evidenceRefs.some(ref => ref.threadId === thread.id && ref.eventId === event.id && ref.seq === event.seq)
    && typeof (event.kind === "comment.created" ? event.payload.body : event.payload.text) === "string"
    && Boolean(String(event.kind === "comment.created" ? event.payload.body : event.payload.text).trim())
}
