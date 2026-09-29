import { describe, expect } from "bun:test"
import { Effect, Exit } from "effect"
import { Coordination } from "@opencode-ai/schema/coordination"
import { Session } from "@opencode-ai/schema/session"
import { Database } from "@opencode-ai/core/database/database"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import { EventV2 } from "@opencode-ai/core/event"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CoordinationEvents } from "@opencode-ai/core/coordination/events/events"
import { WorkCard } from "@opencode-ai/core/coordination/work-card/work-card"
import migration from "@opencode-ai/core/database/migration/20260929190020_coordination_work_card"
import type { CoordinationContracts } from "@opencode-ai/core/coordination/contracts"
import { testEffect } from "../../lib/effect"

// SQLite and the durable event journal are real. Access and project membership are fixtures at this service boundary.
const threadProjects = new Map<string, Coordination.ProjectID>()
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, CoordinationEvents.node]), [
    [
      CoordinationEvents.node,
      CoordinationEvents.layerWith({
        resolveThreadProject: (threadId) => {
          const projectId = threadProjects.get(threadId)
          return projectId
            ? Effect.succeed(projectId)
            : Effect.fail({ code: "forbidden" as const, message: "Thread is outside the fixture" })
        },
      }),
    ],
  ]),
)

const fixture = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* DatabaseMigration.applyOnly(db, [migration])
  const events = yield* CoordinationEvents.Service
  const projectId = Coordination.ProjectID.make(`prj_${crypto.randomUUID()}`)
  const threadId = Coordination.ThreadID.make(`thr_${crypto.randomUUID()}`)
  const userId = Coordination.UserID.make(`usr_${crypto.randomUUID()}`)
  const outsiderId = Coordination.UserID.make(`usr_${crypto.randomUUID()}`)
  const analysis: Coordination.AuthContext = { kind: "analysis", serviceId: `analysis_${projectId}` }
  const member: Coordination.AuthContext = { kind: "member", userId }
  const outsider: Coordination.AuthContext = { kind: "member", userId: outsiderId }
  let thread: Coordination.Thread = {
    id: threadId,
    projectId,
    sessionId: Session.ID.make(`ses_${crypto.randomUUID()}`),
    workerId: Coordination.WorkerID.make(`wrk_${crypto.randomUUID()}`),
    title: "Fixture thread",
    createdBy: userId,
    createdAt: new Date().toISOString(),
    activitySeq: -1,
  }
  threadProjects.set(threadId, projectId)

  const authorized = (principal: Coordination.AuthContext) =>
    (principal.kind === "analysis" && principal.serviceId === analysis.serviceId) ||
    (principal.kind === "member" && principal.userId === userId)
  const access: WorkCard.Dependencies["access"] = {
    authorize: (principal, requestedProject) =>
      authorized(principal) && requestedProject === projectId
        ? Effect.void
        : Effect.fail({ code: "forbidden", message: "Outside fixture project" }),
    getThread: (principal, requestedThread) =>
      authorized(principal) && requestedThread === threadId
        ? Effect.succeed(thread)
        : Effect.fail({ code: "forbidden", message: "Outside fixture thread" }),
  }
  const projectMembers: WorkCard.Dependencies["projectMembers"] = (requestedProject) =>
    requestedProject === projectId
      ? Effect.succeed([userId])
      : Effect.fail({ code: "forbidden", message: "Outside fixture project" })
  const cards = yield* WorkCard.make({ access, projectMembers, events })
  const source = (kind: Coordination.EventKind = "run.tool") =>
    events.append(
      {
        projectId,
        threadId,
        kind,
        occurredAt: new Date().toISOString(),
        payload: { summary: "Verified fixture output" },
      },
      (seq) =>
        Effect.sync(() => {
          thread = { ...thread, activitySeq: seq }
        }),
    )
  const card = (event: Coordination.Event): WorkCard.SubmittedCard => ({
    currentTask: "Build coordination service",
    progress: "Persist work card",
    blockers: [],
    status: "active",
    summaryJobId: "job_1",
    recentVerifiedOutcome: "Focused checks passed",
    contributors: [userId],
    evidenceRefs: [{ threadId, eventId: event.id, seq: event.seq }],
    generatedAt: new Date().toISOString(),
  })
  return { db, events, cards, projectId, threadId, userId, analysis, member, outsider, source, card }
})

