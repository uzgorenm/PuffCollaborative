import { beforeAll, expect, mock, test } from "bun:test"
import { MemoryRouter, Route, createMemoryHistory } from "@solidjs/router"
import { createComponent, render } from "solid-js/web"
import { createStore } from "solid-js/store"
import solidPlugin from "vite-plugin-solid"
import type { ProjectTransport } from "@/pages/puff/project-api"
import { createTeamController } from "@/pages/puff/team-state"
import type { SimulationManifest } from "@/pages/puff/project-overview/simulation-contract"

const at = "2026-09-29T20:00:00Z"
const project = { id: "prj_overview_focus", name: "Focus project", createdBy: "alice", createdAt: at }
const member = { projectId: project.id, userId: "alice", role: "owner", joinedAt: at }
const thread = () => ({
  id: "thread-a", projectId: project.id, sessionId: "session-a", workerId: "worker-a",
  title: "Unchanged session", createdBy: "alice", createdAt: at, activitySeq: 1,
})
const card = () => ({
  id: "card-a", projectId: project.id, threadId: "thread-a", version: 1, sourceActivitySeq: 1,
  currentTask: "Check focus", progress: "Reading evidence", blockers: [], status: "active",
  recentVerifiedOutcome: "Finding available", contributors: ["alice"],
  evidenceRefs: [{ threadId: "thread-a", eventId: "event-a", seq: 1 }],
  generatedAt: at, submittedBy: "alice", updatedAt: at, summaryJobId: "job-a",
})
const cited = () => ({
  id: "event-a", projectId: project.id, threadId: "thread-a", seq: 1,
  kind: "run.output", occurredAt: at, payload: { text: "Source finding" },
})

// Each read returns new objects with unchanged content, like the scheduled poll.
const transport: ProjectTransport = async (url) => {
  const request = new URL(url)
  const path = request.pathname.replace("/api/coordination/v1", "") + request.search
  if (path === "/projects") return Response.json([project])
  if (path === "/simulation") return new Response(null, { status: 404 })
  if (path === `/projects/${project.id}`) return Response.json({ project, members: [member] })
  if (path === `/projects/${project.id}/threads`) return Response.json([thread()])
  if (path === `/projects/${project.id}/work-cards`) return Response.json([card()])
  if (path === "/threads/thread-a")
    return Response.json({ thread: thread(), instructions: [], runs: [], approvals: [], workCard: card(), cursor: 1 })
  if (path === `/projects/${project.id}/events?after=0&limit=1`)
    return Response.json({ events: [cited()], cursor: 1, hasMore: false })
  throw new Error(`Unexpected isolated overview request: ${path}`)
}

let ProjectHome: typeof import("@/pages/puff/project-overview/project-home").ProjectHome
let SimulationGuide: typeof import("@/pages/puff/project-overview/simulation-guide").SimulationGuide
let activeTeam: ReturnType<typeof createTeamController>

beforeAll(async () => {
  // Bun's browser suite needs the app's Solid JSX transform for these TSX modules.
  const transform = solidPlugin({ hot: false }).transform as (
    source: string,
    path: string,
    options: { ssr: boolean },
  ) => Promise<{ code: string } | null>
  Bun.plugin({
    name: "solid-overview-focus-test",
    setup(builder) {
      builder.onLoad({ filter: /\.[jt]sx$/ }, async (args) => {
        const result = await transform(await Bun.file(args.path).text(), args.path, { ssr: false })
        if (!result) throw new Error(`Solid JSX transform skipped ${args.path}`)
        return { contents: result.code, loader: "tsx" }
      })
    },
  })
  mock.module("@/context/language", () => ({ useLanguage: () => ({ t: (key: string) => key }) }))
  mock.module("@/context/global", () => ({ useGlobal: () => ({ servers: { list: () => [] } }) }))
  mock.module("@/context/tabs", () => ({ useTabs: () => ({}) }))
  mock.module("@opencode-ai/ui/context/dialog", () => ({ useDialog: () => ({ show: () => undefined }) }))
  mock.module("@/components/puff/team-shell", () => ({ TeamConnection: () => null }))
  mock.module("@/pages/puff/team-context", () => ({ useTeam: () => activeTeam }))
  ProjectHome = (await import("@/pages/puff/project-overview/project-home")).ProjectHome
  SimulationGuide = (await import("@/pages/puff/project-overview/simulation-guide")).SimulationGuide
})

