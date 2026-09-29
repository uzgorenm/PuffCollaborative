export * as ProjectContext from "./context"

import { and, asc, desc, eq } from "drizzle-orm"
import { isDeepStrictEqual } from "node:util"
import { Effect } from "effect"
import type { Coordination } from "@opencode-ai/schema/coordination"
import type { Database } from "../../database/database"
import type { CoordinationContracts } from "../contracts"
import { MembershipTable } from "../projects/sql"
import { PersonFocusRevisionTable, ProjectBriefRevisionTable } from "./context-sql"

export type BriefContent = Coordination.ProjectBriefContent
export type Brief = Coordination.ProjectBrief
export type Focus = Coordination.PersonFocus
export type Interface = CoordinationContracts.ProjectContext

export interface Dependencies {
  readonly db: Database.Interface["db"]
  readonly access: Pick<CoordinationContracts.Access, "authorize">
  readonly events: Pick<CoordinationContracts.Events, "append">
}

const unavailable: CoordinationContracts.Failure = { code: "unavailable", message: "Project context is unavailable" }
const forbidden: CoordinationContracts.Failure = { code: "forbidden", message: "Access denied" }
const conflict: CoordinationContracts.Failure = { code: "conflict", message: "Request conflicts with current context" }
const invalid: CoordinationContracts.Failure = { code: "invalid", message: "Invalid project context" }

class ExactRetry extends Error {}

const failureCodes = new Set<CoordinationContracts.ErrorCode>([
  "invalid",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "unavailable",
])

const asFailure = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, CoordinationContracts.Failure, R> =>
  effect.pipe(
    Effect.mapError(
      (error): CoordinationContracts.Failure =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        "message" in error &&
        failureCodes.has(error.code as CoordinationContracts.ErrorCode)
          ? (error as CoordinationContracts.Failure)
          : unavailable,
    ),
    Effect.catchDefect((defect) =>
      defect instanceof Error && (defect.name === "SQLiteError" || defect.name === "SqlError")
        ? Effect.fail(unavailable)
        : Effect.die(defect),
    ),
  )

const validRequest = (requestId: string, expectedVersion: number) =>
  requestId.trim().length > 0 &&
  requestId.length <= 256 &&
  Number.isSafeInteger(expectedVersion) &&
  expectedVersion >= 0

const validContent = (content: BriefContent, members: ReadonlySet<Coordination.UserID>) =>
  content.goal.trim().length > 0 &&
  content.goal.length <= 2_000 &&
  content.successCriteria.length >= 1 &&
  content.successCriteria.length <= 10 &&
  content.successCriteria.every((item) => item.trim().length > 0 && item.length <= 500) &&
  content.roles.length <= 20 &&
  new Set(content.roles.map((item) => item.userId)).size === content.roles.length &&
  content.roles.every((item) => members.has(item.userId) && item.label.trim().length > 0 && item.label.length <= 100) &&
  content.tools.length <= 20 &&
  new Set(content.tools).size === content.tools.length &&
  content.tools.every((item) => item.trim().length > 0 && item.length <= 100) &&
  content.sharingDefault === "private" &&
  ["off", "review-each-note", "allow-validated-topic-notes"].includes(content.suggestedAwarenessMode)

const briefFromRow = (row: typeof ProjectBriefRevisionTable.$inferSelect): Brief => ({
  ...row.content,
  projectId: row.project_id,
  version: row.version,
  updatedBy: row.updated_by,
  updatedAt: new Date(row.updated_at).toISOString(),
})

const focusFromRow = (row: typeof PersonFocusRevisionTable.$inferSelect): Focus => ({
  projectId: row.project_id,
  userId: row.user_id,
  version: row.version,
  text: row.focus_text,
  updatedAt: new Date(row.updated_at).toISOString(),
})