describe("work-card persistence with real SQLite and event journal", () => {
  it.effect("rejects stale analysis and accepts an exact retry without another event", () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const first = yield* f.source()
      const submitted = f.card(first)
      const input = {
        principal: f.analysis,
        threadId: f.threadId,
        expectedVersion: 0,
        sourceActivitySeq: first.seq,
        card: submitted,
      }
      const accepted = yield* f.cards.update(input)
      expect(accepted).toMatchObject({
        version: 1,
        sourceActivitySeq: first.seq,
        recentVerifiedOutcome: "Focused checks passed",
      })

      const reordered: WorkCard.SubmittedCard = {
        generatedAt: submitted.generatedAt,
        evidenceRefs: submitted.evidenceRefs,
        contributors: submitted.contributors,
        recentVerifiedOutcome: submitted.recentVerifiedOutcome,
        summaryJobId: submitted.summaryJobId,
        status: submitted.status,
        blockers: submitted.blockers,
        progress: submitted.progress,
        currentTask: submitted.currentTask,
      }
      expect(yield* f.cards.update({ ...input, card: reordered })).toEqual(accepted)
      expect((yield* f.events.replayProject(f.projectId, -1, 20)).events).toHaveLength(2)

      const newerSource = yield* f.source()
      const newer = yield* f.cards.update({
        ...input,
        expectedVersion: 1,
        sourceActivitySeq: newerSource.seq,
        card: { ...f.card(newerSource), progress: "Verified newer step" },
      })
      expect(newer.version).toBe(2)
      expect((yield* f.cards.update(input).pipe(Effect.flip)).code).toBe("conflict")
      expect((yield* f.cards.update({ ...input, expectedVersion: 2 }).pipe(Effect.flip)).code).toBe("conflict")
      expect((yield* f.cards.get(f.threadId))?.progress).toBe("Verified newer step")
      expect((yield* f.events.replayProject(f.projectId, -1, 20)).events).toHaveLength(4)
    }),
  )

  it.effect("checks service scope, contributors and supporting event references", () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const source = yield* f.source()
      const input = {
        principal: f.analysis,
        threadId: f.threadId,
        expectedVersion: 0,
        sourceActivitySeq: source.seq,
        card: f.card(source),
      }
      expect((yield* f.cards.update({ ...input, principal: f.member }).pipe(Effect.flip)).code).toBe("forbidden")
      expect(
        (yield* f.cards.update({ ...input, principal: { kind: "analysis", serviceId: "other" } }).pipe(Effect.flip))
          .code,
      ).toBe("forbidden")
      expect(
        (yield* f.cards
          .update({ ...input, card: { ...input.card, contributors: [f.outsider.userId] } })
          .pipe(Effect.flip)).code,
      ).toBe("invalid")
      expect(
        (yield* f.cards
          .update({
            ...input,
            card: { ...input.card, evidenceRefs: [{ threadId: f.threadId, eventId: "evt_wrong", seq: source.seq }] },
          })
          .pipe(Effect.flip)).code,
      ).toBe("invalid")
      expect(
        (yield* f.cards
          .update({
            ...input,
            card: {
              ...input.card,
              evidenceRefs: [
                { threadId: Coordination.ThreadID.make("thr_other"), eventId: source.id, seq: source.seq },
              ],
            },
          })
          .pipe(Effect.flip)).code,
      ).toBe("invalid")
      expect((yield* f.cards.read(f.outsider, f.threadId).pipe(Effect.flip)).code).toBe("forbidden")
      expect((yield* f.cards.list(f.outsider, f.projectId).pipe(Effect.flip)).code).toBe("forbidden")
      expect(yield* f.cards.get(f.threadId)).toBeUndefined()
    }),
  )

  it.effect("rolls back the event when the card projection cannot commit", () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const source = yield* f.source()
      const trigger = `coordination_work_card_abort_${crypto.randomUUID().replaceAll("-", "")}`
      yield* f.db.run(
        `CREATE TRIGGER ${trigger} BEFORE INSERT ON coordination_work_card WHEN NEW.thread_id = '${f.threadId}' BEGIN SELECT RAISE(ABORT, 'fixture write rejected'); END`,
      )
      const exit = yield* f.cards
        .update({
          principal: f.analysis,
          threadId: f.threadId,
          expectedVersion: 0,
          sourceActivitySeq: source.seq,
          card: f.card(source),
        })
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(yield* f.cards.get(f.threadId)).toBeUndefined()
      expect((yield* f.events.replayProject(f.projectId, -1, 20)).events).toHaveLength(1)
    }),
  )
})
