// Provisional UI contract matching the MVP spec; Serhat owns the shared schema.
export type ProjectTransport = (url: string, init: RequestInit) => Promise<Response>

export type EvidenceRef = { workerId: string; sessionId: string; eventId: string; revision: number }
export type Worker = {
  workerId: string
  projectId: string
  ownerId: string
  lastSeenAt: string
  state: "online" | "offline"
}
export type SharedSession = {
  workerId: string
  sessionId: string
  ownerId: string
  title: string
  featureTopic: string
  relationship: "alternative" | "unspecified"
  revision: number
  status: string
  awarenessMuted?: boolean
  serverKey?: string
}
export type SharedEvent = {
  eventId: string
  projectId: string
  workerId: string
  sessionId: string
  revision: number
  kind: "message" | "activity" | "status"
  occurredAt: string
  content: Record<string, unknown>
}
export type Summary = {
  summaryId: string
  projectId: string
  workerId: string
  sessionId: string
  revision: number
  task: string
  approach: string
  workState: "planned" | "ongoing" | "completed" | "unknown"
  progress: string
  blockers: string[]
  evidenceRefs: EvidenceRef[]
  generatedAt: string
  runId: string
}
export type Proposal = {
  proposalId: string
  projectId: string
  requestId: string
  kind: "overlap" | "alternative" | "dependency" | "reuse" | "context"
  targetWorkerId: string
  targetSessionId: string
  text: string
  rationale: string
  evidenceRefs: EvidenceRef[]
  version: number
  state: "proposed" | "approved" | "rejected" | "delivered" | "failed" | "stale"
}
export type AwarenessNote = {
  noteId: string
  projectId: string
  sourceWorkerId: string
  sourceSessionId: string
  sourceRevision: number
  targetWorkerId: string
  targetSessionId: string
  featureTopic: string
  text: string
  evidenceRefs: EvidenceRef[]
  state: "pending" | "delivered" | "failed" | "stale"
  runId?: string
}
export type DeliverySource = {
  sourceKind: "approvedProposal" | "awarenessNote"
  sourceId: string
  targetWorkerId: string
  targetSessionId: string
}
export type Delivery = DeliverySource & {
  deliveryId: string
  messageId: string | null
  state: "pending" | "claimed" | "delivered" | "failed"
  error: string | null
}
export type Decision = {
  decisionId: string
  projectId: string
  text: string
  evidenceRefs: EvidenceRef[]
  state: "accepted" | "superseded"
  supersedesId: string | null
  approvedBy: string
  approvedAt: string
}
export type ProjectSnapshot = {
  schemaVersion: 1
  projectId: string
  viewerId?: string
  projectName?: string
  workers: Worker[]
  sessions: SharedSession[]
  events: SharedEvent[]
  summaries: Summary[]
  proposals: Proposal[]
  awarenessNotes: AwarenessNote[]
  deliveries: Delivery[]
  decisions: Decision[]
}
export type ApprovalInput = {
  approvalId: string
  expectedVersion: number
  decision: "approve" | "reject"
  finalText: string
  decidedAt: string
}
export type ContextInput = {
  requestId: string
  projectId: string
  targetWorkerId: string
  targetSessionId: string
  question: string
  evidenceRefs: EvidenceRef[]
  createdAt: string
}
export type SharingInput = {
  projectId: string
  workerId: string
  shared: boolean
  featureTopic: string
  relationship: SharedSession["relationship"]
  awarenessMuted: boolean
}
export type DecisionInput = Pick<Decision, "decisionId" | "projectId" | "text" | "evidenceRefs" | "supersedesId">
export type ContextJob = {
  requestId: string
  status: "pending" | "completed" | "failed"
  runId?: string
  error?: string
  warnings?: string[]
}

export class ProjectApiError extends Error {
  constructor(
    public code: "connection" | "invalid" | "conflict" | "unauthorized" | "request" | "unavailable",
    public status = 0,
  ) {
    super(code)
  }
}

