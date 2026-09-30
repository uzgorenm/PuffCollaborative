export * as CoordinationCooperation from "./index"

import { and, desc, eq } from "drizzle-orm"
import { isDeepStrictEqual } from "node:util"
import { Effect, Semaphore } from "effect"
import type { Coordination } from "@opencode-ai/schema/coordination"
import type { Database } from "../../database/database"
import type { CoordinationContracts } from "../contracts"
import type { CoordinationFlowerExport } from "../flower/export"
import { CoordinationProvisioning } from "../provisioning"
import { CooperationRevisionTable } from "./sql"

export interface Interface {
  readonly get: (
    principal: Coordination.AuthContext,
    threadId: Coordination.ThreadID,
  ) => Effect.Effect<Coordination.CooperationSettings, CoordinationContracts.Failure>
  readonly put: (request: {
    readonly principal: Coordination.AuthContext
    readonly threadId: Coordination.ThreadID
    readonly requestId: string
    readonly expectedVersion: number
    readonly content: Coordination.CooperationContent
  }) => Effect.Effect<Coordination.CooperationSettings, CoordinationContracts.Failure>
  readonly selection: CoordinationFlowerExport.Selection
}

const forbidden: CoordinationContracts.Failure = { code: "forbidden", message: "Session owner consent is required" }
const conflict: CoordinationContracts.Failure = {
  code: "conflict",
  message: "Cooperation settings changed or request was reused",
}
const invalid: CoordinationContracts.Failure = { code: "invalid", message: "Invalid cooperation settings" }
const locks = Semaphore.makeUnsafe(1)
/** Serialize consent mutations with analysis capture/admission and card writes in this server. */
export const withStableConsent = <A, E, R>(effect: Effect.Effect<A, E, R>) => locks.withPermit(effect)
const normalized = (content: Coordination.CooperationContent): Coordination.CooperationContent => ({
  ...content,
  analysisTextEnabled: content.analysisTextEnabled === true,
})

export function make(input: {
  readonly db: Database.Interface["db"]
  readonly access: CoordinationContracts.Access
}): Interface {
  const latest = (threadId: Coordination.ThreadID) =>
    input.db
      .select()
      .from(CooperationRevisionTable)
      .where(eq(CooperationRevisionTable.thread_id, threadId))
      .orderBy(desc(CooperationRevisionTable.version))
      .get()
      .pipe(Effect.orDie)
  const byRequest = (threadId: Coordination.ThreadID, requestId: string) =>
    input.db
      .select()
      .from(CooperationRevisionTable)
      .where(and(eq(CooperationRevisionTable.thread_id, threadId), eq(CooperationRevisionTable.request_id, requestId)))
      .get()
      .pipe(Effect.orDie)
  const selected = (principal: Coordination.AuthContext, threadId: Coordination.ThreadID) =>
    Effect.gen(function* () {
      if (principal.kind !== "member") return yield* Effect.fail(forbidden)
      const thread = yield* input.access.getThread(principal, threadId, "read")
      const ownerId = yield* CoordinationProvisioning.ownerOf(input.db, thread)
      return { thread, ownerId }
    })
  const view = (
    thread: Coordination.Thread,
    ownerId: Coordination.UserID | undefined,
    row?: typeof CooperationRevisionTable.$inferSelect,
  ): Coordination.CooperationSettings => ({
    threadId: thread.id,
    ...(ownerId ? { ownerId } : {}),
    sourceActivitySeq: thread.activitySeq,
    ...(row
      ? { ...normalized(row.content), version: row.version, updatedAt: new Date(row.updated_at).toISOString() }
      : {
          version: 0,
          featureTopic: "",
          relationship: "open" as const,
          analysisEnabled: false,
          analysisTextEnabled: false,
          awarenessMode: "off" as const,
        }),
  })
  return {
    get: (principal, threadId) =>
      Effect.gen(function* () {
        const { thread, ownerId } = yield* selected(principal, threadId)
        const row = yield* latest(threadId)
        return view(thread, ownerId, row?.owner_id === ownerId ? row : undefined)
      }),
    put: (request) =>
      withStableConsent(
        Effect.gen(function* () {
          const { thread, ownerId } = yield* selected(request.principal, request.threadId)
          if (!ownerId || request.principal.kind !== "member" || request.principal.userId !== ownerId)
            return yield* Effect.fail(forbidden)
          if (
            !/^[A-Za-z0-9_-]{1,160}$/.test(request.requestId) ||
            !Number.isSafeInteger(request.expectedVersion) ||
            request.expectedVersion < 0 ||
            !validContent(request.content)
          )
            return yield* Effect.fail(invalid)
          const prior = yield* byRequest(request.threadId, request.requestId)
          if (prior)
            return prior.owner_id === ownerId &&
              prior.version === request.expectedVersion + 1 &&
              isDeepStrictEqual(normalized(prior.content), normalized(request.content))
              ? view(thread, ownerId, prior)
              : yield* Effect.fail(conflict)
          const current = yield* latest(request.threadId)
          if ((current?.version ?? 0) !== request.expectedVersion) return yield* Effect.fail(conflict)
          const inserted = yield* input.db
            .insert(CooperationRevisionTable)
            .values({
              thread_id: request.threadId,
              owner_id: ownerId,
              version: request.expectedVersion + 1,
              request_id: request.requestId,
              content: normalized(request.content),
              updated_at: Date.now(),
            })
            .onConflictDoNothing()
            .returning()
            .get()
            .pipe(Effect.orDie)
          if (inserted) return view(thread, ownerId, inserted)
          const raced = yield* byRequest(request.threadId, request.requestId)
          return raced?.owner_id === ownerId &&
            raced.version === request.expectedVersion + 1 &&
            isDeepStrictEqual(normalized(raced.content), normalized(request.content))
            ? view(thread, ownerId, raced)
            : yield* Effect.fail(conflict)
        }),
      ),
    selection: {
      current: (thread) =>
        Effect.gen(function* () {
          const ownerId = yield* CoordinationProvisioning.ownerOf(input.db, thread)
          const row = yield* latest(thread.id)
          if (!ownerId || !row || row.owner_id !== ownerId || !row.content.analysisEnabled) return undefined
          return {
            ownerId,
            projectId: thread.projectId,
            sessionId: thread.sessionId,
            workerId: thread.workerId,
            featureTopic: row.content.featureTopic,
            relationship:
              row.content.relationship === "alternative" ? ("alternative" as const) : ("unspecified" as const),
            expiresAt: "9999-12-31T23:59:59.999Z",
            muted: false,
            version: row.version,
            textEnabled: row.content.analysisTextEnabled === true,
          }
        }),
    },
  }
}

function validContent(content: Coordination.CooperationContent) {
  return (
    (content.featureTopic === "" || /^[A-Za-z][A-Za-z0-9 _-]{0,79}$/.test(content.featureTopic)) &&
    !/\b(?:sk-|api[_-]?key|password|secret|token)\b/i.test(content.featureTopic) &&
    (!content.analysisEnabled || !!content.featureTopic) &&
    ["open", "complementary", "alternative"].includes(content.relationship) &&
    ["off", "notify"].includes(content.awarenessMode) &&
    (content.analysisEnabled || (content.awarenessMode === "off" && content.analysisTextEnabled !== true))
  )
}
