export * as CoordinationActivity from "./activity"

import { Context, Effect, Layer } from "effect"
import { Coordination } from "@opencode-ai/schema/coordination"
import type { CoordinationContracts } from "../contracts"
import type { WorkCard } from "../work-card/work-card"

export interface SourceThread {
  readonly threadId: Coordination.ThreadID
  readonly sessionId: Coordination.Thread["sessionId"]
  readonly href: string
}

export interface Freshness {
  readonly sourceActivitySeq: number
  readonly threadActivitySeq: number
  readonly stale: boolean
  readonly generatedAt: string
  readonly updatedAt: string
  readonly summaryJobId: string
}

export interface Working {
  readonly id: string
  readonly sourceThread: SourceThread
  readonly runId: Coordination.RunID | null
  readonly status: Coordination.RunState | "idle"
  readonly startedAt: string | null
  readonly approvalId: string | null
  readonly objective: string | null
  readonly step: string | null
  readonly blockers: ReadonlyArray<string>
  readonly recentVerifiedOutcome: string | null
  readonly contributors: ReadonlyArray<Coordination.UserID>
  readonly freshness: Freshness | null
}

export interface UpNext {
  readonly id: Coordination.InstructionID
  readonly sourceThread: SourceThread
  readonly status: "queued"
  readonly queueSeq: number
  readonly submittedAt: string
  readonly actorId: Coordination.UserID
  readonly text: string
}

export interface Recent {
  readonly id: string
  readonly sourceThread: SourceThread | null
  readonly kind: Coordination.EventKind
  readonly occurredAt: string
  readonly actorId: Coordination.UserID | null
  readonly outcome: string | null
  readonly eventSeq: number
}

export interface View {
  readonly projectId: Coordination.ProjectID
  readonly asOf: string
  readonly workingNow: ReadonlyArray<Working>
  readonly upNext: ReadonlyArray<UpNext>
  readonly recent: ReadonlyArray<Recent>
}

export interface Dependencies {
  readonly access: Pick<CoordinationContracts.Access, "authorize">
  readonly projects: Pick<CoordinationContracts.Projects, "listThreads">
  readonly queue: Pick<CoordinationContracts.Queue, "instructions" | "runs">
  readonly runner: Pick<CoordinationContracts.Runner, "approvals">
  readonly events: Pick<CoordinationContracts.Events, "replayProject">
  readonly cards: Pick<WorkCard.Interface, "get">
}

