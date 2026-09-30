import { createHash } from "node:crypto"
import { spawn } from "node:child_process"
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
  text: string
  evidenceRefs: { threadId: string; eventId: string; seq: number }[]
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
        `/threads/${encodeURIComponent(note.targetThreadId)}/flower/awareness/${encodeURIComponent(job.result.coordinationRunId)}/${encodeURIComponent(note.noteId)}`,
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
export async function flowerCycle(options: {
  projectId: string
  stateDirectory: string
  api: Api
  analyze: (envelope: unknown) => Promise<Mapped>
}) {
  const directory = join(options.stateDirectory, "flower-jobs")
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
          .api(`/projects/${encodeURIComponent(options.projectId)}/flower/export`, {
            requestId: `flower-${id}`,
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
            throw new Error("Flower returned no validated mapped report")
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
          `/projects/${encodeURIComponent(options.projectId)}/flower/results`,
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
            const path = `/threads/${encodeURIComponent(target.threadId)}/flower/awareness`
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
        job.error = error instanceof Error ? error.message : "Flower processing failed"
        job.state = job.result ? "analyzed" : "failed"
        await save(file, job)
      }
    }
}

export async function runFlower(
  python: string,
  script: string,
  directory: string,
  envelope: unknown,
  track?: (process: ReturnType<typeof spawn>) => void,
): Promise<Mapped> {
  return new Promise((resolve, reject) => {
    const process = spawn(python, [script, "--state-dir", directory], {
      stdio: ["pipe", "pipe", "ignore"],
      detached: true,
    })
    track?.(process)
    let output = ""
    let settled = false
    const fail = (error: Error) => {
      if (!settled) {
        settled = true
        reject(error)
      }
    }
    const timeout = setTimeout(() => {
      if (process.pid) {
        try {
          globalThis.process.kill(-process.pid, "SIGKILL")
        } catch {}
      }
      fail(new Error("Flower chain exceeded its local deadline; inspect the private journal before retrying"))
    }, 330_000)
    process.on("error", (error) => {
      clearTimeout(timeout)
      fail(error)
    })
    process.stdout.on("data", (chunk) => {
      output += String(chunk)
      if (Buffer.byteLength(output) > 1_000_000) {
        process.kill("SIGKILL")
        fail(new Error("Flower result exceeded bound"))
      }
    })
    process.on("close", (code) => {
      clearTimeout(timeout)
      if (settled) return
      try {
        const result = JSON.parse(output)
        if (code !== 0 || result.state !== "mapped") return fail(new Error(result.error ?? "Flower chain failed"))
        settled = true
        resolve(result)
      } catch {
        fail(new Error("Flower produced an invalid result"))
      }
    })
    process.stdin.on("error", (error) => fail(error))
    process.stdin.end(JSON.stringify(envelope))
  })
}
