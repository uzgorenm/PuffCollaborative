export * as WorkCard from "./work-card"

import { and, eq, lte } from "drizzle-orm"
import { isDeepStrictEqual } from "node:util"
import { Context, Effect, Layer } from "effect"
import { Coordination } from "@opencode-ai/schema/coordination"
import { Database } from "../../database/database"
import type { CoordinationContracts } from "../contracts"
import { WorkCardTable } from "./sql"

export interface EvidenceRef {
  readonly threadId: Coordination.ThreadID
  readonly eventId: string
  readonly seq: number
}

export interface SubmittedCard
  extends Pick<Coordination.WorkCard, "currentTask" | "progress" | "blockers" | "status" | "summaryJobId"> {
  readonly recentVerifiedOutcome: string | null
  readonly contributors: ReadonlyArray<Coordination.UserID>
  readonly evidenceRefs: ReadonlyArray<EvidenceRef>
  readonly generatedAt: string
}

export interface Detail extends Coordination.WorkCard {
  readonly projectId: Coordination.ProjectID
  readonly recentVerifiedOutcome: string | null
  readonly contributors: ReadonlyArray<Coordination.UserID>
  readonly evidenceRefs: ReadonlyArray<EvidenceRef>
  readonly generatedAt: string
  readonly submittedBy: string
}

export interface UpdateInput {
  readonly principal: Coordination.AuthContext
  readonly threadId: Coordination.ThreadID
  readonly expectedVersion: number
  readonly sourceActivitySeq: number
  readonly card: SubmittedCard
}

