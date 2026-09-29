export * as CoordinationOverview from "./index"

import { and, asc, eq } from "drizzle-orm"
import { Effect } from "effect"
import type { Coordination } from "@opencode-ai/schema/coordination"
import type { Database } from "../../database/database"
import { ApprovalTable } from "../approval/sql"
import type { CoordinationContracts } from "../contracts"
import { MembershipTable, SharedProjectTable } from "../projects/sql"
import { RunTable } from "../queue/sql"
import { threadFromRow } from "../threads/row"
import { ThreadTable } from "../threads/sql"
import { WorkCardTable } from "../work-card/sql"

export interface Intent {
  readonly projectId: Coordination.ProjectID
  readonly threadId: Coordination.ThreadID
  readonly sessionId: Coordination.Thread["sessionId"]
  readonly workerId: Coordination.WorkerID
  readonly ownerId: Coordination.UserID
  readonly selectedBy: Coordination.UserID
  readonly topic: string
  readonly relationship: "alternative" | "related" | "unspecified"
  readonly revision: number
  readonly state: "selected" | "muted"
}

export interface WorkItem {
  readonly thread: Coordination.Thread
  readonly card?: Coordination.WorkCard
  readonly freshness: "missing" | "stale" | "current" | "invalid"
  readonly evidence: ReadonlyArray<{
    readonly id: string
    readonly seq: number
    readonly threadId: Coordination.ThreadID
    readonly kind: Coordination.EventKind
    readonly occurredAt: string
  }>
  readonly latestRunState: Coordination.RunState | null
  readonly toolPermissions: ReadonlyArray<{ readonly id: string; readonly state: "pending" | "claimed" }>
}

export interface RelatedCandidate {
  readonly threadId: Coordination.ThreadID
  readonly kind: "deliberate-alternative" | "reported-completed" | "possible-overlap"
  readonly freshness: WorkItem["freshness"]
  readonly sourceActivitySeq: number | null
  readonly evidenceRefs: Coordination.WorkCard["evidenceRefs"]
}

export interface View {
  readonly project: Coordination.SharedProject
  readonly members: ReadonlyArray<Coordination.Membership>
  readonly work: ReadonlyArray<WorkItem>
  readonly related: ReadonlyArray<RelatedCandidate>
  readonly cursor: number
  readonly redirection: "requires-separate-owner-approval"
}

export interface Dependencies {
  readonly db: Database.Interface["db"]
  readonly access: Pick<CoordinationContracts.Access, "authorize">
  readonly events: Pick<CoordinationContracts.Events, "replayProject" | "latestSequence">
  // Must read the current server-owned selection projection in the same database transaction.
  readonly intents: {
    readonly list: (
      projectId: Coordination.ProjectID,
    ) => Effect.Effect<ReadonlyArray<Intent>, CoordinationContracts.Failure>
  }
}

export interface Interface {
  readonly read: (
    principal: Coordination.AuthContext,
    projectId: Coordination.ProjectID,
    sourceThreadId?: Coordination.ThreadID,
  ) => Effect.Effect<View, CoordinationContracts.Failure>
}

const forbidden: CoordinationContracts.Failure = { code: "forbidden", message: "Access denied" }
const unavailable: CoordinationContracts.Failure = { code: "unavailable", message: "Could not read project overview" }
const activeStates = new Set<Coordination.RunState>([
  "reserved",
  "running",
  "waiting_approval",
  "cancelling",
  "recovery_required",
])

