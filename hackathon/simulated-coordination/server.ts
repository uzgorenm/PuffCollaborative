import { activeBInstruction, activeBRun, actors, approvedFixInstructionText, buildData, completedOutcome, completedSourceRef, fixSourceRef, fixTargetErrorRef, fixTargetThreadId, phases, projectMembership, projects, sourceRef, targetThreadId } from "./fixtures"
import { applyFixInDisposableWorkspace, fixCommand, fixError, fixPatch, fixSummary } from "./fix-workspace"

const prefix = "/api/coordination/v1"
const timestamp = "2026-09-29T19:00:00.000Z"
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "600",
  "Cache-Control": "no-store",
}

const scenarioDefinitions = [
  {
    id: "wf04", projectId: "sim-wf04", title: "Reuse Alya's verified ProjectList fix",
    classification: "source_backed_fix",
    summary: "Alice can apply Alya's exact fix to the matching error after reviewing its source event.",
    threadIds: ["wf04-alice", "wf04-alya", "wf04-unrelated"],
  },
  {
    id: "wf01", projectId: "sim-wf01", title: "Deliberate alternatives",
    classification: "alternative",
    summary: "A and B are separate ongoing approaches; private work is excluded.",
    threadIds: ["wf01-A", "wf01-B"],
    privateSessionExcluded: true,
  },
  {
    id: "wf02", projectId: "sim-wf02", title: "Source finding reaches B",
    classification: "source_linked_awareness",
    summary: "Synthetic NAV-742 moves through admitted, promoted, and used fixture states.",
    threadIds: ["wf02-A", "wf02-B"],
  },
  {
    id: "wf03", projectId: "sim-wf03", title: "Overlap versus unrelated similarity",
    classification: "mixed",
    summary: "NAV-900 is a tentative likely overlap; migration and UI navigation are unrelated.",
    threadIds: ["wf03-overlap-A", "wf03-overlap-B", "wf03-unrelated-db", "wf03-unrelated-ui"],
    comparisons: [
      {
        id: "overlap", classification: "likely_overlap", topic: "project-navigation",
        threadIds: ["wf03-overlap-A", "wf03-overlap-B"],
        finding: "Tentative repeated NAV-900 investigation; compare evidence, do not stop either worker.",
      },
      {
        id: "unrelated", classification: "none", topics: ["database-migrations", "project-ui-navigation"],
        threadIds: ["wf03-unrelated-db", "wf03-unrelated-ui"],
        finding: null,
      },
    ],
  },
]

function json(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(value, { status, headers: { ...cors, ...headers } })
}

function authenticate(request: Request) {
  const header = request.headers.get("authorization")
  if (!header?.startsWith("Basic ")) return undefined
  try {
    const decoded = atob(header.slice(6))
    const separator = decoded.indexOf(":")
    if (separator < 1) return undefined
    const username = decoded.slice(0, separator)
    const password = decoded.slice(separator + 1)
    if (password !== `demo-${username}` || !Object.hasOwn(projectMembership, username)) return undefined
    return username
  } catch {
    return undefined
  }
}

type SimulationEvent = {
  id: string
  projectId: string
  threadId: string
  seq: number
  kind: string
  occurredAt: string
  actorId: string
  runId?: string
  instructionId?: string
  payload: Record<string, unknown>
}

function page(events: SimulationEvent[], after: number, limit: number) {
  const rows = events.filter((event) => event.seq > after).sort((a, b) => a.seq - b.seq)
  const selected = rows.slice(0, limit)
  return { events: selected, cursor: selected.at(-1)?.seq ?? after, hasMore: rows.length > limit }
}

function pageQuery(url: URL) {
  const rawAfter = url.searchParams.get("after") ?? "0"
  const rawLimit = url.searchParams.get("limit") ?? "100"
  const after = Number(rawAfter)
  const limit = Number(rawLimit)
  if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200)
    return undefined
  return { after, limit }
}

type AppliedFix = {
  instruction: {
    id: string; requestId: string; threadId: string; actorId: string; text: string
    queueSeq: number; submittedAt: string; runId: string
  }
  run: {
    id: string; threadId: string; instructionId: string; state: "completed" | "failed"
    attempt: number; runnerMessageId: string; createdAt: string; startedAt: string; endedAt: string
  }
  events: SimulationEvent[]
  verification?: { command: string; exitCode: number; output: string }
}

