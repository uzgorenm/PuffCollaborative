// Fixed, synthetic coordination data. Nothing in this module is real Session output.
const time = "2026-09-29T19:00:00.000Z"
const user = (name: string) => `usr_${name}`

export const actors = [
  { username: "alice", userId: user("alice"), displayName: "Alice", role: "scenario operator" },
  { username: "bob", userId: user("bob"), displayName: "Bob", role: "navigation collaborator" },
  { username: "cara", userId: user("cara"), displayName: "Cara", role: "overlap investigator" },
  { username: "drew", userId: user("drew"), displayName: "Drew", role: "cross-project reviewer" },
]

export const projectMembership: Record<string, string[]> = {
  alice: ["sim-wf01", "sim-wf02", "sim-wf03"],
  bob: ["sim-wf01", "sim-wf02"],
  cara: ["sim-wf01", "sim-wf02", "sim-wf03"],
  drew: ["sim-wf01", "sim-wf02", "sim-wf03"],
}

export const projects = [
  { id: "sim-wf01", name: "SIMULATED · WF01 · Separate alternatives", createdBy: user("alice"), createdAt: time },
  { id: "sim-wf02", name: "SIMULATED · WF02 · Finding reaches B", createdBy: user("alice"), createdAt: time },
  { id: "sim-wf03", name: "SIMULATED · WF03 · Overlap or unrelated", createdBy: user("cara"), createdAt: time },
]

export const sourceRef = { threadId: "wf02-A", eventId: "wf02-A-find", seq: 4 }
export const completedSourceRef = { threadId: "wf03-unrelated-db", eventId: "wf03-db-complete", seq: 8 }
export const completedOutcome = "Mapped migration pages and link destinations; link checks and keyboard access remain untested."
export const targetThreadId = "wf02-B"
export const phases = ["source", "admitted", "promoted", "used"] as const
export const activeBInstruction = {
  id: "synthetic-instruction-wf02-B",
  requestId: "synthetic-request-wf02-B",
  threadId: "wf02-B",
  actorId: "usr_alice",
  text: "SIMULATED: continue the expanded navigation approach with persistent project labels.",
  queueSeq: 1,
  submittedAt: time,
  runId: "synthetic-run-wf02-B",
}
export const activeBRun = {
  id: "synthetic-run-wf02-B",
  threadId: "wf02-B",
  instructionId: activeBInstruction.id,
  state: "running",
  attempt: 1,
  runnerMessageId: "synthetic-runner-message-wf02-B",
  createdAt: time,
  startedAt: time,
}

// This unshared fixture exercises the exclusion boundary. Never return its ID or marker in HTTP JSON.
const privateSession = { id: "session-P", content: "PRIVATE-DEMO7", shared: false }
export function privateFixtureMarkerForTest() {
  return privateSession.content
}

function thread(id: string, projectId: string, title: string, owner: string, activitySeq: number) {
  return {
    id, projectId, sessionId: `ses_sim_${id}`, workerId: `synthetic-worker-${id}`,
    title, createdBy: user(owner), createdAt: time, activitySeq,
  }
}

function event(
  id: string,
  projectId: string,
  threadId: string,
  seq: number,
  kind: "thread.created" | "run.output" | "work-card.updated",
  text: string,
  actor: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id, projectId, threadId, seq, kind, occurredAt: time, actorId: user(actor),
    payload: { ...(kind === "work-card.updated" ? { summary: text } : { text }), simulated: true, ...extra },
  }
}

function card(
  threadId: string,
  projectId: string,
  task: string,
  progress: string,
  sourceActivitySeq: number,
  owner: string,
  evidenceRefs: { threadId: string; eventId: string; seq: number }[] = [],
  status: "active" | "done" = "active",
  recentVerifiedOutcome: string | null = null,
) {
  return {
    id: `card-${threadId}`, projectId, threadId, version: 1, sourceActivitySeq,
    currentTask: task, progress, blockers: [], status,
    recentVerifiedOutcome, contributors: [user(owner)], evidenceRefs,
    generatedAt: time, submittedBy: "SIMULATED fixture", updatedAt: time,
    summaryJobId: `synthetic-summary-${threadId}`,
  }
}