export interface Interface {
  readonly get: (threadId: Coordination.ThreadID) => Effect.Effect<Detail | undefined, CoordinationContracts.Failure>
  readonly read: (
    principal: Coordination.AuthContext,
    threadId: Coordination.ThreadID,
  ) => Effect.Effect<Detail | undefined, CoordinationContracts.Failure>
  readonly list: (
    principal: Coordination.AuthContext,
    projectId: Coordination.ProjectID,
  ) => Effect.Effect<ReadonlyArray<Detail>, CoordinationContracts.Failure>
  readonly update: (input: UpdateInput) => Effect.Effect<Detail, CoordinationContracts.Failure>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/CoordinationWorkCards") {}

export interface Dependencies {
  readonly access: Pick<CoordinationContracts.Access, "authorize" | "getThread">
  // Trusted internal lookup: Access.getThread has already authorized this analysis principal for the project.
  readonly projectMembers: (
    projectId: Coordination.ProjectID,
  ) => Effect.Effect<ReadonlyArray<Coordination.UserID>, CoordinationContracts.Failure>
  readonly events: Pick<CoordinationContracts.Events, "append" | "replayProject">
}

const failure = (code: CoordinationContracts.ErrorCode, message: string): CoordinationContracts.Failure => ({
  code,
  message,
})

export const make = Effect.fn("CoordinationWorkCards.make")(function* (deps: Dependencies) {
  const { db } = yield* Database.Service

  const get = Effect.fn("CoordinationWorkCards.get")(function* (threadId: Coordination.ThreadID) {
    const row = yield* db
      .select({ data: WorkCardTable.data })
      .from(WorkCardTable)
      .where(eq(WorkCardTable.thread_id, threadId))
      .get()
      .pipe(Effect.orDie)
    return row?.data
  })

  const read = Effect.fn("CoordinationWorkCards.read")(function* (
    principal: Coordination.AuthContext,
    threadId: Coordination.ThreadID,
  ) {
    yield* deps.access.getThread(principal, threadId, "read")
    return yield* get(threadId)
  })

  const list = Effect.fn("CoordinationWorkCards.list")(function* (
    principal: Coordination.AuthContext,
    projectId: Coordination.ProjectID,
  ) {
    yield* deps.access.authorize(principal, projectId, undefined, "read")
    const rows = yield* db
      .select({ data: WorkCardTable.data })
      .from(WorkCardTable)
      .where(eq(WorkCardTable.project_id, projectId))
      .all()
      .pipe(Effect.orDie)
    return rows.map((row) => row.data)
  })

  const update = Effect.fn("CoordinationWorkCards.update")(function* (input: UpdateInput) {
    if (input.principal.kind !== "analysis")
      return yield* Effect.fail(failure("forbidden", "Only the analysis service may update work cards"))
    const thread = yield* deps.access.getThread(input.principal, input.threadId, "update_work_card")
    const invalid = validate(input)
    if (invalid) return yield* Effect.fail(invalid)

    const existing = yield* get(input.threadId)
    if (existing?.version === input.expectedVersion + 1 && sameSubmission(existing, input)) return existing
    if ((existing?.version ?? 0) !== input.expectedVersion)
      return yield* Effect.fail(failure("conflict", "Work card version is stale"))
    if (existing && input.sourceActivitySeq < existing.sourceActivitySeq)
      return yield* Effect.fail(failure("conflict", "Analysis source sequence is stale"))
    if (thread.activitySeq !== input.sourceActivitySeq)
      return yield* Effect.fail(failure("conflict", "Thread activity advanced since analysis"))

    const members = new Set(yield* deps.projectMembers(thread.projectId))
    if (input.card.contributors.some((contributor) => !members.has(contributor)))
      return yield* Effect.fail(failure("invalid", "Contributor is not a project member"))

    for (const ref of input.card.evidenceRefs) {
      if (ref.threadId !== input.threadId)
        return yield* Effect.fail(failure("invalid", "Evidence must belong to the work card thread"))
      if (ref.seq > input.sourceActivitySeq)
        return yield* Effect.fail(failure("invalid", "Evidence is newer than the analysis source sequence"))
      const page = yield* deps.events.replayProject(thread.projectId, ref.seq - 1, 1)
      const event = page.events[0]
      if (event?.id !== ref.eventId || event.seq !== ref.seq || event.threadId !== ref.threadId)
        return yield* Effect.fail(failure("invalid", "Evidence reference does not match a project event"))
    }

    const updatedAt = new Date().toISOString()
    const detail: Detail = {
      id: Coordination.WorkCardID.make(`wc_${input.threadId}`),
      projectId: thread.projectId,
      threadId: input.threadId,
      version: input.expectedVersion + 1,
      sourceActivitySeq: input.sourceActivitySeq,
      currentTask: input.card.currentTask,
      progress: input.card.progress,
      blockers: input.card.blockers,
      status: input.card.status,
      summaryJobId: input.card.summaryJobId,
      recentVerifiedOutcome: input.card.recentVerifiedOutcome,
      contributors: input.card.contributors,
      evidenceRefs: input.card.evidenceRefs,
      generatedAt: input.card.generatedAt,
      submittedBy: input.principal.serviceId,
      updatedAt,
    }

    return yield* deps.events
      .append(
        {
          projectId: thread.projectId,
          threadId: input.threadId,
          kind: "work-card.updated",
          occurredAt: updatedAt,
          payload: {
            cardId: detail.id,
            version: detail.version,
            sourceActivitySeq: detail.sourceActivitySeq,
            summaryJobId: detail.summaryJobId,
            recentVerifiedOutcome: detail.recentVerifiedOutcome,
          },
        },
        () =>
          Effect.gen(function* () {
            const currentThread = yield* deps.access.getThread(input.principal, input.threadId, "update_work_card")
            if (currentThread.projectId !== thread.projectId || currentThread.activitySeq !== input.sourceActivitySeq)
              return yield* Effect.fail(failure("conflict", "Thread activity advanced since analysis"))
            if (existing) {
              const row = yield* db
                .update(WorkCardTable)
                .set({
                  version: detail.version,
                  source_activity_seq: detail.sourceActivitySeq,
                  data: detail,
                  time_updated: Date.parse(updatedAt),
                })
                .where(
                  and(
                    eq(WorkCardTable.thread_id, input.threadId),
                    eq(WorkCardTable.version, input.expectedVersion),
                    lte(WorkCardTable.source_activity_seq, input.sourceActivitySeq),
                  ),
                )
                .returning({ id: WorkCardTable.thread_id })
                .get()
                .pipe(Effect.orDie)
              if (!row) return yield* Effect.fail(failure("conflict", "Work card version changed"))
              return
            }
            const row = yield* db
              .insert(WorkCardTable)
              .values({
                thread_id: input.threadId,
                project_id: thread.projectId,
                version: detail.version,
                source_activity_seq: detail.sourceActivitySeq,
                data: detail,
                time_updated: Date.parse(updatedAt),
              })
              .onConflictDoNothing()
              .returning({ id: WorkCardTable.thread_id })
              .get()
              .pipe(Effect.orDie)
            if (!row) return yield* Effect.fail(failure("conflict", "Work card version changed"))
          }),
      )
      .pipe(
        Effect.as(detail),
        Effect.catch((error) =>
          get(input.threadId).pipe(
            Effect.flatMap((current) =>
              current?.version === input.expectedVersion + 1 && sameSubmission(current, input)
                ? Effect.succeed(current)
                : Effect.fail(error),
            ),
          ),
        ),
      )
  })

  return Service.of({ get, read, list, update })
})

export const layer = (deps: Dependencies) => Layer.effect(Service, make(deps))

function validate(input: UpdateInput): CoordinationContracts.Failure | undefined {
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0)
    return failure("invalid", "Expected version must be a nonnegative integer")
  if (!Number.isSafeInteger(input.sourceActivitySeq) || input.sourceActivitySeq < 0)
    return failure("invalid", "Source activity sequence must be a nonnegative integer")
  if (
    !input.card ||
    typeof input.card.currentTask !== "string" ||
    typeof input.card.progress !== "string" ||
    typeof input.card.summaryJobId !== "string" ||
    (input.card.recentVerifiedOutcome !== null && typeof input.card.recentVerifiedOutcome !== "string") ||
    typeof input.card.generatedAt !== "string" ||
    !["queued", "active", "blocked", "idle", "done"].includes(input.card.status)
  )
    return failure("invalid", "Work card fields are invalid")
  if (
    !Array.isArray(input.card.blockers) ||
    !Array.isArray(input.card.contributors) ||
    !Array.isArray(input.card.evidenceRefs)
  )
    return failure("invalid", "Work card lists are required")
  if (!input.card.currentTask.trim() || !input.card.progress.trim() || !input.card.summaryJobId.trim())
    return failure("invalid", "Objective, step and summary job ID are required")
  if (
    input.card.currentTask.length > 8000 ||
    input.card.progress.length > 8000 ||
    (input.card.recentVerifiedOutcome?.length ?? 0) > 8000 ||
    input.card.blockers.length > 16 ||
    input.card.blockers.some((blocker) => typeof blocker !== "string" || blocker.length > 8000) ||
    input.card.contributors.length > 16 ||
    input.card.contributors.some((contributor) => typeof contributor !== "string" || !contributor) ||
    input.card.evidenceRefs.length === 0 ||
    input.card.evidenceRefs.length > 32
  )
    return failure("invalid", "Work card exceeds its field limits")
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(input.card.generatedAt) ||
    !Number.isFinite(Date.parse(input.card.generatedAt))
  )
    return failure("invalid", "Generated time must be a UTC timestamp")
  if (
    input.card.evidenceRefs.some(
      (ref) =>
        !ref ||
        !Number.isSafeInteger(ref.seq) ||
        ref.seq < 0 ||
        typeof ref.eventId !== "string" ||
        !ref.eventId ||
        typeof ref.threadId !== "string" ||
        !ref.threadId,
    )
  )
    return failure("invalid", "Evidence reference is invalid")
  return undefined
}

function sameSubmission(card: Detail, input: UpdateInput) {
  return (
    card.sourceActivitySeq === input.sourceActivitySeq &&
    card.submittedBy === (input.principal.kind === "analysis" ? input.principal.serviceId : "") &&
    isDeepStrictEqual(
      {
        currentTask: card.currentTask,
        progress: card.progress,
        blockers: card.blockers,
        status: card.status,
        summaryJobId: card.summaryJobId,
        recentVerifiedOutcome: card.recentVerifiedOutcome,
        contributors: card.contributors,
        evidenceRefs: card.evidenceRefs,
        generatedAt: card.generatedAt,
      },
      {
        currentTask: input.card.currentTask,
        progress: input.card.progress,
        blockers: input.card.blockers,
        status: input.card.status,
        summaryJobId: input.card.summaryJobId,
        recentVerifiedOutcome: input.card.recentVerifiedOutcome,
        contributors: input.card.contributors,
        evidenceRefs: input.card.evidenceRefs,
        generatedAt: input.card.generatedAt,
      },
    )
  )
}
