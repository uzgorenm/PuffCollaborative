import { afterAll, beforeAll, expect, test } from "bun:test"
import { renderToString } from "solid-js/web"
import { createServer, type ViteDevServer } from "vite"
import solid from "vite-plugin-solid"
import { Coordination } from "@opencode-ai/schema/coordination"
import { buildProjectOverview, relatedWork } from "./overview-model"
import type { ProjectOverviewView } from "./overview-view"

let server: ViteDevServer
let Overview: typeof ProjectOverviewView
beforeAll(async () => {
  server = await createServer({
    configFile: false,
    plugins: [solid({ ssr: true })],
    server: { middlewareMode: true, hmr: { port: 0 } },
    optimizeDeps: { noDiscovery: true },
    appType: "custom",
  })
  Overview = (await server.ssrLoadModule("/src/pages/puff/project-overview/overview-view.tsx")).ProjectOverviewView
})
afterAll(async () => server?.close())

const time = "2026-09-29T18:00:00.000Z"
const projectId = Coordination.ProjectID.make("prj_a")
const userId = Coordination.UserID.make("usr_ada")
const threadId = Coordination.ThreadID.make("thr_a")
const thread = {
  id: threadId,
  projectId,
  sessionId: "ses_a",
  workerId: "wrk_a",
  title: "Navigation experiment",
  createdBy: userId,
  createdAt: time,
  activitySeq: 2,
} as Coordination.Thread
const card = {
  id: Coordination.WorkCardID.make("wc_a"),
  projectId,
  threadId,
  version: 1,
  sourceActivitySeq: 2,
  currentTask: "Fix keyboard focus",
  progress: "Constraint identified",
  blockers: ["Needs review"],
  status: "done",
  recentVerifiedOutcome: "Focus check passed",
  contributors: [userId],
  evidenceRefs: [{ threadId, eventId: "ev_focus", seq: 2 }],
  generatedAt: time,
  submittedBy: "flower",
  updatedAt: time,
  summaryJobId: "job_a",
} as Coordination.WorkCard
const view = buildProjectOverview({
  project: { id: projectId, name: "Puff", createdBy: userId, createdAt: time },
  members: [{ projectId, userId, role: "owner", joinedAt: time }],
  threads: [thread],
  cards: [card],
  snapshots: [{ thread, runs: [], approvals: [] }],
  statedFocus: [{ userId, text: "Reviewing desktop integration", statedAt: time }],
  sessionOwners: [{ threadId, sessionId: thread.sessionId, workerId: thread.workerId, ownerId: userId }],
})
const words: Record<string, string> = {
  title: "Project overview",
  people: "People and agents",
  statedFocus: "Stated focus",
  agentReport: "Agent reported work",
  projectWork: "Project work",
  privateWork: "Your private sessions",
  privateNotice: "Only you can see these here",
  reportedResults: "Reported results",
  inspectSource: "Inspect source",
  relatedWork: "Related work",
  reportedCompletion: "Reported complete",
  noSummary: "No report yet",
  noFocus: "No focus stated",
  details: "More detail",
  blocker: "Blocker",
  workDone: "Reported done",
  executionUnknown: "Agent state unknown",
  current: "Current report",
  stale: "Report out of date",
  noCurrentReport: "No current report",
  lastReported: "Last reported",
  openSession: "Open session",
  openSessionLabel: "Open Navigation experiment",
  ownerLabel: "Agent owned by Ada",
  startedByLabel: "Started by Ada",
  noOwnedSessions: "No agent sessions attributed",
  possibleOverlap: "Possible overlap",
  deliberateAlternative: "Deliberate alternative",
  inspect: "Inspect",
  continue: "Continue",
  reuse: "Reuse",
  separate: "Keep separate",
  unavailable: "Needs a confirmed project decision",
}
const t = (key: string) => words[key] ?? key

test("overview makes person focus, agent report, source and private boundary visible", () => {
  const html = renderToString(() => Overview({
    view,
    privateSessions: [{ id: "private", title: "Private idea", updatedAt: time, href: "/session/private" }],
    related: [],
    t,
    onInspect: () => {},
    onOpenShared: () => {},
  }))
  expect(html).toContain("Project overview")
  expect(html).toContain("Reviewing desktop integration")
  expect(html).toContain("Fix keyboard focus")
  expect(html).toContain("Agent reported work")
  expect(html).toContain("Focus check passed")
  expect(html).toContain("ev_focus")
  expect(html).toContain("Private idea")
  expect(html).toContain("Only you can see these here")
  expect(html).toContain("<time")
  expect(html).toContain("Open session")
  expect(html).toContain("Open Navigation experiment")
})

test("related options remain visible but cannot redirect work without handlers", () => {
  const html = renderToString(() => Overview({
    view,
    privateSessions: [],
    related: relatedWork("navigation", view.sessions, [{ threadId, topic: "navigation", relationship: "alternative" }]),
    t,
    onInspect: () => {},
    onOpenShared: () => {},
  }))
  expect(html).toContain("Deliberate alternative")
  expect(html).toContain("Keep separate")
  expect(html).toContain("disabled")
  expect(html).toContain("Needs a confirmed project decision")
})

test("stale done card does not appear as current work or completion", () => {
  const stale = buildProjectOverview({
    project: view.project,
    members: [{ projectId, userId, role: "owner", joinedAt: time }],
    threads: [{ ...thread, activitySeq: 3 }],
    cards: [card],
    snapshots: [],
    statedFocus: [],
  })
  const html = renderToString(() => Overview({
    view: stale,
    privateSessions: [],
    related: [],
    t,
    onInspect: () => {},
    onOpenShared: () => {},
  }))
  expect(html).toContain("Report out of date")
  expect(html).toContain("No current report")
  expect(html).toContain("Last reported")
  expect(html).not.toContain("Reported done")
})