export function buildData(stage: number) {
  const wf01 = "sim-wf01"
  const wf02 = "sim-wf02"
  const wf03 = "sim-wf03"
  const threads = [
    thread("wf01-A", wf01, "A · compact icon-first navigation · alternative", "alice", 3),
    thread("wf01-B", wf01, "B · expanded persistent-label navigation · alternative", "alice", 4),
    thread("wf02-A", wf02, "A · compact navigation · source", "alice", 4),
    thread("wf02-B", wf02, "B · expanded navigation · target", "alice", stage ? 4 + stage : 3),
    thread("wf03-overlap-A", wf03, "NAV-900 investigation A · possible overlap", "cara", 3),
    thread("wf03-overlap-B", wf03, "NAV-900 investigation B · possible overlap", "drew", 5),
    thread("wf03-unrelated-db", wf03, "Map database migration navigation · complete", "cara", 8),
    thread("wf03-unrelated-ui", wf03, "Project UI navigation · unrelated", "drew", 7),
  ]
  const events = [
    event("wf01-A-create", wf01, "wf01-A", 1, "thread.created", "SIMULATED: A started compact navigation.", "alice"),
    event("wf01-B-create", wf01, "wf01-B", 2, "thread.created", "SIMULATED: B started expanded navigation.", "alice"),
    event("wf01-A-plan", wf01, "wf01-A", 3, "run.output", "SIMULATED A plan: explore compact icon-first navigation; keyboard interaction remains ongoing.", "alice"),
    event("wf01-B-plan", wf01, "wf01-B", 4, "run.output", "SIMULATED B plan: explore expanded navigation with persistent labels; keep it separate from A.", "alice"),
    event("wf02-A-create", wf02, "wf02-A", 1, "thread.created", "SIMULATED: A started compact navigation.", "alice"),
    event("wf02-B-create", wf02, "wf02-B", 2, "thread.created", "SIMULATED: B started expanded navigation.", "alice"),
    event("wf02-B-before", wf02, "wf02-B", 3, "run.output", "SIMULATED B prior plan: keep persistent project labels and test the expanded drawer.", "alice"),
    event("wf02-A-find", wf02, "wf02-A", 4, "run.output", "SIMULATED source finding NAV-742, run DEMO7: when switching projects, keyboard focus must return to #project-switcher-DEMO7. Returning focus to the page heading fails this fixture. This does not select a winning design.", "alice", { findingId: "NAV-742", runTag: "DEMO7" }),
    event("wf03-overlap-A-create", wf03, "wf03-overlap-A", 1, "thread.created", "SIMULATED: overlap investigation A created.", "cara"),
    event("wf03-overlap-B-create", wf03, "wf03-overlap-B", 2, "thread.created", "SIMULATED: overlap investigation B created.", "drew"),
    event("wf03-overlap-A-prompt", wf03, "wf03-overlap-A", 3, "run.output", "SIMULATED NAV-900: switching projects clears the search filter. Find the cause and propose a fix.", "cara"),
    event("wf03-overlap-B-prompt", wf03, "wf03-overlap-B", 4, "run.output", "SIMULATED NAV-900: switching projects clears the search filter. Find the cause and propose a fix.", "drew"),
    event("wf03-overlap-review", wf03, "wf03-overlap-B", 5, "work-card.updated", "SIMULATED tentative likely overlap: both investigate NAV-900. Suggest comparing evidence; neither is stopped or merged.", "drew", { classification: "likely_overlap", evidenceRefs: [
      { threadId: "wf03-overlap-A", eventId: "wf03-overlap-A-prompt", seq: 3 },
      { threadId: "wf03-overlap-B", eventId: "wf03-overlap-B-prompt", seq: 4 },
    ] }),
    event("wf03-db-prompt", wf03, "wf03-unrelated-db", 6, "run.output", "SIMULATED: summarize navigation between the project's database schema migrations.", "cara"),
    event("wf03-ui-prompt", wf03, "wf03-unrelated-ui", 7, "run.output", "SIMULATED: summarize navigation between projects in the user interface.", "drew"),
    event("wf03-db-complete", wf03, "wf03-unrelated-db", 8, "run.output", "SIMULATED completed result: mapped database migration pages and link destinations. Remaining work: Check migration links and Test migration keyboard access. These checks have not been done.", "cara", { completion: "simulated_reported" }),
  ]
  const wf02MilestoneEvents = [
    event("wf02-B-admitted", wf02, "wf02-B", 5, "work-card.updated", "SIMULATED admission only: source-linked NAV-742 input is durably staged for B; B has not seen or used it.", "alice", { milestone: "admitted", sourceRef }),
    event("wf02-B-promoted", wf02, "wf02-B", 6, "work-card.updated", "SIMULATED promotion only: the staged NAV-742 input appears at a safe B turn boundary; no use claim yet.", "alice", { milestone: "promoted", sourceRef }),
    event("wf02-B-used", wf02, "wf02-B", 7, "run.output", "SIMULATED B plan change: keep expanded project labels, and add a regression check that project switching restores keyboard focus to #project-switcher-DEMO7 instead of the page heading. Source: A's NAV-742 finding.", "alice", { milestone: "used", sourceRef }),
  ]
  events.push(...wf02MilestoneEvents.slice(0, stage))

  const cards: Record<string, ReturnType<typeof card>> = {
    "wf01-A": card("wf01-A", wf01, "Compact icon-first navigation", "SIMULATED ongoing: exploring compact drawer and keyboard behavior.", 3, "alice", [{ threadId: "wf01-A", eventId: "wf01-A-plan", seq: 3 }]),
    "wf01-B": card("wf01-B", wf01, "Expanded navigation with persistent labels", "SIMULATED ongoing alternative: no winner chosen.", 4, "alice", [{ threadId: "wf01-B", eventId: "wf01-B-plan", seq: 4 }]),
    "wf02-A": card("wf02-A", wf02, "Compact navigation source investigation", "SIMULATED synthetic NAV-742 focus constraint reported; implementation unverified.", 4, "alice", [sourceRef]),
    "wf02-B": card("wf02-B", wf02, "Expanded navigation with persistent labels", [
      "SIMULATED B prior plan: expanded drawer and persistent project labels.",
      "SIMULATED admitted: source-linked input staged. B has not seen or used it.",
      "SIMULATED promoted: context visible at a safe turn boundary. B has not yet used it.",
      "SIMULATED used: B adds the focus-return regression check while keeping expanded labels.",
    ][stage], stage ? 4 + stage : 3, "alice", stage
      ? [{ threadId: "wf02-B", eventId: ["", "wf02-B-admitted", "wf02-B-promoted", "wf02-B-used"][stage], seq: 4 + stage }]
      : [{ threadId: "wf02-B", eventId: "wf02-B-before", seq: 3 }]),
    "wf03-overlap-A": card("wf03-overlap-A", wf03, "Investigate NAV-900 search-filter reset", "SIMULATED ongoing: independent cause investigation.", 3, "cara", [{ threadId: "wf03-overlap-A", eventId: "wf03-overlap-A-prompt", seq: 3 }]),
    "wf03-overlap-B": card("wf03-overlap-B", wf03, "Investigate NAV-900 search-filter reset", "SIMULATED tentative likely overlap; comparison suggested, no stop or merge.", 5, "drew", [
      { threadId: "wf03-overlap-B", eventId: "wf03-overlap-review", seq: 5 },
    ]),
    "wf03-unrelated-db": card("wf03-unrelated-db", wf03, "Map database migration navigation", "SIMULATED reported complete: mapped migration pages and links; checks remain.", 8, "cara", [completedSourceRef], "done", completedOutcome),
    "wf03-unrelated-ui": card("wf03-unrelated-ui", wf03, "Navigate projects in the user interface", "SIMULATED unrelated to database migrations; no shared finding.", 7, "drew"),
  }
  return { threads, events, cards }
}
