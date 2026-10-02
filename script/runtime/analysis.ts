import { createHash } from "node:crypto"
import { mkdir, readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { atomicPrivateJson } from "./private-json"

type Policy = {
  threadId: string
  ownerId?: string
  sourceActivitySeq: number
  version: number
  featureTopic: string
  relationship: string
  analysisEnabled: boolean
  awarenessMode: "off" | "notify"
}
type Thread = { id: string; projectId: string; activitySeq: number }
type Note = {
  noteId: string
  sourceThreadId: string
  sourceActivitySeq: number
  targetThreadId: string
  targetActivitySeq: number
  featureTopic?: string
  text: string
  evidenceRefs: { threadId: string; eventId: string; seq: number }[]
  candidateState?: "pending"
  deliveryState?: "not_attempted"
}
type Mapped = {
  state: "mapped"
  requestId: string
  coordinationRunId: string
  workCardUpdates: { threadId: string; expectedVersion: number; sourceActivitySeq: number; card: unknown }[]
  awarenessNoteCandidates: Note[]
  proposalCandidates: unknown[]
}
type Delivery = {
  noteId: string
  messageID: string
  admittedSeq?: number
  state?: "outcome_unknown" | "not_admitted"
  reason?: string
}
type Receipt = { messageID?: string; admittedSeq?: number }
type Job = {
  id: string
  export: Record<string, unknown>
  policies: Policy[]
  state: "reserved" | "analyzed" | "applied" | "stale" | "failed"
  result?: Mapped
  error?: string
  deliveries?: Delivery[]
}
type Api = (
  path: string,
  body?: unknown,
  credential?: "analysis" | string,
  method?: "GET" | "POST" | "PUT",
) => Promise<unknown>

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
const admitted = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const matchingReceipt = (
  receipt: Receipt | undefined,
  messageID: string,
): receipt is Receipt & { admittedSeq: number } => receipt?.messageID === messageID && admitted(receipt.admittedSeq)

async function save(file: string, job: Job) {
  await atomicPrivateJson(file, job)
}

// Receipt reads remain valid after activity or consent changes. Rotate through
// bounded historical journals without replaying any old analysis or admission.
async function reconcile(directory: string, policies: Policy[], api: Api) {
  const cursorFile = join(directory, "receipt-cursor.json")
  const cursor = (await readFile(cursorFile, "utf8")
    .then(JSON.parse)
    .catch((error) => {
      if (error.code !== "ENOENT") throw error
      return { after: "" }
    })) as { after: string }
  const files = (await readdir(directory)).filter((file) => /^[a-f0-9]{64}\.json$/.test(file)).sort()
  if (!files.length) return
  const start = files.findIndex((file) => file > cursor.after)
  const rotated = start < 0 ? files : [...files.slice(start), ...files.slice(0, start)]
  const batch = rotated.slice(0, 128)
  for (const name of batch) {
    const file = join(directory, name)
    const job = JSON.parse(await readFile(file, "utf8")) as Job
    if (job.id !== name.slice(0, -5) || !job.result || !Array.isArray(job.deliveries)) continue
    let changed = false
    for (const delivery of job.deliveries) {
      if (!["outcome_unknown", "not_admitted"].includes(delivery.state ?? "")) continue
      const note = job.result.awarenessNoteCandidates.find((note) => note.noteId === delivery.noteId)
      const captured = job.policies.find((policy) => policy.threadId === note?.targetThreadId)
      const current = policies.find((policy) => policy.threadId === captured?.threadId)
      // A retained owner identity is not authorization after membership changes.
      if (!note || !captured?.ownerId || current?.ownerId !== captured.ownerId) continue
      const messageID = `msg_${digest([job.id, note.noteId]).slice(0, 26)}`
      const receipt = (await api(
        `/threads/${encodeURIComponent(note.targetThreadId)}/analysis/awareness/${encodeURIComponent(job.result.coordinationRunId)}/${encodeURIComponent(note.noteId)}`,
        undefined,
        captured.ownerId,
      ).catch(() => undefined)) as { messageID?: string; admittedSeq?: number } | undefined
      if (!matchingReceipt(receipt, messageID)) continue
      Object.assign(delivery, receipt, { noteId: note.noteId, state: undefined, reason: undefined })
      changed = true
    }
    if (!changed) continue
    if (job.state === "analyzed" && job.deliveries.every((delivery) => admitted(delivery.admittedSeq)))
      job.state = "applied"
    await save(file, job)
  }
  await atomicPrivateJson(cursorFile, { after: batch.at(-1) })
}

/** One serialized background cycle; coding execution never awaits this work. */
export async function analysisCycle(options: {
  projectId: string
  stateDirectory: string
  api: Api
  analyze: (envelope: unknown) => Promise<Mapped>
}) {
  const directory = join(options.stateDirectory, "analysis-jobs")
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const threads = (await options.api(`/projects/${encodeURIComponent(options.projectId)}/threads`)) as Thread[]
  const policies = await Promise.all(
    threads.map((thread) => options.api(`/threads/${encodeURIComponent(thread.id)}/cooperation`) as Promise<Policy>),
  )
  await reconcile(directory, policies, options.api)
  const selected = policies.filter((policy) => policy.analysisEnabled && policy.featureTopic && policy.ownerId)
  for (const target of selected)
    for (const source of selected) {
      if (source.threadId === target.threadId || source.featureTopic !== target.featureTopic) continue
      const id = digest([
        options.projectId,
        source.threadId,
        target.threadId,
        source.sourceActivitySeq,
        target.sourceActivitySeq,
        source.version,
        target.version,
      ])
      const file = join(directory, `${id}.json`)
      let job = (await readFile(file, "utf8")
        .then(JSON.parse)
        .catch((error) => {
          if (error.code !== "ENOENT") throw error
          return undefined
        })) as Job | undefined
      if (job && ["applied", "stale", "failed"].includes(job.state)) continue
      if (!job) {
        const captured = (await options
          .api(`/projects/${encodeURIComponent(options.projectId)}/analysis/export`, {
            requestId: `analysis-${id}`,
            sourceThreadId: source.threadId,
            targetThreadId: target.threadId,
          })
          .catch(() => undefined)) as Record<string, unknown> | undefined
        if (!captured) continue
        job = { id, export: captured, policies: [source, target], state: "reserved" }
        await save(file, job)
      }
      try {
        const beforeAnalysis = await Promise.all(
          job.policies.map(
            (policy) => options.api(`/threads/${encodeURIComponent(policy.threadId)}/cooperation`) as Promise<Policy>,
          ),
        )
        if (
          beforeAnalysis.some(
            (policy, index) =>
              !policy.analysisEnabled ||
              policy.version !== job!.policies[index].version ||
              policy.sourceActivitySeq !== job!.policies[index].sourceActivitySeq ||
              policy.ownerId !== job!.policies[index].ownerId,
          )
        ) {
          job.state = "stale"
          await save(file, job)
          continue
        }
        if (!job.result) {
          job.result = await options.analyze(job.export)
          if (job.result.state !== "mapped" || !job.result.coordinationRunId)
            throw new Error("Analysis returned no validated mapped report")
          job.state = "analyzed"
          await save(file, job)
        }
        const current = await Promise.all(
          job.policies.map(
            (policy) => options.api(`/threads/${encodeURIComponent(policy.threadId)}/cooperation`) as Promise<Policy>,
          ),
        )
        if (
          current.some(
            (policy, index) =>
              !policy.analysisEnabled ||
              policy.version !== job!.policies[index].version ||
              policy.sourceActivitySeq !== job!.policies[index].sourceActivitySeq ||
              policy.ownerId !== job!.policies[index].ownerId,
          )
        ) {
          job.state = "stale"
          await save(file, job)
          continue
        }
        const result = job.result
        // The server independently authenticates and validates the result and
        // current consent before any safe-boundary admission is permitted.
        await options.api(
          `/projects/${encodeURIComponent(options.projectId)}/analysis/results`,
          {
            requestId: `result-${id}`,
            reportId: result.coordinationRunId,
            sourceThreadId: source.threadId,
            targetThreadId: target.threadId,
            sourceActivitySeq: source.sourceActivitySeq,
            targetActivitySeq: target.sourceActivitySeq,
            cooperationVersions: Object.fromEntries(job.policies.map((policy) => [policy.threadId, policy.version])),
            awarenessNoteCandidates: result.awarenessNoteCandidates,
          },
          "analysis",
        )
        for (const update of result.workCardUpdates) {
          try {
            await options.api(
              `/threads/${encodeURIComponent(update.threadId)}/work-card`,
              {
                expectedVersion: update.expectedVersion,
                sourceActivitySeq: update.sourceActivitySeq,
                card: update.card,
              },
              "analysis",
              "PUT",
            )
          } catch (error) {
            const snapshot = (await options.api(`/threads/${encodeURIComponent(update.threadId)}`)) as {
              workCard?: Record<string, unknown>
            }
            const card = update.card as Record<string, unknown>
            if (
              !snapshot.workCard ||
              snapshot.workCard.sourceActivitySeq !== update.sourceActivitySeq ||
              !Object.entries(card).every(
                ([key, value]) => JSON.stringify(snapshot.workCard![key]) === JSON.stringify(value),
              )
            )
              throw error
          }
        }
        job.deliveries = []
        let pendingDelivery = false
        if (target.awarenessMode === "notify")
          for (const note of result.awarenessNoteCandidates) {
            if (note.targetThreadId !== target.threadId || !target.ownerId) continue
            const path = `/threads/${encodeURIComponent(target.threadId)}/analysis/awareness`
            const messageId = `msg_${digest([id, note.noteId]).slice(0, 26)}`
            const readReceipt = () =>
              options
                .api(
                  `${path}/${encodeURIComponent(result.coordinationRunId)}/${encodeURIComponent(note.noteId)}`,
                  undefined,
                  target.ownerId,
                )
                .catch(() => undefined) as Promise<{ messageID?: string; admittedSeq?: number } | undefined>
            const known = await readReceipt()
            let receipt: Receipt | undefined = matchingReceipt(known, messageId) ? known : undefined
            if (!receipt) {
              try {
                const candidate = (await options.api(
                  path,
                  { reportId: result.coordinationRunId, noteId: note.noteId, messageId },
                  target.ownerId,
                )) as Receipt
                if (!matchingReceipt(candidate, messageId))
                  throw new Error("Delivery returned no matching admission receipt")
                receipt = candidate
              } catch (error) {
                const reconciled = await readReceipt()
                if (matchingReceipt(reconciled, messageId)) receipt = reconciled
                else {
                  pendingDelivery = true
                  job.deliveries.push({
                    noteId: note.noteId,
                    messageID: messageId,
                    state: "outcome_unknown",
                    reason: error instanceof Error ? error.message : "Delivery unavailable",
                  })
                }
              }
            }
            if (receipt) job.deliveries.push({ ...receipt, noteId: note.noteId, messageID: messageId })
            await save(file, job)
          }
        // Redirection proposals remain recorded for human review; no automatic
        // instruction or approval is created from proposalCandidates.
        job.state = pendingDelivery ? "analyzed" : "applied"
        await save(file, job)
      } catch (error) {
        job.error = error instanceof Error ? error.message : "Analysis processing failed"
        job.state = job.result ? "analyzed" : "failed"
        await save(file, job)
      }
    }
}

export const analystAgent = "puff-analyst"

type Envelope = {
  request: { requestId: string; targetSessionId: string }
  snapshot: {
    events: { eventId: string; sessionId: string; kind: string; occurredAt: string; content: Record<string, unknown> }[]
  }
  provenance: { threadId: string; eventId: string; eventSeq: number }[]
  bindings: {
    threadId: string
    sessionId: string
    title: string
    featureTopic: string
    relationship: string
    activitySeq: number
    expectedVersion: number
    deterministicStatus: string
    contributors: string[]
  }[]
}
type Summary = {
  currentTask: string
  progress: string
  blockers: string[]
  recentOutcome: string | null
  evidence: string[]
}
type Reply = {
  type: string
  content?: { type: string; text?: string }[]
  error?: unknown
  time?: { completed?: unknown }
}

/** Runs one tool-less OpenCode analyst Session over a server-authorized export and maps its answer to backend shapes. */
export async function runAnalysis(options: {
  backendUrl: string
  authorization: string
  model: { providerID: string; id: string }
  directory: string
  envelope: unknown
}): Promise<Mapped> {
  const envelope = options.envelope as Envelope
  const target = envelope.bindings.find((binding) => binding.sessionId === envelope.request.targetSessionId)
  const source = envelope.bindings.find((binding) => binding.sessionId !== envelope.request.targetSessionId)
  if (envelope.bindings.length !== 2 || !target || !source)
    throw new Error("Expected one source and one target binding")
  const selected = [source, target].map((binding, index) => ({
    binding,
    refs: envelope.snapshot.events
      .filter((event) => event.sessionId === binding.sessionId)
      .map((event, position) => {
        const captured = envelope.provenance.find(
          (item) => item.eventId === event.eventId && item.threadId === binding.threadId,
        )
        if (!captured) throw new Error("Exported event has no captured provenance")
        return {
          key: `${index === 0 ? "S" : "T"}${position + 1}`,
          event,
          ref: { threadId: binding.threadId, eventId: event.eventId, seq: captured.eventSeq },
        }
      }),
  }))
  if (selected.some((item) => !item.refs.length)) throw new Error("Selected session has no exported evidence")
  const reply = await ask(
    options,
    JSON.stringify({
      schemaVersion: 1,
      sessions: selected.map((item, index) => ({
        role: index === 0 ? "source" : "target",
        title: item.binding.title,
        featureTopic: item.binding.featureTopic,
        relationship: item.binding.relationship,
        status: item.binding.deterministicStatus,
        events: item.refs.map((ref) => ({
          ref: ref.key,
          kind: ref.event.kind,
          occurredAt: ref.event.occurredAt,
          content: ref.event.content,
        })),
      })),
    }),
  )
  const answer = parseAnswer(reply.text)
  const latest = selected.map((item) => item.refs.at(-1)!.ref)
  const generatedAt = new Date().toISOString()
  // The server rejects directive or credential-like notes; drop them here so the
  // rest of a valid report can still be registered.
  const note = answer.note !== null && informational(answer.note) ? answer.note.trim() : undefined
  return {
    state: "mapped",
    requestId: envelope.request.requestId,
    coordinationRunId: reply.sessionID,
    workCardUpdates: selected.map((item, index) => {
      const summary = index === 0 ? answer.source : answer.target
      const cited = item.refs.filter((ref) => summary.evidence.includes(ref.key)).map((ref) => ref.ref)
      return {
        threadId: item.binding.threadId,
        expectedVersion: item.binding.expectedVersion,
        sourceActivitySeq: item.binding.activitySeq,
        card: {
          currentTask: summary.currentTask,
          progress: summary.progress,
          blockers: summary.blockers,
          status: item.binding.deterministicStatus,
          summaryJobId: envelope.request.requestId,
          recentVerifiedOutcome: summary.recentOutcome,
          contributors: item.binding.contributors,
          evidenceRefs: cited.length ? cited.slice(-32) : [latest[index]],
          generatedAt,
        },
      }
    }),
    awarenessNoteCandidates: note
      ? [
          {
            noteId: `note_${digest([reply.sessionID, note]).slice(0, 24)}`,
            sourceThreadId: source.threadId,
            sourceActivitySeq: source.activitySeq,
            targetThreadId: target.threadId,
            targetActivitySeq: target.activitySeq,
            featureTopic: source.featureTopic,
            text: note,
            // The server accepts only the latest eligible source event as source evidence.
            evidenceRefs: latest,
            candidateState: "pending",
            deliveryState: "not_attempted",
          },
        ]
      : [],
    proposalCandidates: [],
  }
}

async function ask(options: Parameters<typeof runAnalysis>[0], text: string) {
  const call = async (path: string, body?: unknown) => {
    const response = await fetch(`${options.backendUrl}/api${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", Authorization: options.authorization },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`OpenCode analysis returned HTTP ${response.status} for ${path}`)
    return response.json()
  }
  // A newly opened Location loads its model and agent catalogs asynchronously; a
  // drain started before they load fails as if the model were unavailable.
  const location = `location[directory]=${encodeURIComponent(options.directory)}`
  const ready = Date.now() + 60_000
  while (true) {
    const models = (await call(`/model?${location}`)) as { data: { id: string; providerID: string }[] }
    const agents = (await call(`/agent?${location}`)) as { data: { id: string }[] }
    if (
      models.data.some((model) => model.providerID === options.model.providerID && model.id === options.model.id) &&
      agents.data.some((agent) => agent.id === analystAgent)
    )
      break
    if (Date.now() > ready) throw new Error("OpenCode analysis model or agent is unavailable")
    await Bun.sleep(1000)
  }
  const created = (await call("/session", {
    agent: analystAgent,
    model: options.model,
    location: { directory: options.directory },
  })) as { data: { id: string } }
  const sessionID = created.data.id
  await call(`/session/${encodeURIComponent(sessionID)}/prompt`, { prompt: { text } })
  const deadline = Date.now() + 300_000
  // A drain that fails before its first provider turn (for example an unavailable
  // model) records no assistant message, so a Session idle without a reply fails.
  const idleLimit = Date.now() + 15_000
  while (Date.now() < deadline) {
    await Bun.sleep(1000)
    const active = (await call("/session/active")) as { data: Record<string, unknown> }
    if (sessionID in active.data) continue
    const context = (await call(`/session/${encodeURIComponent(sessionID)}/context`)) as { data: Reply[] }
    const reply = context.data.findLast((message) => message.type === "assistant")
    if (!reply && Date.now() > idleLimit)
      throw new Error("OpenCode analysis agent stopped without a reply; check the configured model")
    if (!reply) continue
    if (reply.error !== undefined) throw new Error("OpenCode analysis agent failed")
    if (!reply.time?.completed) continue
    return {
      sessionID,
      text: (reply.content ?? [])
        .filter((part) => part.type === "text")
        .map((part) => part.text ?? "")
        .join(""),
    }
  }
  throw new Error("OpenCode analysis exceeded its local deadline")
}

function parseAnswer(text: string) {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end < start) throw new Error("Analysis agent returned no JSON object")
  const value = JSON.parse(text.slice(start, end + 1)) as { source?: unknown; target?: unknown; note?: unknown }
  if (value.note !== null && (typeof value.note !== "string" || !value.note.trim()))
    throw new Error("Analysis note must be a string or null")
  return { source: summary(value.source), target: summary(value.target), note: value.note as string | null }
}

function summary(value: unknown): Summary {
  const item = value as Partial<Summary> | undefined
  const bounded = (text: unknown) => typeof text === "string" && text.trim().length > 0 && text.length <= 8000
  if (
    !item ||
    !bounded(item.currentTask) ||
    !bounded(item.progress) ||
    !Array.isArray(item.blockers) ||
    item.blockers.length > 16 ||
    !item.blockers.every(bounded) ||
    (item.recentOutcome !== null && !bounded(item.recentOutcome)) ||
    !Array.isArray(item.evidence) ||
    !item.evidence.every((ref) => typeof ref === "string")
  )
    throw new Error("Analysis agent returned an invalid session summary")
  return item as Summary
}

// Mirrors the server's informational-note policy in coordination/analysis/results.ts.
function informational(text: string) {
  return (
    text.trim().length > 0 &&
    text.length <= 2000 &&
    !/\b(stop|abandon|switch|must|should|please|instead|implement|replace|ignore|disregard|override|execute|delete)\b/i.test(
      text,
    ) &&
    !/(bearer\s+\S+|sk-[a-z0-9_-]{12,}|(?:api[_-]?key|password|secret|access[_-]?token)\s*[=:])/i.test(text)
  )
}
