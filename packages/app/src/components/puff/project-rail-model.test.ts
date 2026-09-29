import { expect, test } from "bun:test"
import { Coordination } from "@opencode-ai/schema/coordination"
import { projectRail } from "./project-rail-model"

const time = "2026-09-29T19:00:00Z"
const userId = Coordination.UserID.make("usr_alice")
const project = { id: Coordination.ProjectID.make("sim-wf02"), name: "Demo", createdBy: userId, createdAt: time } as Coordination.SharedProject
const member = { projectId: project.id, userId, role: "owner", joinedAt: time } as Coordination.Membership
const thread = {
  id: Coordination.ThreadID.make("wf02-B"), projectId: project.id, sessionId: "ses_B", workerId: "worker_B",
  title: "Expanded navigation", createdBy: userId, createdAt: time, activitySeq: 3,
} as Coordination.Thread
const card = {
  id: Coordination.WorkCardID.make("card_B"), projectId: project.id, threadId: thread.id, version: 1, sourceActivitySeq: 3,
  currentTask: "Expanded navigation", progress: "Reviewing the project switch behavior in detail without losing the keyboard focus requirement.",
  blockers: [], status: "active", recentVerifiedOutcome: null, contributors: [userId], evidenceRefs: [],
  generatedAt: time, submittedBy: "SIMULATED fixture", updatedAt: time, summaryJobId: "job_B",
} as Coordination.WorkCard
const run = {
  id: "run_B", threadId: thread.id, instructionId: "instruction_B", state: "running", attempt: 1,
  runnerMessageId: "message_B", createdAt: time, startedAt: time,
} as Coordination.Run
const overview = { project, members: [member], cards: [card], snapshots: [{ thread, runs: [run] }] }
const base = { projectId: project.id, threads: [thread], overview, missing: "No report", stale: "Last report is out of date",
  loading: "Loading work report", loadingReport: false, t: (key: string) => key }

test("the project rail uses a current source-backed progress sentence and exact run state", () => {
  const read = projectRail(base)
  expect(read.members.map((item) => item.userId)).toEqual([userId])
  expect(read.rows[0]?.summary).toBe(card.progress)
  expect(read.rows[0]?.runState).toBe("running")
  expect(read.rows[0]?.creatorIsMember).toBe(true)
})

test("stale work and mismatched snapshots do not claim current progress or run state", () => {
  const read = projectRail({ ...base, threads: [{ ...thread, activitySeq: 4 }] })
  expect(read.rows[0]?.summary).toBe("Last report is out of date")
  expect(read.rows[0]?.runState).toBeUndefined()
})

test("an active run stays visible when a newer run has finished", () => {
  const finished = { ...run, id: Coordination.RunID.make("run_finished"), state: "completed" as const,
    createdAt: "2026-09-29T20:00:00Z" }
  const read = projectRail({ ...base, overview: { ...overview, snapshots: [{ thread, runs: [run, finished] }] } })
  expect(read.rows[0]?.runState).toBe("running")
})

test("synthetic concise copy is limited to the selected scenario and a fresh card", () => {
  const simulation = { scenarios: [{ id: "wf02", projectId: project.id }] } as unknown as Parameters<typeof projectRail>[0]["simulation"]
  expect(projectRail({ ...base, simulation }).rows[0]?.summary).toBe("puff.simulation.rail.wf02BSource")
  expect(projectRail({ ...base, simulation, threads: [{ ...thread, activitySeq: 4 }] }).rows[0]?.summary)
    .toBe("Last report is out of date")
  expect(projectRail({ ...base, simulation, projectId: "other" }).rows).toEqual([])
})
