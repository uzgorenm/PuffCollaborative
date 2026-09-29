import { expect, test } from "bun:test"
import { Coordination } from "@opencode-ai/schema/coordination"
import { buildProjectOverview, relatedWork } from "./overview-model"

const at = "2026-09-29T18:00:00.000Z"
const project = { id: "prj_a", name: "Puff", createdBy: "usr_ada", createdAt: at } as Coordination.SharedProject
const members = [
  { projectId: project.id, userId: "usr_ada", role: "owner", joinedAt: at },
  { projectId: project.id, userId: "usr_ben", role: "member", joinedAt: at },
] as Coordination.Membership[]
const thread = (id: string, createdBy = "usr_ada", activitySeq = 4) =>
  ({
    id: `thr_${id}`,
    projectId: project.id,
    sessionId: `ses_${id}`,
    workerId: `wrk_${id}`,
    title: `Session ${id}`,
    createdBy,
    createdAt: at,
    activitySeq,
  }) as Coordination.Thread
const card = (id: string, status: Coordination.WorkCard["status"] = "active") =>
  ({
    id: Coordination.WorkCardID.make(`wc_${id}`),
    projectId: project.id,
    threadId: Coordination.ThreadID.make(`thr_${id}`),
    version: 1,
    sourceActivitySeq: 4,
    currentTask: `${id} navigation`,
    progress: "Checking focus",
    blockers: [],
    status,
    recentVerifiedOutcome: null,
    contributors: [Coordination.UserID.make("usr_ada")],
    evidenceRefs: [{ threadId: Coordination.ThreadID.make(`thr_${id}`), eventId: `ev_${id}`, seq: 4 }],
    generatedAt: at,
    submittedBy: "flower",
    updatedAt: at,
    summaryJobId: `job_${id}`,
  }) as Coordination.WorkCard

test("overview separates owner-stated focus from agent reports for the same person", () => {
  const view = buildProjectOverview({
    project,
    members,
    threads: [thread("a"), thread("b"), thread("c", "usr_ben")],
    cards: [card("a"), card("b"), card("c")],
    snapshots: [],
    statedFocus: [{ userId: "usr_ada", text: "Reviewing the integration", statedAt: at }],
    sessionOwners: [
      { threadId: "thr_a", sessionId: "ses_a", workerId: "wrk_a", ownerId: "usr_ada" },
      { threadId: "thr_b", sessionId: "ses_b", workerId: "wrk_b", ownerId: "usr_ada" },
      { threadId: "thr_c", sessionId: "ses_c", workerId: "wrk_c", ownerId: "usr_ben" },
    ],
  })
  expect(view.people[0]?.statedFocus?.text).toBe("Reviewing the integration")
  expect(view.people[0]?.agentReports.map((row) => row.card?.currentTask)).toEqual(["a navigation", "b navigation"])
  expect(view.people[1]?.statedFocus).toBeUndefined()
  expect(view.people[1]?.agentReports[0]?.card?.currentTask).toBe("c navigation")
})

test("a thread creator is not treated as its agent owner without a trusted binding", () => {
  const view = buildProjectOverview({
    project,
    members,
    threads: [thread("a")],
    cards: [card("a")],
    snapshots: [],
    statedFocus: [],
    sessionOwners: [],
  })
  expect(view.people[0]?.agentReports).toEqual([])
  expect(String(view.sessions[0]?.thread.createdBy)).toBe("usr_ada")
})

test("overview does not promote a stale or unsupported card into a current verified result", () => {
  const stale = { ...card("a", "done"), recentVerifiedOutcome: "Restored focus" }
  const unsupported = { ...card("b", "done"), recentVerifiedOutcome: "Ship it", evidenceRefs: [
    { threadId: "thr_secret" as Coordination.ThreadID, eventId: "ev_secret", seq: 4 },
  ] }
  const view = buildProjectOverview({
    project,
    members,
    threads: [thread("a", "usr_ada", 5), thread("b")],
    cards: [stale, unsupported],
    snapshots: [],
    statedFocus: [],
  })
  expect(view.sessions.map((row) => row.freshness)).toEqual(["stale", "current"])
  expect(view.reportedResults).toEqual([])
})