export function make(input: Dependencies): Interface {
  const briefByRequest = (projectId: Coordination.ProjectID, actorId: Coordination.UserID, requestId: string) =>
    input.db
      .select()
      .from(ProjectBriefRevisionTable)
      .where(
        and(
          eq(ProjectBriefRevisionTable.project_id, projectId),
          eq(ProjectBriefRevisionTable.updated_by, actorId),
          eq(ProjectBriefRevisionTable.request_id, requestId),
        ),
      )
      .get()
  const latestBrief = (projectId: Coordination.ProjectID) =>
    input.db
      .select()
      .from(ProjectBriefRevisionTable)
      .where(eq(ProjectBriefRevisionTable.project_id, projectId))
      .orderBy(desc(ProjectBriefRevisionTable.version))
      .get()
  const focusByRequest = (projectId: Coordination.ProjectID, userId: Coordination.UserID, requestId: string) =>
    input.db
      .select()
      .from(PersonFocusRevisionTable)
      .where(
        and(
          eq(PersonFocusRevisionTable.project_id, projectId),
          eq(PersonFocusRevisionTable.user_id, userId),
          eq(PersonFocusRevisionTable.request_id, requestId),
        ),
      )
      .get()
  const latestFocus = (projectId: Coordination.ProjectID, userId: Coordination.UserID) =>
    input.db
      .select()
      .from(PersonFocusRevisionTable)
      .where(and(eq(PersonFocusRevisionTable.project_id, projectId), eq(PersonFocusRevisionTable.user_id, userId)))
      .orderBy(desc(PersonFocusRevisionTable.version))
      .get()
  const members = (projectId: Coordination.ProjectID) =>
    input.db.select().from(MembershipTable).where(eq(MembershipTable.project_id, projectId)).all()
  const owner = (projectId: Coordination.ProjectID, userId: Coordination.UserID) =>
    input.db
      .select({ role: MembershipTable.role })
      .from(MembershipTable)
      .where(and(eq(MembershipTable.project_id, projectId), eq(MembershipTable.user_id, userId)))
      .get()

  return {
    readBrief: (principal, projectId) =>
      asFailure(
        Effect.gen(function* () {
          yield* input.access.authorize(principal, projectId, undefined, "read")
          const row = yield* latestBrief(projectId)
          return row ? briefFromRow(row) : undefined
        }),
      ),
    putBrief: (request) =>
      asFailure(
        Effect.gen(function* () {
          if (request.principal.kind !== "member") return yield* Effect.fail(forbidden)
          if (!validRequest(request.requestId, request.expectedVersion)) return yield* Effect.fail(invalid)
          const actorId = request.principal.userId
          yield* input.access.authorize(request.principal, request.projectId, undefined, "read")
          if ((yield* owner(request.projectId, actorId))?.role !== "owner") return yield* Effect.fail(forbidden)
          const prior = yield* briefByRequest(request.projectId, actorId, request.requestId)
          if (prior)
            return prior.version === request.expectedVersion + 1 && isDeepStrictEqual(prior.content, request.content)
              ? briefFromRow(prior)
              : yield* Effect.fail(conflict)
          const currentMembers = new Set((yield* members(request.projectId)).map((item) => item.user_id))
          if (!validContent(request.content, currentMembers)) return yield* Effect.fail(invalid)
          const latest = yield* latestBrief(request.projectId)
          if ((latest?.version ?? 0) !== request.expectedVersion) return yield* Effect.fail(conflict)
          const updatedAt = Date.now()
          yield* input.events
            .append(
              {
                projectId: request.projectId,
                kind: "project.brief.updated",
                occurredAt: new Date(updatedAt).toISOString(),
                actorId,
                payload: { version: request.expectedVersion + 1 },
              },
              (seq) =>
                asFailure(
                  Effect.gen(function* () {
                    yield* input.access.authorize(request.principal, request.projectId, undefined, "read")
                    if ((yield* owner(request.projectId, actorId))?.role !== "owner")
                      return yield* Effect.fail(forbidden)
                    const accepted = yield* briefByRequest(request.projectId, actorId, request.requestId)
                    if (accepted) return yield* Effect.die(new ExactRetry())
                    const current = yield* latestBrief(request.projectId)
                    if ((current?.version ?? 0) !== request.expectedVersion) return yield* Effect.fail(conflict)
                    const currentMembers = new Set((yield* members(request.projectId)).map((item) => item.user_id))
                    if (!validContent(request.content, currentMembers)) return yield* Effect.fail(invalid)
                    yield* input.db
                      .insert(ProjectBriefRevisionTable)
                      .values({
                        project_id: request.projectId,
                        version: request.expectedVersion + 1,
                        content: request.content,
                        updated_by: actorId,
                        updated_at: updatedAt,
                        request_id: request.requestId,
                        event_seq: seq,
                      })
                      .run()
                  }),
                ),
            )
            .pipe(Effect.catchDefect((defect) => (defect instanceof ExactRetry ? Effect.void : Effect.die(defect))))
          const stored = yield* briefByRequest(request.projectId, actorId, request.requestId)
          if (!stored) return yield* Effect.fail(unavailable)
          return stored.version === request.expectedVersion + 1 && isDeepStrictEqual(stored.content, request.content)
            ? briefFromRow(stored)
            : yield* Effect.fail(conflict)
        }),
      ),
    listFocus: (principal, projectId) =>
      asFailure(
        Effect.gen(function* () {
          yield* input.access.authorize(principal, projectId, undefined, "read")
          const currentMembers = new Set((yield* members(projectId)).map((item) => item.user_id))
          const rows = yield* input.db
            .select()
            .from(PersonFocusRevisionTable)
            .where(eq(PersonFocusRevisionTable.project_id, projectId))
            .orderBy(asc(PersonFocusRevisionTable.user_id), desc(PersonFocusRevisionTable.version))
            .all()
          const latest = new Map<Coordination.UserID, Focus>()
          for (const row of rows) {
            if (!currentMembers.has(row.user_id) || latest.has(row.user_id)) continue
            latest.set(row.user_id, focusFromRow(row))
          }
          return [...latest.values()]
        }),
      ),
    putFocus: (request) =>
      asFailure(
        Effect.gen(function* () {
          if (request.principal.kind !== "member") return yield* Effect.fail(forbidden)
          if (
            !validRequest(request.requestId, request.expectedVersion) ||
            (request.text !== null && (!request.text.trim() || request.text.length > 2_000))
          )
            return yield* Effect.fail(invalid)
          const userId = request.principal.userId
          yield* input.access.authorize(request.principal, request.projectId, undefined, "read")
          const prior = yield* focusByRequest(request.projectId, userId, request.requestId)
          if (prior)
            return prior.version === request.expectedVersion + 1 && prior.focus_text === request.text
              ? focusFromRow(prior)
              : yield* Effect.fail(conflict)
          const latest = yield* latestFocus(request.projectId, userId)
          if ((latest?.version ?? 0) !== request.expectedVersion) return yield* Effect.fail(conflict)
          const updatedAt = Date.now()
          yield* input.events
            .append(
              {
                projectId: request.projectId,
                kind: "person.focus.updated",
                occurredAt: new Date(updatedAt).toISOString(),
                actorId: userId,
                payload: { version: request.expectedVersion + 1 },
              },
              (seq) =>
                asFailure(
                  Effect.gen(function* () {
                    yield* input.access.authorize(request.principal, request.projectId, undefined, "read")
                    const accepted = yield* focusByRequest(request.projectId, userId, request.requestId)
                    if (accepted) return yield* Effect.die(new ExactRetry())
                    const current = yield* latestFocus(request.projectId, userId)
                    if ((current?.version ?? 0) !== request.expectedVersion) return yield* Effect.fail(conflict)
                    yield* input.db
                      .insert(PersonFocusRevisionTable)
                      .values({
                        project_id: request.projectId,
                        user_id: userId,
                        version: request.expectedVersion + 1,
                        focus_text: request.text,
                        updated_at: updatedAt,
                        request_id: request.requestId,
                        event_seq: seq,
                      })
                      .run()
                  }),
                ),
            )
            .pipe(Effect.catchDefect((defect) => (defect instanceof ExactRetry ? Effect.void : Effect.die(defect))))
          const stored = yield* focusByRequest(request.projectId, userId, request.requestId)
          if (!stored) return yield* Effect.fail(unavailable)
          return stored.version === request.expectedVersion + 1 && stored.focus_text === request.text
            ? focusFromRow(stored)
            : yield* Effect.fail(conflict)
        }),
      ),
  }
}