export function createProjectApi(config: { baseUrl: string; token: string; transport?: ProjectTransport }) {
  const root = serviceUrl(config.baseUrl)
  return projectApi(root, config)
}

export function serviceUrl(baseUrl: string) {
  if (!URL.canParse(baseUrl)) throw new ProjectApiError("connection")
  const base = new URL(baseUrl)
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (base.protocol !== "https:" &&
      !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)))
  )
    throw new ProjectApiError("connection")
  return base.href.replace(/\/$/, "")
}

function projectApi(root: string, config: { token: string; transport?: ProjectTransport }) {
  async function call(path: string, body?: unknown): Promise<unknown> {
    const response = await (config.transport ?? fetch)(`${root}/puff/v1${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {
      throw new ProjectApiError("connection")
    })
    if (!response.ok)
      throw new ProjectApiError(
        response.status === 409 ? "conflict" : [401, 403].includes(response.status) ? "unauthorized" : "request",
        response.status,
      )
    if (response.status === 204) return undefined
    return response.json().catch(() => {
      throw new ProjectApiError("invalid")
    })
  }
  return {
    async snapshot(projectId: string) {
      const snapshot = readSnapshot(await call(`/projects/${encodeURIComponent(projectId)}`))
      if (snapshot.projectId !== projectId) throw new ProjectApiError("invalid")
      return snapshot
    },
    approve: (proposalId: string, input: ApprovalInput) =>
      call(`/proposals/${encodeURIComponent(proposalId)}/approval`, { ...input, proposalId }),
    context: (input: ContextInput) => call("/context-requests", input),
    async request(requestId: string): Promise<ContextJob> {
      const job = object(await call(`/context-requests/${encodeURIComponent(requestId)}`))
      strings(job, ["requestId"])
      oneOf(job.status, ["pending", "completed", "failed"])
      if (job.requestId !== requestId) throw new ProjectApiError("invalid")
      optionalStrings(job, ["runId", "error"])
      if (
        job.warnings !== undefined &&
        (!Array.isArray(job.warnings) || !job.warnings.every((x) => typeof x === "string"))
      )
        throw new ProjectApiError("invalid")
      return job as ContextJob
    },
    sharing: (sessionId: string, input: SharingInput) =>
      call(`/sessions/${encodeURIComponent(sessionId)}/sharing`, input),
    acceptDecision: (input: DecisionInput) => call("/decisions", input),
  }
}

export function readSnapshot(value: unknown): ProjectSnapshot {
  const data = object(value)
  if (data.schemaVersion !== 1) throw new ProjectApiError("invalid")
  strings(data, ["projectId"])
  optionalStrings(data, ["viewerId", "projectName"])
  const arrays = [
    "workers",
    "sessions",
    "events",
    "summaries",
    "proposals",
    "awarenessNotes",
    "deliveries",
    "decisions",
  ] as const
  const records = Object.fromEntries(
    arrays.map((key) => {
      if (!Array.isArray(data[key])) throw new ProjectApiError("invalid")
      return [key, data[key].map(object)]
    }),
  ) as Record<(typeof arrays)[number], Record<string, unknown>[]>
  records.workers.forEach((x) => {
    strings(x, ["workerId", "projectId", "ownerId", "lastSeenAt"])
    oneOf(x.state, ["online", "offline"])
  })
  records.sessions.forEach((x) => {
    strings(x, ["workerId", "sessionId", "ownerId", "title", "featureTopic", "status"])
    integer(x.revision)
    oneOf(x.relationship, ["alternative", "unspecified"])
    optionalStrings(x, ["serverKey"])
    if (x.awarenessMuted !== undefined && typeof x.awarenessMuted !== "boolean") throw new ProjectApiError("invalid")
    if (!records.workers.some((w) => w.workerId === x.workerId && w.ownerId === x.ownerId))
      throw new ProjectApiError("invalid")
  })
  records.events.forEach((x) => {
    strings(x, ["eventId", "projectId", "workerId", "sessionId", "occurredAt"])
    integer(x.revision)
    oneOf(x.kind, ["message", "activity", "status"])
    object(x.content)
  })
  records.summaries.forEach((x) => {
    strings(x, [
      "summaryId",
      "projectId",
      "workerId",
      "sessionId",
      "task",
      "approach",
      "progress",
      "generatedAt",
      "runId",
    ])
    integer(x.revision)
    oneOf(x.workState, ["planned", "ongoing", "completed", "unknown"])
    if (!Array.isArray(x.blockers) || !x.blockers.every((v) => typeof v === "string"))
      throw new ProjectApiError("invalid")
    refs(x.evidenceRefs)
  })
  records.proposals.forEach((x) => {
    strings(x, ["proposalId", "projectId", "requestId", "targetWorkerId", "targetSessionId", "text", "rationale"])
    integer(x.version)
    refs(x.evidenceRefs)
    oneOf(x.kind, ["overlap", "alternative", "dependency", "reuse", "context"])
    oneOf(x.state, ["proposed", "approved", "rejected", "delivered", "failed", "stale"])
  })
  records.awarenessNotes.forEach((x) => {
    strings(x, [
      "noteId",
      "projectId",
      "sourceWorkerId",
      "sourceSessionId",
      "targetWorkerId",
      "targetSessionId",
      "featureTopic",
      "text",
    ])
    integer(x.sourceRevision)
    refs(x.evidenceRefs)
    optionalStrings(x, ["runId"])
    oneOf(x.state, ["pending", "delivered", "failed", "stale"])
  })
  records.deliveries.forEach((x) => {
    strings(x, ["deliveryId", "sourceId", "targetWorkerId", "targetSessionId"])
    oneOf(x.sourceKind, ["approvedProposal", "awarenessNote"])
    oneOf(x.state, ["pending", "claimed", "delivered", "failed"])
    nullableStrings(x, ["messageId", "error"])
  })
  records.decisions.forEach((x) => {
    strings(x, ["decisionId", "projectId", "text", "approvedBy", "approvedAt"])
    refs(x.evidenceRefs)
    oneOf(x.state, ["accepted", "superseded"])
    nullableStrings(x, ["supersedesId"])
  })
  Object.values(records)
    .flat()
    .forEach((x) => {
      if (x.projectId !== undefined && x.projectId !== data.projectId) throw new ProjectApiError("invalid")
    })
  ;[...records.events, ...records.summaries].forEach((x) => {
    if (!records.sessions.some((s) => s.workerId === x.workerId && s.sessionId === x.sessionId))
      throw new ProjectApiError("invalid")
  })
  ;[...records.proposals, ...records.awarenessNotes, ...records.deliveries].forEach((x) => {
    if (!records.sessions.some((s) => s.workerId === x.targetWorkerId && s.sessionId === x.targetSessionId))
      throw new ProjectApiError("invalid")
  })
  return data as ProjectSnapshot
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProjectApiError("invalid")
  return value as Record<string, unknown>
}
function strings(value: Record<string, unknown>, keys: string[]) {
  if (keys.some((key) => typeof value[key] !== "string")) throw new ProjectApiError("invalid")
}
function optionalStrings(value: Record<string, unknown>, keys: string[]) {
  if (keys.some((key) => value[key] !== undefined && typeof value[key] !== "string"))
    throw new ProjectApiError("invalid")
}
function nullableStrings(value: Record<string, unknown>, keys: string[]) {
  if (keys.some((key) => value[key] !== null && typeof value[key] !== "string")) throw new ProjectApiError("invalid")
}
function integer(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new ProjectApiError("invalid")
}
function oneOf(value: unknown, options: string[]) {
  if (typeof value !== "string" || !options.includes(value)) throw new ProjectApiError("invalid")
}
function refs(value: unknown) {
  if (!Array.isArray(value)) throw new ProjectApiError("invalid")
  value.forEach((ref) => {
    const x = object(ref)
    strings(x, ["workerId", "sessionId", "eventId"])
    integer(x.revision)
  })
}
