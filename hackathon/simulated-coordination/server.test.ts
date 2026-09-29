import { afterAll, beforeAll, expect, test } from "bun:test"
import { createSimulationServer } from "./server"
import { privateFixtureMarkerForTest } from "./fixtures"

let server: ReturnType<typeof createSimulationServer>
let origin: string

beforeAll(() => {
  server = createSimulationServer({ port: 0 })
  origin = `http://127.0.0.1:${server.port}`
})
afterAll(() => server.stop(true))

const auth = (name = "alice", password = `demo-${name}`) => ({
  Authorization: `Basic ${btoa(`${name}:${password}`)}`,
})
const get = (path: string, name?: string, password?: string) =>
  fetch(origin + path, { headers: auth(name, password) })
const post = (path: string, body: unknown = {}, name?: string) =>
  fetch(origin + path, {
    method: "POST",
    headers: { ...auth(name), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

function assertProject(project: any) {
  for (const key of ["id", "name", "createdBy", "createdAt"]) expect(typeof project[key]).toBe("string")
}
function assertThread(thread: any) {
  for (const key of ["id", "projectId", "sessionId", "workerId", "title", "createdBy", "createdAt"])
    expect(typeof thread[key]).toBe("string")
  expect(Number.isInteger(thread.activitySeq)).toBe(true)
}
function assertEvent(event: any) {
  for (const key of ["id", "projectId", "kind", "occurredAt"]) expect(typeof event[key]).toBe("string")
  expect(Number.isInteger(event.seq)).toBe(true)
  expect(typeof event.payload).toBe("object")
}
function assertCard(card: any) {
  for (const key of [
    "id", "projectId", "threadId", "currentTask", "progress", "status",
    "generatedAt", "submittedBy", "updatedAt", "summaryJobId",
  ]) expect(typeof card[key]).toBe("string")
  for (const key of ["version", "sourceActivitySeq"]) expect(Number.isInteger(card[key])).toBe(true)
  for (const key of ["blockers", "contributors", "evidenceRefs"]) expect(Array.isArray(card[key])).toBe(true)
  expect(card.recentVerifiedOutcome === null || typeof card.recentVerifiedOutcome === "string").toBe(true)
}

test("read API returns coordination-shaped projects, threads, snapshots and replay", async () => {
  const status = await (await fetch(origin + "/api/coordination/v1/status")).json()
  expect(status).toMatchObject({ ready: true, simulated: true, mode: "synthetic" })
  const projects = await (await get("/api/coordination/v1/projects")).json()
  expect(projects.map((project: any) => project.id)).toEqual([
    "sim-wf01", "sim-wf02", "sim-wf03",
  ])
  projects.forEach(assertProject)
  const threads = await (await get("/api/coordination/v1/projects/sim-wf01/threads")).json()
  expect(threads).toHaveLength(2)
  threads.forEach(assertThread)
  const details = await (await get("/api/coordination/v1/projects/sim-wf01")).json()
  assertProject(details.project)
  expect(details.members).toHaveLength(4)
  for (const member of details.members) {
    expect(member.projectId).toBe("sim-wf01")
    expect(["owner", "member"]).toContain(member.role)
    expect(typeof member.userId).toBe("string")
    expect(typeof member.joinedAt).toBe("string")
  }
  const cards = await (await get("/api/coordination/v1/projects/sim-wf01/work-cards")).json()
  expect(cards).toHaveLength(2)
  cards.forEach(assertCard)
  for (const card of cards)
    for (const ref of card.evidenceRefs) expect(ref.threadId).toBe(card.threadId)
  const snapshot = await (await get(`/api/coordination/v1/threads/${threads[0].id}`)).json()
  expect(snapshot.thread.id).toBe(threads[0].id)
  expect(snapshot).toMatchObject({ instructions: [], runs: [], approvals: [] })
  expect(Number.isInteger(snapshot.cursor)).toBe(true)
  assertCard(snapshot.workCard)
  const replay = await (await get(`/api/coordination/v1/threads/${threads[0].id}/events?after=0&limit=200`)).json()
  expect(replay.hasMore).toBe(false)
  expect(Number.isInteger(replay.cursor)).toBe(true)
  replay.events.forEach(assertEvent)
})

test("WF01 keeps deliberate alternatives distinct and never exports private P", async () => {
  const manifest = await (await get("/api/coordination/v1/simulation")).json()
  expect(manifest).toMatchObject({ simulated: true, label: "SIMULATED" })
  expect(manifest.scenarios.find((item: any) => item.id === "wf01").classification).toBe("alternative")
  const response = await get("/api/coordination/v1/projects/sim-wf01/events?after=0&limit=200")
  const body = await response.text()
  expect(body).toContain("compact")
  expect(body).toContain("expanded")
  expect(body).not.toContain(privateFixtureMarkerForTest())
  expect(body).not.toContain("session-P")
  expect((await get("/api/coordination/v1/projects/sim-wf01/threads")).status).toBe(200)
  for (const path of [
    "/api/coordination/v1/projects",
    "/api/coordination/v1/projects/sim-wf01",
    "/api/coordination/v1/projects/sim-wf01/threads",
    "/api/coordination/v1/projects/sim-wf01/work-cards",
    "/api/coordination/v1/simulation",
  ]) expect(await (await get(path)).text()).not.toContain(privateFixtureMarkerForTest())
})

test("WF02 advances admitted, promoted, used deterministically with exact source", async () => {
  await post("/api/coordination/v1/simulation/reset")
  const base = await (await get("/api/coordination/v1/simulation")).json()
  expect(base.wf02.stage).toBe(0)
  const source = base.wf02.sourceRef
  const sourcePage = await (await get(`/api/coordination/v1/projects/sim-wf02/events?after=${source.seq - 1}&limit=1`)).json()
  expect(sourcePage.events[0]).toMatchObject({ id: source.eventId, threadId: source.threadId, seq: source.seq })
  expect(JSON.stringify(sourcePage.events[0])).toContain("NAV-742")
  const target = base.wf02.targetThreadId
  const initialSnapshot = await (await get(`/api/coordination/v1/threads/${target}`)).json()
  expect(initialSnapshot.thread.createdBy).toBe("usr_alice")
  expect(initialSnapshot.runs[0]).toMatchObject({
    id: "synthetic-run-wf02-B", state: "running", threadId: target,
  })
  const before = await (await get(`/api/coordination/v1/threads/${target}/events?after=0&limit=200`)).text()
  expect(before).not.toContain("NAV-742")
  expect(before).not.toContain("focus")
  for (const [stage, name] of [[1, "admitted"], [2, "promoted"], [3, "used"]] as const) {
    const response = await post("/api/coordination/v1/simulation/wf02/advance")
    expect(response.status).toBe(200)
    const manifest = await response.json()
    expect(manifest.wf02.stage).toBe(stage)
    expect(manifest.wf02.phase).toBe(name)
    const snapshot = await (await get(`/api/coordination/v1/threads/${target}`)).json()
    assertCard(snapshot.workCard)
    expect(snapshot.runs[0].id).toBe(initialSnapshot.runs[0].id)
    expect(snapshot.workCard.evidenceRefs[0].threadId).toBe(target)
    expect(snapshot.workCard.evidenceRefs[0].seq).toBe(4 + stage)
  }
  expect((await (await post("/api/coordination/v1/simulation/wf02/advance")).json()).wf02.stage).toBe(3)
  const after = await (await get(`/api/coordination/v1/threads/${target}/events?after=0&limit=200`)).text()
  expect(after).toContain("project-switcher-DEMO7")
  const reset = await (await post("/api/coordination/v1/simulation/reset")).json()
  expect(reset.wf02.stage).toBe(0)
  expect((await (await get(`/api/coordination/v1/threads/${target}/events?after=0&limit=200`)).text())).toBe(before)
})

test("WF03 separates tentative overlap from unrelated topics and isolates project reads", async () => {
  const manifest = await (await get("/api/coordination/v1/simulation")).json()
  const comparisons = manifest.scenarios.find((item: any) => item.id === "wf03").comparisons
  expect(comparisons.find((item: any) => item.id === "overlap").classification).toBe("likely_overlap")
  expect(comparisons.find((item: any) => item.id === "unrelated").classification).toBe("none")
  const overlap = await (await get("/api/coordination/v1/threads/wf03-overlap-A/events?after=0&limit=200")).text()
  const unrelated = await (await get("/api/coordination/v1/threads/wf03-unrelated-db/events?after=0&limit=200")).text()
  expect(overlap).toContain("NAV-900")
  expect(unrelated).not.toContain("NAV-900")
  expect(unrelated).toContain("database schema migrations")
  const unrelatedUi = await (await get("/api/coordination/v1/threads/wf03-unrelated-ui/events?after=0&limit=200")).text()
  expect(unrelatedUi).toContain("user interface")
  expect(overlap).not.toContain("database schema migrations")
  expect(unrelated).not.toContain("PRIVATE-DEMO7")
})

test("demo identity and project boundaries fail closed", async () => {
  expect((await fetch(origin + "/api/coordination/v1/projects")).status).toBe(401)
  expect((await get("/api/coordination/v1/projects", "alice", "bad")).status).toBe(401)
  expect((await get("/api/coordination/v1/projects", "__proto__")).status).toBe(401)
  expect((await get("/api/coordination/v1/projects", "bob", "demo-bob:extra")).status).toBe(401)
  const bobProjects = await (await get("/api/coordination/v1/projects", "bob")).json()
  expect(bobProjects.map((project: any) => project.id)).toEqual(["sim-wf01", "sim-wf02"])
  const bobManifest = await (await get("/api/coordination/v1/simulation", "bob")).json()
  expect(bobManifest.scenarios.map((scenario: any) => scenario.projectId)).toEqual(["sim-wf01", "sim-wf02"])
  expect(JSON.stringify(bobManifest)).not.toContain("wf03-overlap")
  const caraManifest = await (await get("/api/coordination/v1/simulation", "cara")).json()
  expect(caraManifest.scenarios).toHaveLength(3)
  const drewManifest = await (await get("/api/coordination/v1/simulation", "drew")).json()
  expect(drewManifest.scenarios).toHaveLength(3)
  expect((await get("/api/coordination/v1/projects/sim-wf03/events?after=0&limit=200", "bob")).status).toBe(404)
  expect((await get("/api/coordination/v1/projects/sim-wf03", "bob")).status).toBe(404)
  expect((await get("/api/coordination/v1/projects/sim-wf03/work-cards", "bob")).status).toBe(404)
  expect((await get("/api/coordination/v1/threads/wf03-overlap-A", "bob")).status).toBe(404)
  expect((await post("/api/coordination/v1/simulation/wf02/advance", {}, "bob")).status).toBe(403)
  const selected = await (await post("/api/coordination/v1/simulation/select", { scenarioId: "wf03" })).json()
  expect(selected.selectedScenarioId).toBe("wf03")
  expect((await (await get("/api/coordination/v1/simulation", "bob")).json()).selectedScenarioId).toBe("wf01")
  await post("/api/coordination/v1/simulation/reset")
  const preflight = await fetch(origin + "/api/coordination/v1/simulation", {
    method: "OPTIONS",
    headers: { Origin: "http://localhost:5173", "Access-Control-Request-Headers": "authorization,content-type" },
  })
  expect(preflight.status).toBe(204)
  expect(preflight.headers.get("access-control-allow-origin")).toBe("*")
})