export function createSimulationServer({ port = 4187, forcePostTestFailure = false, fixtureState }: {
  port?: number
  forcePostTestFailure?: boolean
  fixtureState?: "stale-source" | "stale-target"
} = {}) {
  let stage = 0
  let selectedScenarioId = "wf04"
  let accepted: { requestId: string; signature: string; result: Promise<AppliedFix> } | undefined
  let applied: AppliedFix | undefined

  function currentData() {
    const data = buildData(stage)
    const events: SimulationEvent[] = [...data.events]
    if (applied) {
      events.push(...applied.events)
      const target = data.threads.find((thread) => thread.id === fixTargetThreadId)!
      // Only content events advance the thread's content revision.
      target.activitySeq = applied.events.find((event) => event.kind === "run.tool")?.seq ?? target.activitySeq
      const card = data.cards[fixTargetThreadId]
      card.version = 2
      card.sourceActivitySeq = target.activitySeq
      card.status = applied.run.state === "completed" ? "done" : "blocked"
      card.progress = applied.run.state === "completed"
        ? "Applied Alya's cited ProjectList fix and passed the focused test."
        : "Could not verify Alya's cited ProjectList fix."
      card.blockers = applied.run.state === "completed" ? [] : ["Focused verification failed"]
      card.recentVerifiedOutcome = applied.run.state === "completed"
        ? applied.verification?.output ?? null : null
      const tool = applied.events.find((event) => event.kind === "run.tool")
      if (tool) card.evidenceRefs = [{ threadId: fixTargetThreadId, eventId: tool.id, seq: tool.seq }]
      card.submittedBy = "SIMULATED verified local run"
    }
    return { ...data, events }
  }

  async function applyApprovedFix(requestId: string): Promise<AppliedFix> {
    const instructionId = `synthetic-instruction-wf04-${requestId}`
    const runId = `synthetic-run-wf04-${requestId}`
    const instruction = {
      id: instructionId, requestId, threadId: fixTargetThreadId, actorId: "usr_alice",
      text: approvedFixInstructionText, queueSeq: 1, submittedAt: timestamp, runId,
    }
    const event = (seq: number, kind: string, payload: Record<string, unknown>) => ({
      id: `wf04-apply-${requestId}-${seq}`, projectId: "sim-wf04", threadId: fixTargetThreadId,
      seq, kind, occurredAt: timestamp, actorId: "usr_alice", runId, instructionId,
      payload,
    })
    const events: SimulationEvent[] = [
      event(7, "instruction.submitted", { text: approvedFixInstructionText, sourceRef: fixSourceRef, targetErrorRef: fixTargetErrorRef }),
      event(8, "run.started", { summary: "Apply Alya's cited fix to Alice's matching error." }),
    ]
    let verification: AppliedFix["verification"]
    let error: string | undefined
    try {
      const receipt = await applyFixInDisposableWorkspace({ forcePostTestFailure })
      verification = { command: fixCommand, exitCode: receipt.after.exitCode, output: receipt.after.output }
      events.push(event(9, "run.diff", {
        ref: "project-list.ts", summary: fixSummary, patch: fixPatch,
        sourceRef: fixSourceRef, targetErrorRef: fixTargetErrorRef,
      }))
      events.push(event(10, "run.tool", {
        toolName: fixCommand, status: verification.exitCode === 0 ? "completed" : "failed",
        verification,
      }))
    } catch (cause) {
      console.error("[Puff SIMULATED fix developer error]", cause)
      error = "Local synthetic verification could not run"
    }
    const state = verification?.exitCode === 0 ? "completed" : "failed"
    events.push(event(verification ? 11 : 9, state === "completed" ? "run.completed" : "run.failed", {
      summary: state === "completed" ? "Focused verification passed." : "Focused verification failed.",
      ...(error ? { error } : {}),
    }))
    const run = {
      id: runId, threadId: fixTargetThreadId, instructionId,
      state, attempt: 1, runnerMessageId: `synthetic-message-wf04-${requestId}`,
      createdAt: timestamp, startedAt: timestamp, endedAt: timestamp,
    }
    return { instruction, run, events, verification }
  }

  function approvedFixtureIsCurrent() {
    const data = buildData(stage)
    const source = data.events.find((event) => event.id === fixSourceRef.eventId)
    const target = data.events.find((event) => event.id === fixTargetErrorRef.eventId)
    const sourceThread = data.threads.find((thread) => thread.id === fixSourceRef.threadId)
    const targetThread = data.threads.find((thread) => thread.id === fixTargetThreadId)
    const sourceCard = data.cards[fixSourceRef.threadId]
    const targetCard = data.cards[fixTargetThreadId]
    const fix = source?.payload.fix as Record<string, unknown> | undefined
    return !applied && fixtureState !== "stale-source" && fixtureState !== "stale-target" &&
      source?.threadId === fixSourceRef.threadId && source.seq === fixSourceRef.seq &&
      source.kind === "run.output" && source.actorId === "usr_alya" &&
      fix?.error === fixError && fix?.summary === fixSummary && fix?.patch === fixPatch &&
      JSON.stringify(fix?.verification) === JSON.stringify({ command: fixCommand, exitCode: 0, output: "2 pass, 0 fail" }) &&
      sourceCard.status === "done" && sourceCard.contributors.includes("usr_alya") &&
      sourceCard.evidenceRefs.some((ref) => JSON.stringify(ref) === JSON.stringify(fixSourceRef)) &&
      sourceCard.sourceActivitySeq === sourceThread?.activitySeq &&
      target?.threadId === fixTargetErrorRef.threadId && target.seq === fixTargetErrorRef.seq &&
      target.kind === "run.failed" && target.payload.summary === fixError &&
      targetCard.evidenceRefs.some((ref) => JSON.stringify(ref) === JSON.stringify(fixTargetErrorRef)) &&
      targetCard.sourceActivitySeq === targetThread?.activitySeq
  }

  function manifest(actor: string) {
    const allowed = projectMembership[actor]
    const scenarios = scenarioDefinitions.filter((scenario) => allowed.includes(scenario.projectId))
    const canSeeWf02 = allowed.includes("sim-wf02")
    return {
      simulated: true,
      mode: "synthetic",
      label: "SIMULATED",
      selectedScenarioId: scenarios.some((scenario) => scenario.id === selectedScenarioId)
        ? selectedScenarioId : scenarios[0]?.id,
      scenarios,
      actors: actors.filter((person) => projectMembership[person.username].some((projectId) => allowed.includes(projectId))),
      capabilities: { fixReuse: allowed.includes("sim-wf04") },
      ...(allowed.includes("sim-wf04") ? { fixReuse: {
        projectId: "sim-wf04", targetThreadId: fixTargetThreadId,
        sourceRef: fixSourceRef, targetErrorRef: fixTargetErrorRef,
        error: fixError, approvedInstructionText: approvedFixInstructionText,
      } } : {}),
      ...(allowed.includes("sim-wf03") ? { taskStart: {
        projectId: "sim-wf03",
        completed: {
          id: "migration-navigation-map", task: "Map database migration navigation",
          matchPhrases: ["map database migration navigation", "migration navigation map"],
          threadId: completedSourceRef.threadId, reportedBy: "usr_cara",
          result: completedOutcome, sourceRef: completedSourceRef,
        },
        remaining: [
          { id: "check-migration-links", title: "Check migration links", rationale: "The completed map lists link destinations, but their links have not been checked.", sourceRef: completedSourceRef },
          { id: "test-migration-keyboard", title: "Test migration keyboard access", rationale: "The completed map leaves keyboard access untested.", sourceRef: completedSourceRef },
        ],
      } } : {}),
      ...(canSeeWf02 ? {
        wf02: {
          stage, phase: phases[stage], sourceRef, targetThreadId,
          milestones: phases.map((phase, index) => ({
            phase, state: index < stage ? "simulated_observed" : index === stage ? "simulated_current" : "simulated_future",
            receiptId: index === 0 ? sourceRef.eventId : `synthetic-wf02-${phase}`,
            observedAt: index <= stage ? timestamp : null,
            sourceRef,
            targetThreadId,
          })),
        },
      } : {}),
    }
  }

  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(request) {
      if (request.method === "OPTIONS")
        return new Response(null, { status: 204, headers: cors })
      const url = new URL(request.url)
      if (!url.pathname.startsWith(prefix + "/")) return json({ error: "Not found" }, 404)
      const route = url.pathname.slice(prefix.length)
      if (route === "/status" && request.method === "GET")
        return json({ ready: true, simulated: true, mode: "synthetic", label: "SIMULATED" })
      const actor = authenticate(request)
      if (!actor)
        return json({ error: "Demo Basic authentication required", simulated: true }, 401, {
          "WWW-Authenticate": 'Basic realm="Puff SIMULATED"',
        })
      const allowed = projectMembership[actor]

      if (route === "/simulation") {
        if (request.method === "GET") return json(manifest(actor))
        return json({ error: "Method not allowed" }, 405)
      }
      if (route.startsWith("/simulation/")) {
        if (request.method !== "POST") return json({ error: "Method not allowed" }, 405)
        if (actor !== "alice") return json({ error: "Demo operator account required" }, 403)
        if (route === "/simulation/reset") {
          stage = 0
          selectedScenarioId = "wf04"
          accepted = undefined
          applied = undefined
          return json(manifest(actor))
        }
        if (route === "/simulation/wf02/advance") {
          stage = Math.min(stage + 1, 3)
          selectedScenarioId = "wf02"
          return json(manifest(actor))
        }
        if (route === "/simulation/select") {
          const body = await request.json().catch(() => undefined)
          if (!body || !scenarioDefinitions.some((scenario) => scenario.id === body.scenarioId))
            return json({ error: "Unknown scenario" }, 400)
          selectedScenarioId = body.scenarioId
          return json(manifest(actor))
        }
        return json({ error: "Not found" }, 404)
      }

      const instructionMatch = /^\/threads\/([^/]+)\/instructions$/.exec(route)
      if (instructionMatch && request.method === "POST") {
        let threadId: string
        try {
          threadId = decodeURIComponent(instructionMatch[1])
        } catch {
          return json({ error: "Invalid path" }, 400)
        }
        if (!allowed.includes("sim-wf04")) return json({ error: "Not found" }, 404)
        if (actor !== "alice" || threadId !== fixTargetThreadId)
          return json({ error: "Approved Alice target required" }, 409)
        const body = await request.json().catch(() => undefined)
        if (!body || typeof body !== "object" || Array.isArray(body) ||
          typeof body.requestId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(body.requestId) ||
          body.text !== approvedFixInstructionText ||
          (body.sourceRef !== undefined && JSON.stringify(body.sourceRef) !== JSON.stringify(fixSourceRef)) ||
          (body.targetErrorRef !== undefined && JSON.stringify(body.targetErrorRef) !== JSON.stringify(fixTargetErrorRef)))
          return json({ error: "Approved source, target and instruction text required" }, 409)
        const signature = JSON.stringify({ text: body.text, sourceRef: body.sourceRef, targetErrorRef: body.targetErrorRef })
        if (accepted) {
          if (accepted.requestId !== body.requestId || accepted.signature !== signature)
            return json({ error: "Instruction already accepted with different request data" }, 409)
          const { instruction, run } = await accepted.result
          return json({ instruction, run })
        }
        if (!approvedFixtureIsCurrent()) return json({ error: "Source or target evidence is stale" }, 409)
        const result = applyApprovedFix(body.requestId)
        accepted = { requestId: body.requestId, signature, result }
        const outcome = await result
        applied = outcome
        return json({ instruction: outcome.instruction, run: outcome.run })
      }
      if (request.method !== "GET")
        return json({ error: "SIMULATED_READ_ONLY", simulated: true }, 409)
      if (route === "/projects")
        return json(projects.filter((project) => allowed.includes(project.id)))
      let parts: string[]
      try {
        parts = route.slice(1).split("/").map(decodeURIComponent)
      } catch {
        return json({ error: "Invalid path" }, 400)
      }
      const data = currentData()
      if (parts[0] === "projects" && parts[1]) {
        const project = projects.find((item) => item.id === parts[1] && allowed.includes(item.id))
        if (!project) return json({ error: "Not found" }, 404)
        if (parts.length === 2)
          return json({
            project,
            members: actors.filter((person) => projectMembership[person.username].includes(project.id)).map((person) => ({
              projectId: project.id, userId: person.userId,
              role: person.userId === project.createdBy ? "owner" : "member",
              joinedAt: timestamp,
            })),
          })
        if (parts[2] === "threads" && parts.length === 3)
          return json(data.threads.filter((thread) => thread.projectId === project.id))
        if (parts[2] === "work-cards" && parts.length === 3)
          return json(Object.values(data.cards).filter((card) => card.projectId === project.id))
        if (parts[2] === "events" && parts.length === 3) {
          const query = pageQuery(url)
          if (!query) return json({ error: "Invalid cursor or limit" }, 400)
          return json(page(data.events.filter((event) => event.projectId === project.id), query.after, query.limit))
        }
      }
      if (parts[0] === "threads" && parts[1]) {
        const thread = data.threads.find((item) => item.id === parts[1] && allowed.includes(item.projectId))
        if (!thread) return json({ error: "Not found" }, 404)
        if (parts.length === 2)
          return json({
            thread,
            instructions: thread.id === targetThreadId ? [activeBInstruction]
              : thread.id === fixTargetThreadId && applied ? [applied.instruction] : [],
            runs: thread.id === targetThreadId ? [activeBRun]
              : thread.id === fixTargetThreadId && applied ? [applied.run] : [],
            approvals: [],
            workCard: data.cards[thread.id],
            cursor: data.events.filter((event) => event.threadId === thread.id).at(-1)?.seq ?? 0,
          })
        if (parts[2] === "events" && parts.length === 3) {
          const query = pageQuery(url)
          if (!query) return json({ error: "Invalid cursor or limit" }, 400)
          return json(page(data.events.filter((event) => event.threadId === thread.id), query.after, query.limit))
        }
        if (parts[2] === "comments" && parts.length === 3) return json([])
      }
      return json({ error: "Not found" }, 404)
    },
  })
}

if (import.meta.main) {
  const port = Number(process.env.PUFF_SIM_PORT ?? "4187")
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PUFF_SIM_PORT")
  const server = createSimulationServer({ port })
  console.log(`Puff SIMULATED coordination: http://127.0.0.1:${server.port}`)
}