async function settle() {
  for (let index = 0; index < 50; index++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function mountOverview() {
  const host = document.createElement("div")
  document.body.append(host)
  const history = createMemoryHistory()
  history.set({ value: "/puff", replace: true, scroll: false })
  const team = (activeTeam = createTeamController(transport))
  const dispose = render(
    () => createComponent(MemoryRouter, {
      history,
      get children() { return createComponent(Route, { path: "/puff", component: ProjectHome }) },
    }),
    host,
  )
  if (!(await team.connect("https://overview-focus.example", "alice", "synthetic-only")))
    throw new Error("Isolated overview fixture did not connect")
  await team.refreshOverview()
  await settle()
  if (!host.querySelector(".puff-overview-work-card .puff-overview-source"))
    throw new Error("Overview did not render its source control")
  return { host, team, cleanup: () => { dispose(); team.dispose(); host.remove() } }
}

// Smallest fix for unchanged polls: retain state.overview when the fetched
// project/members/threads/cards/snapshots are content-equal; update freshness
// separately so the derived session and citation rows keep their DOM identity.
test("an unchanged overview refresh preserves the focused Inspect button", async () => {
  const view = await mountOverview()
  try {
    const details = view.host.querySelector<HTMLDetailsElement>(".puff-overview-work-card details")!
    details.open = true
    const inspect = details.querySelector<HTMLButtonElement>(".puff-overview-source")!
    inspect.focus()
    expect(document.activeElement === inspect).toBe(true)

    await view.team.refreshOverview()
    await settle()

    expect(view.host.querySelector(".puff-overview-work-card .puff-overview-source") === inspect).toBe(true)
    expect(inspect.isConnected).toBe(true)
    expect(document.activeElement === inspect).toBe(true)
  } finally {
    view.cleanup()
  }
})

test("an unchanged overview refresh keeps the peek trigger for Escape focus return", async () => {
  const view = await mountOverview()
  try {
    const details = view.host.querySelector<HTMLDetailsElement>(".puff-overview-work-card details")!
    details.open = true
    const inspect = details.querySelector<HTMLButtonElement>(".puff-overview-source")!
    inspect.focus()
    inspect.click()
    await settle()
    const close = view.host.querySelector<HTMLButtonElement>(".puff-overview-peek button")!
    if (!close) throw new Error("Inspect did not open the overview source peek")
    expect(document.activeElement === close).toBe(true)
    expect(view.host.querySelector(".puff-overview-peek")?.textContent).toContain("event-a")

    await view.team.refreshOverview()
    await settle()
    const sameInspect = view.host.querySelector(".puff-overview-work-card .puff-overview-source") === inspect
    const sameClose = view.host.querySelector(".puff-overview-peek button") === close
    const closeHeldFocus = document.activeElement === close
    close.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))

    expect({
      sameInspect,
      sameClose,
      closeHeldFocus,
      peekClosed: view.host.querySelector(".puff-overview-peek") === null,
      returnedToExactInspect: document.activeElement === inspect && inspect.isConnected,
    }).toEqual({
      sameInspect: true,
      sameClose: true,
      closeHeldFocus: true,
      peekClosed: true,
      returnedToExactInspect: true,
    })
  } finally {
    view.cleanup()
  }
})

test("simulated guide switches three scenarios and reveals only observed WF02 receipts", async () => {
  const manifest = {
    simulated: true, mode: "synthetic", label: "SIMULATED", selectedScenarioId: "wf01",
    scenarios: [
      { id: "wf01", projectId: "sim-wf01", title: "Alternatives", classification: "alternative", summary: "Separate A and B", threadIds: ["A", "B"], privateSessionExcluded: true },
      { id: "wf02", projectId: "sim-wf02", title: "Finding to use", classification: "source_linked_awareness", summary: "A informs B", threadIds: ["A", "B"] },
      { id: "wf03", projectId: "sim-wf03", title: "Compare investigations", classification: "mixed", summary: "Tentative comparison", threadIds: ["C", "D"], comparisons: [
        { id: "overlap", classification: "likely_overlap", threadIds: ["C", "D"], finding: "Tentative NAV-900 overlap" },
        { id: "unrelated", classification: "none", threadIds: ["E", "F"], finding: null },
      ] },
    ],
    actors: [],
    wf02: { stage: 0, phase: "source", sourceRef: { threadId: "A", eventId: "A-find", seq: 4 }, targetThreadId: "B",
      milestones: ["source", "admitted", "promoted", "used"].map((phase, index) => ({
        phase, state: index === 0 ? "simulated_current" : "simulated_future",
        receiptId: `receipt-${phase}`, observedAt: index === 0 ? at : null,
        sourceRef: { threadId: "A", eventId: "A-find", seq: 4 }, targetThreadId: "B",
      })) },
  } as SimulationManifest
  const [state, set] = createStore({ projectId: "sim-wf01", manifest })
  const inspected: string[] = []
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(() => createComponent(SimulationGuide, {
    get manifest() { return state.manifest },
    get projectId() { return state.projectId },
    busy: false, error: false, operator: true,
    onSelect: (projectId) => set("projectId", projectId),
    onAdvance: () => {
      set("manifest", "wf02", "stage", 1)
      set("manifest", "wf02", "phase", "admitted")
      set("manifest", "wf02", "milestones", 1, "observedAt", at)
    },
    onReset: () => set("projectId", "sim-wf01"),
    onInspect: (ref) => inspected.push(ref.eventId),
    onOpenTarget: () => {},
  }), host)
  const click = (text: string) => {
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent?.includes(text))
    if (!button) throw new Error(`Missing guide button ${text}`)
    button.click()
  }
  try {
    expect(host.textContent).toContain("Separate A and B")
    click("puff.simulation.wf02")
    await settle()
    expect(host.textContent).toContain("Finding to use")
    expect(host.textContent).toContain("receipt-source")
    expect(host.textContent).not.toContain("receipt-admitted")
    click("puff.simulation.inspectSource")
    expect(inspected).toEqual(["A-find"])
    click("puff.simulation.advance")
    await settle()
    expect(host.textContent).toContain("receipt-admitted")
    expect(host.textContent).not.toContain("receipt-promoted")
    click("puff.simulation.wf03")
    await settle()
    expect(host.textContent).toContain("Tentative NAV-900 overlap")
    expect(host.textContent).toContain("puff.simulation.noFinding")
  } finally {
    dispose()
    host.remove()
  }
})
