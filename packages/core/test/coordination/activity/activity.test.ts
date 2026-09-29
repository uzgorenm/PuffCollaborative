import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Coordination } from "@opencode-ai/schema/coordination"
import { Session } from "@opencode-ai/schema/session"
import { CoordinationActivity } from "@opencode-ai/core/coordination/activity/activity"
import type { WorkCard } from "@opencode-ai/core/coordination/work-card/work-card"

// Queue, runner, membership, card and journal data are fixtures. This tests only the activity read model.
const now = new Date("2026-09-29T20:00:00.000Z")
const at = (minutesBefore: number) => new Date(now.getTime() - minutesBefore * 60_000).toISOString()

function fixture() {
  const projectId = Coordination.ProjectID.make(`prj_${crypto.randomUUID()}`)
  const memberId = Coordination.UserID.make(`usr_${crypto.randomUUID()}`)
  const outsiderId = Coordination.UserID.make(`usr_${crypto.randomUUID()}`)
  const member: Coordination.AuthContext = { kind: "member", userId: memberId }
  const outsider: Coordination.AuthContext = { kind: "member", userId: outsiderId }
  const thread = (name: string, activitySeq: number): Coordination.Thread => ({
    id: Coordination.ThreadID.make(`thr_${name}_${crypto.randomUUID()}`),
    projectId,
    sessionId: Session.ID.make(`ses_${name}_${crypto.randomUUID()}`),
    workerId: Coordination.WorkerID.make("wrk_fixture"),
    title: name,
    createdBy: memberId,
    createdAt: at(200),
    activitySeq,
  })
  const long = thread("long", 3)
  const queued = thread("queued", 1)
  const approval = thread("approval", 2)
  const blocked = thread("blocked", 3)
  const finished = thread("finished", 4)
  const threads = [long, queued, approval, blocked, finished]
  const instruction = (target: Coordination.Thread, name: string): Coordination.InstructionRequest => ({
    id: Coordination.InstructionID.make(`ins_${name}`),
    requestId: `request_${name}`,
    threadId: target.id,
    actorId: memberId,
    text: `Instruction ${name}`,
    queueSeq: 1,
    submittedAt: at(10),
    runId: Coordination.RunID.make(`run_${name}`),
  })
  const run = (
    target: Coordination.Thread,
    name: string,
    state: Coordination.RunState,
    startedAt?: string,
  ): Coordination.Run => ({
    id: Coordination.RunID.make(`run_${name}`),
    threadId: target.id,
    instructionId: Coordination.InstructionID.make(`ins_${name}`),
    state,
    attempt: 1,
    runnerMessageId: `runner_${name}`,
    createdAt: at(130),
    ...(startedAt ? { startedAt } : {}),
    ...(["failed", "completed", "cancelled"].includes(state) ? { endedAt: at(20) } : {}),
  })
  const longRun = run(long, "long", "running", at(125))
  const queuedRun = run(queued, "queued", "queued")
  const approvalRun = run(approval, "approval", "waiting_approval", at(20))
  const failedRun = run(blocked, "blocked", "failed", at(35))
  const finishedRun = run(finished, "finished", "completed", at(125))
  const cards = new Map<Coordination.ThreadID, WorkCard.Detail>([
    [
      approval.id,
      {
        id: Coordination.WorkCardID.make("wc_approval"),
        projectId,
        threadId: approval.id,
        version: 1,
        sourceActivitySeq: approval.activitySeq,
        currentTask: "Review tool use",
        progress: "Awaiting decision",
        blockers: [],
        status: "done",
        updatedAt: at(5),
        summaryJobId: "job_approval",
        recentVerifiedOutcome: "Tool request observed",
        contributors: [memberId],
        evidenceRefs: [],
        generatedAt: at(5),
        submittedBy: "analysis_fixture",
      },
    ],
    [
      blocked.id,
      {
        id: Coordination.WorkCardID.make("wc_blocked"),
        projectId,
        threadId: blocked.id,
        version: 1,
        sourceActivitySeq: blocked.activitySeq,
        currentTask: "Unblock task",
        progress: "Waiting for input",
        blockers: ["Need teammate input"],
        status: "active",
        updatedAt: at(5),
        summaryJobId: "job_blocked",
        recentVerifiedOutcome: "Build failed",
        contributors: [memberId],
        evidenceRefs: [],
        generatedAt: at(5),
        submittedBy: "analysis_fixture",
      },
    ],
  ])
  const events: Coordination.Event[] = [
    { id: "evt_old", projectId, threadId: long.id, seq: 0, kind: "run.started", occurredAt: at(125), payload: {} },
    {
      id: "evt_output_expired",
      projectId,
      threadId: long.id,
      seq: 1,
      kind: "run.output",
      occurredAt: at(61),
      payload: { text: "Old output" },
    },
    {
      id: "evt_approval",
      projectId,
      threadId: approval.id,
      seq: 2,
      kind: "run.approval.requested",
      occurredAt: at(4),
      payload: { message: "Approval requested" },
    },
    {
      id: "evt_output",
      projectId,
      threadId: long.id,
      seq: 3,
      kind: "run.output",
      occurredAt: at(3),
      payload: { text: "x".repeat(8_100) },
    },
    {
      id: "evt_failed",
      projectId,
      threadId: blocked.id,
      seq: 4,
      kind: "run.failed",
      occurredAt: at(2),
      payload: { summary: "Build failed" },
    },
  ]
  let privateReads = 0
  const service = CoordinationActivity.make({
    access: {
      authorize: (principal, requestedProject) =>
        principal.kind === "member" && principal.userId === memberId && requestedProject === projectId
          ? Effect.void
          : Effect.fail({ code: "forbidden", message: "Project membership required" }),
    },
    projects: {
      listThreads: () => {
        privateReads++
        return Effect.succeed(threads)
      },
    },
    queue: {
      instructions: (threadId) => Effect.succeed(threadId === queued.id ? [instruction(queued, "queued")] : []),
      runs: (threadId) =>
        Effect.succeed(
          [longRun, queuedRun, approvalRun, failedRun, finishedRun].filter((item) => item.threadId === threadId),
        ),
    },
    runner: {
      approvals: (threadId) =>
        Effect.succeed(
          threadId === approval.id
            ? [
                {
                  id: "approval_1",
                  threadId,
                  runId: approvalRun.id,
                  toolCallId: "tool_1",
                  version: 1,
                  state: "pending" as const,
                  requestedAt: at(4),
                  deliveryState: "none" as const,
                },
              ]
            : [],
        ),
    },
    cards: { get: (threadId) => Effect.succeed(cards.get(threadId)) },
    events: {
      replayProject: (_projectId, after, limit) => {
        const selected = events.filter((event) => event.seq > after)
        const page = selected.slice(0, limit)
        return Effect.succeed({ events: page, cursor: page.at(-1)?.seq ?? after, hasMore: selected.length > limit })
      },
    },
  })
  return {
    service,
    projectId,
    member,
    outsider,
    long,
    queued,
    approval,
    blocked,
    cards,
    privateReads: () => privateReads,
  }
}