export function make(input: Dependencies): Interface {
  return {
    read: (principal, projectId, sourceThreadId) =>
      input.db
        .transaction(() =>
          Effect.gen(function* () {
            yield* input.access.authorize(principal, projectId, undefined, "read")
            const project = yield* input.db
              .select()
              .from(SharedProjectTable)
              .where(eq(SharedProjectTable.id, projectId))
              .get()
            if (!project) return yield* Effect.fail(forbidden)
            const members = yield* input.db
              .select()
              .from(MembershipTable)
              .where(eq(MembershipTable.project_id, projectId))
              .orderBy(asc(MembershipTable.joined_at), asc(MembershipTable.user_id))
              .all()
            const threads = yield* input.db
              .select()
              .from(ThreadTable)
              .where(eq(ThreadTable.project_id, projectId))
              .orderBy(asc(ThreadTable.created_at), asc(ThreadTable.id))
              .all()
            if (sourceThreadId && !threads.some((thread) => thread.id === sourceThreadId))
              return yield* Effect.fail(forbidden)
            const memberIds = new Set(members.map((member) => member.user_id))
            const work = yield* Effect.forEach(
              threads,
              (thread): Effect.Effect<WorkItem, unknown> =>
                Effect.gen(function* () {
                  const row = yield* input.db
                    .select()
                    .from(WorkCardTable)
                    .where(and(eq(WorkCardTable.project_id, projectId), eq(WorkCardTable.thread_id, thread.id)))
                    .get()
                  const runs = yield* input.db
                    .select()
                    .from(RunTable)
                    .where(eq(RunTable.thread_id, thread.id))
                    .orderBy(asc(RunTable.created_at), asc(RunTable.id))
                    .all()
                  const approvals = yield* input.db
                    .select()
                    .from(ApprovalTable)
                    .where(and(eq(ApprovalTable.project_id, projectId), eq(ApprovalTable.thread_id, thread.id)))
                    .orderBy(asc(ApprovalTable.requested_at), asc(ApprovalTable.id))
                    .all()
                  const currentRun = runs.findLast((run) => activeStates.has(run.state)) ?? runs.at(-1)
                  const toolPermissions = approvals
                    .filter(
                      (approval) =>
                        currentRun?.state === "waiting_approval" &&
                        approval.run_id === currentRun.id &&
                        (approval.state === "pending" || approval.state === "claimed"),
                    )
                    .map((approval) => ({ id: approval.id, state: approval.state as "pending" | "claimed" }))
                  const base = {
                    thread: threadFromRow(thread),
                    latestRunState: currentRun?.state ?? null,
                    toolPermissions,
                  }
                  if (!row) return { ...base, freshness: "missing", evidence: [] }
                  const card = row.data
                  if (
                    card.projectId !== projectId ||
                    card.threadId !== thread.id ||
                    card.sourceActivitySeq !== row.source_activity_seq ||
                    card.sourceActivitySeq > thread.activity_seq ||
                    card.evidenceRefs.length === 0 ||
                    card.evidenceRefs.some((ref) => ref.threadId !== thread.id || ref.seq > card.sourceActivitySeq)
                  )
                    return { ...base, freshness: "invalid", evidence: [] }
                  const evidence = yield* Effect.forEach(card.evidenceRefs, (ref) =>
                    Effect.map(input.events.replayProject(projectId, ref.seq - 1, 1), (page) => page.events[0]),
                  )
                  if (
                    evidence.some(
                      (event, index) =>
                        event?.projectId !== projectId ||
                        event?.id !== card.evidenceRefs[index]?.eventId ||
                        event?.threadId !== thread.id ||
                        event?.seq !== card.evidenceRefs[index]?.seq,
                    )
                  )
                    return { ...base, freshness: "invalid", evidence: [] }
                  return {
                    ...base,
                    card,
                    freshness: card.sourceActivitySeq === thread.activity_seq ? "current" : "stale",
                    evidence: evidence.map((event) => ({
                      id: event!.id,
                      seq: event!.seq,
                      threadId: thread.id,
                      kind: event!.kind,
                      occurredAt: event!.occurredAt,
                    })),
                  }
                }),
            )
            const selected = yield* input.intents.list(projectId)
            const byThread = new Map(work.map((item) => [item.thread.id, item]))
            const intentByThread = new Map<Coordination.ThreadID, Intent>()
            const ambiguous = new Set<Coordination.ThreadID>()
            const seen = new Set<Coordination.ThreadID>()
            for (const intent of selected) {
              const thread = byThread.get(intent.threadId)?.thread
              if (
                intent.projectId !== projectId ||
                !thread ||
                intent.sessionId !== thread.sessionId ||
                intent.workerId !== thread.workerId ||
                intent.selectedBy !== intent.ownerId ||
                !memberIds.has(intent.ownerId) ||
                !Number.isSafeInteger(intent.revision) ||
                intent.revision < 1
              )
                continue
              if (seen.has(intent.threadId)) ambiguous.add(intent.threadId)
              seen.add(intent.threadId)
              if (intent.state !== "selected" || !intent.topic.trim() || intent.topic.length > 256) continue
              intentByThread.set(intent.threadId, intent)
            }
            for (const threadId of ambiguous) intentByThread.delete(threadId)
            const source = sourceThreadId ? intentByThread.get(sourceThreadId) : undefined
            const related: RelatedCandidate[] = source
              ? work.flatMap((item) => {
                  const candidate = intentByThread.get(item.thread.id)
                  if (!candidate || candidate.threadId === source.threadId || candidate.topic !== source.topic)
                    return []
                  const reportedCompleted =
                    item.freshness === "current" &&
                    item.card?.status === "done" &&
                    !!item.card.recentVerifiedOutcome?.trim() &&
                    item.evidence.length > 0
                  return [
                    {
                      threadId: item.thread.id,
                      freshness: item.freshness,
                      kind:
                        source.relationship === "alternative" && candidate.relationship === "alternative"
                          ? ("deliberate-alternative" as const)
                          : reportedCompleted
                            ? ("reported-completed" as const)
                            : ("possible-overlap" as const),
                      sourceActivitySeq: item.card?.sourceActivitySeq ?? null,
                      evidenceRefs: item.card?.evidenceRefs ?? [],
                    },
                  ]
                })
              : []
            const cursor = yield* input.events.latestSequence(projectId)
            return {
              project: {
                id: project.id,
                name: project.name,
                createdBy: project.created_by,
                createdAt: new Date(project.created_at).toISOString(),
              },
              members: members.map((member) => ({
                projectId: member.project_id,
                userId: member.user_id,
                role: member.role,
                joinedAt: new Date(member.joined_at).toISOString(),
              })),
              work,
              related,
              cursor,
              redirection: "requires-separate-owner-approval" as const,
            }
          }),
        )
        .pipe(
          Effect.mapError(
            (error): CoordinationContracts.Failure =>
              typeof error === "object" &&
              error !== null &&
              "code" in error &&
              "message" in error &&
              ["invalid", "unauthorized", "forbidden", "not_found", "conflict", "unavailable"].includes(
                String(error.code),
              )
                ? (error as CoordinationContracts.Failure)
                : unavailable,
          ),
          Effect.catchDefect((defect) =>
            defect instanceof Error && (defect.name === "SQLiteError" || defect.name === "SqlError")
              ? Effect.fail(unavailable)
              : Effect.die(defect),
          ),
        ),
  }
}