test("a card from a future activity sequence remains stale", () => {
  const view = buildProjectOverview({
    project,
    members,
    threads: [thread("a", "usr_ada", 4)],
    cards: [{ ...card("a"), sourceActivitySeq: 5, recentVerifiedOutcome: "Claim" }],
    snapshots: [],
    statedFocus: [],
  })
  expect(view.sessions[0]?.freshness).toBe("stale")
  expect(view.reportedResults).toEqual([])
})

test("overview joins only authorized exact project and thread records", () => {
  const alienCard = { ...card("a"), projectId: "prj_other" as Coordination.ProjectID }
  const view = buildProjectOverview({
    project,
    members,
    threads: [thread("a"), { ...thread("secret"), projectId: "prj_other" as Coordination.ProjectID }],
    cards: [alienCard],
    snapshots: [],
    statedFocus: [{ userId: "usr_stranger" as Coordination.UserID, text: "Private", statedAt: at }],
  })
  expect(view.sessions.map((row) => String(row.thread.id))).toEqual(["thr_a"])
  expect(view.sessions[0]?.card).toBeUndefined()
  expect(view.people.map((person) => person.userId)).toEqual(["usr_ada", "usr_ben"])
})

test("overview distinguishes tool permission from a redirection decision", () => {
  const view = buildProjectOverview({
    project,
    members,
    threads: [thread("a")],
    cards: [card("a")],
    statedFocus: [],
    snapshots: [{
      thread: thread("a"),
      runs: [{ id: Coordination.RunID.make("run_a"), state: "waiting_approval", createdAt: at }],
      approvals: [{ id: "ap_a", threadId: Coordination.ThreadID.make("thr_a"), state: "pending", requestedAt: at, deliveryState: "none" }],
    }],
  })
  expect(view.attention).toEqual([{ kind: "tool-permission", threadId: "thr_a", approvalId: "ap_a" }])
  expect(view.sessions[0]?.execution).toBe("waiting_approval")
})

test("an active run remains visible when a newer instruction is queued", () => {
  const view = buildProjectOverview({
    project,
    members,
    threads: [thread("a")],
    cards: [card("a")],
    statedFocus: [],
    snapshots: [{
      thread: thread("a"),
      runs: [
        { id: Coordination.RunID.make("run_running"), state: "running", createdAt: at },
        { id: Coordination.RunID.make("run_queued"), state: "queued", createdAt: "2026-09-29T18:01:00Z" },
      ],
      approvals: [],
    }],
  })
  expect(view.sessions[0]?.execution).toBe("running")
})

test("related work requires an explicit matching topic and keeps alternatives separate", () => {
  const completed = { ...card("b", "done"), recentVerifiedOutcome: "Focus check completed" }
  const view = buildProjectOverview({
    project,
    members,
    threads: [thread("a"), thread("b"), thread("c")],
    cards: [card("a", "active"), completed, card("c", "done")],
    snapshots: [],
    statedFocus: [],
  })
  const matches = relatedWork("project-navigation", view.sessions, [
    { threadId: "thr_a", topic: "project-navigation", relationship: "alternative" },
    { threadId: "thr_b", topic: "project-navigation", relationship: "unspecified" },
    { threadId: "thr_c", topic: "database-migrations", relationship: "unspecified" },
  ])
  expect(matches.map((match) => [String(match.thread.id), match.kind])).toEqual([
    ["thr_a", "deliberate-alternative"],
    ["thr_b", "reported-completion"],
  ])
  expect(relatedWork("project-navigation", view.sessions, [])).toEqual([])
})

test("a done label without an inspectable outcome is only possible related work", () => {
  const view = buildProjectOverview({
    project,
    members,
    threads: [thread("a")],
    cards: [card("a", "done")],
    snapshots: [],
    statedFocus: [],
  })
  expect(relatedWork("project-navigation", view.sessions, [
    { threadId: "thr_a", topic: "project-navigation", relationship: "unspecified" },
  ])[0]?.kind).toBe("possible-overlap")
})