export interface Interface {
  readonly read: (
    principal: Coordination.AuthContext,
    projectId: Coordination.ProjectID,
    at?: Date,
  ) => Effect.Effect<View, CoordinationContracts.Failure>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/CoordinationActivity") {}

const activeStates = new Set<Coordination.RunState>([
  "reserved",
  "running",
  "waiting_approval",
  "cancelling",
  "recovery_required",
])
const meaningfulKinds = new Set<Coordination.EventKind>([
  "comment.created",
  "instruction.submitted",
  "instruction.cancelled",
  "run.started",
  "run.tool",
  "run.workspace",
  "run.diff",
  "run.approval.requested",
  "run.approval.resolved",
  "run.cancel.requested",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "run.recovery.required",
  "work-card.updated",
])

export const make = (deps: Dependencies): Interface => ({
  read: (principal, projectId, at = new Date()) =>
    Effect.gen(function* () {
      yield* deps.access.authorize(principal, projectId, undefined, "read")
      const threads = yield* deps.projects.listThreads(principal, projectId)
      const byThread = new Map(threads.map((thread) => [thread.id, thread]))
      const cutoff = at.getTime() - 60 * 60 * 1000
      const current = yield* Effect.forEach(threads, (thread) =>
        Effect.gen(function* () {
          const [instructions, runs, approvals, card] = yield* Effect.all([
            deps.queue.instructions(thread.id),
            deps.queue.runs(thread.id),
            deps.runner.approvals(thread.id),
            deps.cards.get(thread.id),
          ])
          return { thread, instructions, runs, approvals, card }
        }),
      )

      const workingNow = current.flatMap((item) => {
        const active = item.runs.find((run) => activeStates.has(run.state))
        const card = item.card
        const blocker = !!card?.blockers.length && card.sourceActivitySeq === item.thread.activitySeq
        if (!active && !blocker) return []
        const latest = item.runs.toSorted((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]
        const run = active ?? latest
        const waiting =
          active?.state === "waiting_approval"
            ? item.approvals.find(
                (approval) => approval.runId === active.id && ["pending", "claimed"].includes(approval.state),
              )
            : undefined
        return [
          {
            id: active?.id ?? card?.id ?? item.thread.id,
            sourceThread: sourceThread(item.thread),
            runId: run?.id ?? null,
            status: active?.state ?? run?.state ?? "idle",
            startedAt: run?.startedAt ?? null,
            approvalId: waiting?.id ?? null,
            objective: card?.currentTask ?? null,
            step: card?.progress ?? null,
            blockers: blocker && card ? card.blockers : [],
            recentVerifiedOutcome: card?.recentVerifiedOutcome ?? null,
            contributors: card?.contributors ?? [],
            freshness: card
              ? {
                  sourceActivitySeq: card.sourceActivitySeq,
                  threadActivitySeq: item.thread.activitySeq,
                  stale: card.sourceActivitySeq < item.thread.activitySeq,
                  generatedAt: card.generatedAt,
                  updatedAt: card.updatedAt,
                  summaryJobId: card.summaryJobId,
                }
              : null,
          } satisfies Working,
        ]
      })

      const upNext = current
        .flatMap((item) => {
          const queued = new Set(item.runs.filter((run) => run.state === "queued").map((run) => run.instructionId))
          return item.instructions
            .filter((instruction) => queued.has(instruction.id))
            .map((instruction) => ({
              id: instruction.id,
              sourceThread: sourceThread(item.thread),
              status: "queued" as const,
              queueSeq: instruction.queueSeq,
              submittedAt: instruction.submittedAt,
              actorId: instruction.actorId,
              text: instruction.text,
            }))
        })
        .toSorted((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt) || a.queueSeq - b.queueSeq)

      const recent: Recent[] = []
      let cursor = -1
      while (true) {
        const page = yield* deps.events.replayProject(projectId, cursor, 256)
        for (const event of page.events) {
          if (!meaningfulKinds.has(event.kind)) continue
          const occurredAt = Date.parse(event.occurredAt)
          if (!Number.isFinite(occurredAt) || occurredAt < cutoff || occurredAt > at.getTime()) continue
          const thread = event.threadId && byThread.get(event.threadId)
          if (event.threadId && !thread) continue
          recent.push({
            id: event.id,
            sourceThread: thread ? sourceThread(thread) : null,
            kind: event.kind,
            occurredAt: event.occurredAt,
            actorId: event.actorId ?? null,
            outcome: outcome(event),
            eventSeq: event.seq,
          })
        }
        if (!page.hasMore) break
        cursor = page.cursor
      }

      return {
        projectId,
        asOf: at.toISOString(),
        workingNow,
        upNext,
        recent: recent.toSorted(
          (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || b.eventSeq - a.eventSeq,
        ),
      }
    }),
})

export const layer = (deps: Dependencies) => Layer.succeed(Service, Service.of(make(deps)))

function sourceThread(thread: Coordination.Thread): SourceThread {
  return {
    threadId: thread.id,
    sessionId: thread.sessionId,
    href: `/api/coordination/v1/threads/${encodeURIComponent(thread.id)}`,
  }
}

function outcome(event: Coordination.Event) {
  const text = event.payload.recentVerifiedOutcome ?? event.payload.summary ?? event.payload.message
  return typeof text === "string" ? text : null
}
