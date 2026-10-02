import { test, expect } from "bun:test"
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { analysisCycle } from "./analysis"

test("revocation during analysis prevents result publication and admission", async () => {
  const directory = await mkdtemp(join(tmpdir(), "puff-analysis-cycle-"))
  let revoked = false
  const mutations: string[] = []
  let calls = 0
  const api = async (path: string, body?: unknown) => {
    if (path.endsWith("/threads")) return [{ id: "a" }, { id: "b" }]
    if (path.endsWith("/cooperation"))
      return {
        threadId: path.includes("/a/") ? "a" : "b",
        ownerId: "owner",
        sourceActivitySeq: 4,
        version: revoked ? 2 : 1,
        analysisEnabled: !revoked,
        featureTopic: "navigation",
        awarenessMode: "notify",
      }
    if (path.endsWith("/export")) {
      if (revoked) throw new Error("Current consent required")
      return { request: body }
    }
    mutations.push(path)
    return {}
  }
  try {
    await analysisCycle({
      projectId: "p",
      stateDirectory: directory,
      api,
      analyze: async () => {
        calls++
        revoked = true
        return {
          state: "mapped",
          requestId: "x",
          coordinationRunId: "run",
          workCardUpdates: [],
          awarenessNoteCandidates: [],
          proposalCandidates: [],
        }
      },
    })
    expect(calls).toBe(1)
    expect(mutations).toEqual([])
    await analysisCycle({
      projectId: "p",
      stateDirectory: directory,
      api,
      analyze: async () => {
        throw new Error("Revoked sessions must never run")
      },
    })
    expect(mutations).toEqual([])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("exact completed report retries neither rerun analysis nor redirect work", async () => {
  const directory = await mkdtemp(join(tmpdir(), "puff-analysis-retry-"))
  const writes: { path: string; body: unknown; credential?: string }[] = []
  let calls = 0
  const api = async (path: string, body?: unknown, credential?: string) => {
    if (path.endsWith("/threads")) return [{ id: "a" }, { id: "b" }]
    if (path.endsWith("/cooperation"))
      return {
        threadId: path.includes("/a/") ? "a" : "b",
        ownerId: "owner",
        sourceActivitySeq: 4,
        version: 1,
        analysisEnabled: true,
        featureTopic: "navigation",
        awarenessMode: "off",
      }
    if (path.endsWith("/export")) return { request: body }
    writes.push({ path, body, credential })
    return { state: "accepted" }
  }
  const analyze = async () => {
    calls++
    return {
      state: "mapped" as const,
      requestId: "x",
      coordinationRunId: `run-${calls}`,
      workCardUpdates: [],
      awarenessNoteCandidates: [],
      proposalCandidates: [{ text: "Change direction" }],
    }
  }
  try {
    const options = { projectId: "p", stateDirectory: directory, api, analyze }
    await analysisCycle(options)
    await analysisCycle(options)
    expect(calls).toBe(2)
    expect(writes.length).toBe(2)
    expect(writes.every((write) => write.path.endsWith("/analysis/results") && write.credential === "analysis")).toBe(
      true,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("current consent is rechecked before the first hosted submission", async () => {
  const directory = await mkdtemp(join(tmpdir(), "puff-analysis-preflight-"))
  let policyReads = 0
  let analyses = 0
  const api = async (path: string) => {
    if (path.endsWith("/threads")) return [{ id: "a" }, { id: "b" }]
    if (path.endsWith("/cooperation")) {
      policyReads++
      return {
        threadId: path.includes("/a/") ? "a" : "b",
        ownerId: "owner",
        sourceActivitySeq: 4,
        version: policyReads > 2 ? 2 : 1,
        analysisEnabled: policyReads <= 2,
        featureTopic: "navigation",
        awarenessMode: "off",
      }
    }
    return {}
  }
  try {
    await analysisCycle({
      projectId: "p",
      stateDirectory: directory,
      api,
      analyze: async () => {
        analyses++
        throw new Error("Revoked evidence reached model")
      },
    })
    expect(analyses).toBe(0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("a lost awareness response reconciles its durable receipt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "puff-analysis-receipt-"))
  let admitted: { messageID: string; admittedSeq: number } | undefined
  let submissions = 0
  const api = async (path: string, body?: unknown) => {
    if (path.endsWith("/threads")) return [{ id: "a" }, { id: "b" }]
    if (path.endsWith("/cooperation"))
      return {
        threadId: path.includes("/a/") ? "a" : "b",
        ownerId: "owner",
        sourceActivitySeq: 4,
        version: 1,
        analysisEnabled: true,
        featureTopic: "navigation",
        awarenessMode: "notify",
      }
    if (path.endsWith("/export")) return { request: body }
    if (path.includes("/analysis/awareness/") && !body) {
      if (!admitted) throw new Error("not_found")
      return admitted
    }
    if (path.endsWith("/analysis/awareness")) {
      submissions++
      admitted = { messageID: (body as { messageId: string }).messageId, admittedSeq: 5 }
      throw new Error("Lost response")
    }
    return {}
  }
  try {
    let count = 0
    const options = {
      projectId: "p",
      stateDirectory: directory,
      api,
      analyze: async () => ({
        state: "mapped" as const,
        requestId: "x",
        coordinationRunId: `run-${++count}`,
        workCardUpdates: [],
        awarenessNoteCandidates: [
          {
            noteId: "note",
            sourceThreadId: "a",
            sourceActivitySeq: 4,
            targetThreadId: "b",
            targetActivitySeq: 4,
            text: "An informational finding.",
            evidenceRefs: [],
          },
        ],
        proposalCandidates: [],
      }),
    }
    await analysisCycle(options)
    await analysisCycle(options)
    expect(submissions).toBe(1)
    expect(count).toBe(2)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("uncertain historical admission is reconciled after activity and consent change without replay", async () => {
  const directory = await mkdtemp(join(tmpdir(), "puff-analysis-history-"))
  let changed = false
  let admitted: { messageID: string; admittedSeq: number } | undefined
  let analyses = 0
  let admissions = 0
  let ownerChanged = false
  let receiptReads = 0
  const api = async (path: string, body?: unknown) => {
    if (path.endsWith("/threads")) return [{ id: "a" }, { id: "b" }]
    if (path.endsWith("/cooperation"))
      return {
        threadId: path.includes("/a/") ? "a" : "b",
        ownerId: ownerChanged ? "new-owner" : "owner",
        sourceActivitySeq: changed ? 9 : 4,
        version: changed ? 2 : 1,
        analysisEnabled: !changed,
        featureTopic: "navigation",
        awarenessMode: "notify",
      }
    if (path.endsWith("/export")) return { request: body }
    if (path.includes("/analysis/awareness/") && !body) {
      receiptReads++
      if (!changed) throw new Error("Receipt service unavailable")
      return admitted
    }
    if (path.endsWith("/analysis/awareness")) {
      admissions++
      admitted = { messageID: (body as { messageId: string }).messageId, admittedSeq: 5 }
      throw new Error("Lost response")
    }
    return {}
  }
  try {
    const options = {
      projectId: "p",
      stateDirectory: directory,
      api,
      analyze: async (envelope: unknown) => {
        analyses++
        const request = (envelope as { request: { sourceThreadId: string; targetThreadId: string } }).request
        return {
          state: "mapped" as const,
          requestId: "x",
          coordinationRunId: `run-${analyses}`,
          workCardUpdates: [],
          awarenessNoteCandidates:
            request.targetThreadId === "b"
              ? [
                  {
                    noteId: "note",
                    sourceThreadId: "a",
                    sourceActivitySeq: 4,
                    targetThreadId: "b",
                    targetActivitySeq: 4,
                    text: "An informational finding.",
                    evidenceRefs: [],
                  },
                ]
              : [],
          proposalCandidates: [],
        }
      },
    }
    await analysisCycle(options)
    const files = (await readdir(join(directory, "analysis-jobs"))).filter((file) => /^[a-f0-9]{64}\.json$/.test(file))
    const jobs = await Promise.all(
      files.map(async (file) => ({
        file,
        job: JSON.parse(await readFile(join(directory, "analysis-jobs", file), "utf8")),
      })),
    )
    const pending = jobs.find(({ job }) => job.deliveries?.[0]?.state === "outcome_unknown")!
    expect(pending.job.state).toBe("analyzed")
    changed = true
    ownerChanged = true
    receiptReads = 0
    await analysisCycle(options)
    expect(receiptReads).toBe(0)
    ownerChanged = false
    await analysisCycle(options)
    const reconciled = JSON.parse(await readFile(join(directory, "analysis-jobs", pending.file), "utf8"))
    expect(reconciled.state).toBe("applied")
    expect(reconciled.deliveries[0].admittedSeq).toBe(5)
    expect(reconciled.deliveries[0].state).toBeUndefined()
    expect(analyses).toBe(2)
    expect(admissions).toBe(1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("foreign, negative or unsafe receipts cannot become confirmed admission", async () => {
  for (const invalid of [
    { messageID: "msg_foreign", admittedSeq: 99 },
    { admittedSeq: -1 },
    { admittedSeq: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    const directory = await mkdtemp(join(tmpdir(), "puff-analysis-wrong-receipt-"))
    const api = async (path: string, body?: unknown) => {
      if (path.endsWith("/threads")) return [{ id: "a" }, { id: "b" }]
      if (path.endsWith("/cooperation"))
        return {
          threadId: path.includes("/a/") ? "a" : "b",
          ownerId: "owner",
          sourceActivitySeq: 4,
          version: 1,
          analysisEnabled: true,
          featureTopic: "navigation",
          awarenessMode: "notify",
        }
      if (path.endsWith("/export")) return { request: body }
      if (path.includes("/analysis/awareness/")) throw new Error("No matching receipt")
      if (path.endsWith("/analysis/awareness"))
        return {
          messageID: invalid.messageID ?? (body as { messageId: string }).messageId,
          admittedSeq: invalid.admittedSeq,
        }
      return {}
    }
    try {
      let count = 0
      await analysisCycle({
        projectId: "p",
        stateDirectory: directory,
        api,
        analyze: async () => ({
          state: "mapped" as const,
          requestId: "x",
          coordinationRunId: `run-${++count}`,
          workCardUpdates: [],
          awarenessNoteCandidates: [
            {
              noteId: "note",
              sourceThreadId: "a",
              sourceActivitySeq: 4,
              targetThreadId: "b",
              targetActivitySeq: 4,
              text: "An informational finding.",
              evidenceRefs: [],
            },
          ],
          proposalCandidates: [],
        }),
      })
      const files = (await readdir(join(directory, "analysis-jobs"))).filter((file) => /^[a-f0-9]{64}\.json$/.test(file))
      const jobs = await Promise.all(
        files.map(async (file) => JSON.parse(await readFile(join(directory, "analysis-jobs", file), "utf8"))),
      )
      const deliveries = jobs.flatMap((job) => job.deliveries)
      expect(deliveries.length).toBe(1)
      expect(deliveries[0].state).toBe("outcome_unknown")
      expect(deliveries[0].admittedSeq).toBeUndefined()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
})