describe("activity read model with fixture state", () => {
  test("keeps long-running and approval work visible while queued work stays up next", async () => {
    const f = fixture()
    const view = await Effect.runPromise(f.service.read(f.member, f.projectId, now))
    expect(view.workingNow.map((item) => item.sourceThread.threadId)).toEqual([f.long.id, f.approval.id, f.blocked.id])
    expect(view.workingNow.find((item) => item.sourceThread.threadId === f.long.id)).toMatchObject({
      status: "running",
      freshness: null,
    })
    expect(view.workingNow.find((item) => item.sourceThread.threadId === f.approval.id)).toMatchObject({
      status: "waiting_approval",
      approvalId: "approval_1",
    })
    expect(view.workingNow.find((item) => item.sourceThread.threadId === f.blocked.id)).toMatchObject({
      status: "failed",
      blockers: ["Need teammate input"],
    })
    expect(view.upNext.map((item) => item.sourceThread.threadId)).toEqual([f.queued.id])
    expect(view.upNext[0]).toMatchObject({ status: "queued", text: "Instruction queued" })
    expect(view.recent.map((item) => item.id)).toEqual(["evt_failed", "evt_output", "evt_approval"])
    expect(view.recent[0]?.sourceThread?.href).toContain(f.blocked.id)
    expect(view.recent[1]).toMatchObject({ kind: "run.output", sourceThread: { threadId: f.long.id } })
    expect(view.recent[1]?.outcome).toBe("x".repeat(8_000))
    expect(view.workingNow.filter((item) => item.contributors.includes(f.member.userId))).toHaveLength(2)
    expect(new Set(view.workingNow.map((item) => item.id)).size).toBe(view.workingNow.length)
  })

  test("checks membership before reading private project state", async () => {
    const f = fixture()
    const failure = await Effect.runPromise(f.service.read(f.outsider, f.projectId, now).pipe(Effect.flip))
    expect(failure.code).toBe("forbidden")
    expect(f.privateReads()).toBe(0)
  })

  test("marks old prose stale without changing execution state or showing an old blocker", async () => {
    const f = fixture()
    f.cards.set(f.approval.id, { ...f.cards.get(f.approval.id)!, sourceActivitySeq: 1, blockers: ["Old blocker"] })
    f.cards.set(f.blocked.id, { ...f.cards.get(f.blocked.id)!, sourceActivitySeq: 2 })
    const view = await Effect.runPromise(f.service.read(f.member, f.projectId, now))
    expect(view.workingNow.find((item) => item.sourceThread.threadId === f.approval.id)).toMatchObject({
      status: "waiting_approval",
      blockers: [],
      freshness: { stale: true, sourceActivitySeq: 1, threadActivitySeq: 2 },
    })
    expect(view.workingNow.some((item) => item.sourceThread.threadId === f.blocked.id)).toBe(false)
  })
})
