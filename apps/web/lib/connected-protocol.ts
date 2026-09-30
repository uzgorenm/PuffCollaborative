export type ThreadRecord = { id: string; projectId: string; sessionId: string; workerId: string; title: string; createdBy: string; createdAt: string; activitySeq: number }
export type SourceEvent = { id: string; projectId: string; threadId?: string; seq: number; kind: string; occurredAt: string; actorId?: string; runId?: string; instructionId?: string; payload: Record<string, unknown> }
export type WorkCardRecord = { id: string; projectId: string; threadId: string; version: number; sourceActivitySeq: number; currentTask: string; progress: string; blockers: string[]; status: string; recentVerifiedOutcome: string | null; contributors: string[]; evidenceRefs: { threadId: string; eventId: string; seq: number }[]; generatedAt: string; submittedBy: string; updatedAt: string; summaryJobId: string }

export function workspaceOrigin(request: Request, options: { allowMissingOrigin?: boolean; webOrigin?: string } = {}) {
  const url = URL.parse(request.url)
  const loopback = (value: URL | null) => value && ["http:", "https:"].includes(value.protocol)
    && ["127.0.0.1", "localhost", "[::1]"].includes(value.hostname) && !value.username && !value.password
  if (!loopback(url) || !url) return false
  const host = request.headers.get("host") ?? url.host
  if (!host || host.length > 256) return false
  const incoming = URL.parse(`${url.protocol}//${host}`)
  if (!loopback(incoming) || !incoming || incoming.host !== host || incoming.port !== url.port
    || incoming.pathname !== "/" || incoming.search || incoming.hash) return false
  if (options.webOrigin !== undefined && options.webOrigin.length > 2048) return false
  const expected = options.webOrigin === undefined ? incoming : URL.parse(options.webOrigin)
  if (!loopback(expected) || !expected || expected.pathname !== "/" || expected.search || expected.hash
    || expected.protocol !== url.protocol || expected.port !== url.port) return false
  const origin = request.headers.get("origin")
  return request.headers.get("sec-fetch-site") !== "cross-site"
    && (origin === null ? options.allowMissingOrigin === true : origin === expected.origin)
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
