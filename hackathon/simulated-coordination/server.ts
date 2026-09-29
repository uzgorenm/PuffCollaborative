import { activeBInstruction, activeBRun, actors, buildData, phases, projectMembership, projects, sourceRef, targetThreadId } from "./fixtures"

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

function page(events: ReturnType<typeof buildData>["events"], after: number, limit: number) {
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

export function createSimulationServer({ port = 4187 }: { port?: number } = {}) {
  let stage = 0
  let selectedScenarioId = "wf01"
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
      actors,
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
          selectedScenarioId = "wf01"
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
      const data = buildData(stage)
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
            instructions: thread.id === targetThreadId ? [activeBInstruction] : [],
            runs: thread.id === targetThreadId ? [activeBRun] : [],
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
