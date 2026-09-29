export * as CoordinationApproval from "./store"

import { and, asc, eq } from "drizzle-orm"
import { Effect } from "effect"
import type { Coordination } from "@opencode-ai/schema/coordination"
import type { CoordinationContracts } from "../contracts"
import type { Database } from "../../database/database"
import type { ApprovalStore } from "../runner/adapter"
import { ApprovalTable } from "./sql"

type Row = typeof ApprovalTable.$inferSelect

export interface Dependencies {
  readonly db: Database.Interface["db"]
  readonly events: CoordinationContracts.Events
  readonly access: CoordinationContracts.Access
  readonly queue: CoordinationContracts.Queue
  readonly now?: () => number
  readonly claimMs?: number
}

export function make(input: Dependencies): ApprovalStore {
  const now = input.now ?? Date.now
  const claimMs = input.claimMs ?? 30_000

  const find = (approvalId: string) =>
    input.db.select().from(ApprovalTable).where(eq(ApprovalTable.id, approvalId)).get().pipe(Effect.orDie)

  const requested: ApprovalStore["requested"] = (request) =>
    Effect.gen(function* () {
      if (
        request.run.threadId !== request.thread.id ||
        request.thread.workerId !== request.run.executionOwner?.workerId
      )
        return yield* Effect.fail(conflict("Approval execution ownership mismatch"))
      const inserted = yield* input.db
        .insert(ApprovalTable)
        .values({
          id: request.approvalId,
          project_id: request.thread.projectId,
          thread_id: request.thread.id,
          run_id: request.run.id,
          tool_call_id: request.toolCallId,
          version: 1,
          state: "pending",
          requested_at: now(),
          requested_seq: request.seq,
          delivery_state: "none",
        })
        .onConflictDoNothing()
        .returning({ id: ApprovalTable.id })
        .get()
        .pipe(Effect.orDie)
      if (!inserted) return yield* Effect.fail(conflict("Approval ID already exists"))
    })

  const claim: ApprovalStore["claim"] = (request) =>
    Effect.gen(function* () {
      if (request.principal.kind !== "member") return yield* Effect.fail(forbidden("Member credential required"))
      const actor = request.principal.userId
      const row = yield* find(request.approvalId)
      if (!row || row.thread_id !== request.threadId) return yield* Effect.fail(notFound())
      const run = yield* input.queue.getRun(row.run_id)
      if (!run || run.threadId !== row.thread_id || run.state !== "waiting_approval")
        return yield* Effect.fail(conflict("Run is no longer waiting for approval"))
      const time = now()
      if (row.state === "claimed" && row.claimed_by === actor && (row.claim_expires_at ?? 0) > time)
        return approval(row)
      if (
        row.version !== request.expectedVersion ||
        (row.state !== "pending" && !(row.state === "claimed" && (row.claim_expires_at ?? 0) <= time))
      )
        return yield* Effect.fail(conflict("Approval version or claim changed"))
      const version = row.version + 1
      yield* input.events.append(
        {
          projectId: row.project_id,
          threadId: row.thread_id,
          kind: "run.approval.requested",
          occurredAt: new Date(time).toISOString(),
          actorId: actor,
          runId: row.run_id,
          payload: { approvalId: row.id, state: "claimed", version },
        },
        () =>
          Effect.gen(function* () {
            const updated = yield* input.db
              .update(ApprovalTable)
              .set({ state: "claimed", version, claimed_by: actor, claim_expires_at: time + claimMs })
              .where(
                and(
                  eq(ApprovalTable.id, row.id),
                  eq(ApprovalTable.version, row.version),
                  eq(ApprovalTable.state, row.state),
                ),
              )
              .returning({ id: ApprovalTable.id })
              .get()
              .pipe(Effect.orDie)
            if (!updated) return yield* Effect.fail(conflict("Approval claim lost the version race"))
          }),
      )
      const current = yield* find(row.id)
      if (!current) return yield* Effect.fail(notFound())
      return approval(current)
    })

  const decide: ApprovalStore["decide"] = (request) =>
    Effect.gen(function* () {
      if (request.principal.kind !== "member") return yield* Effect.fail(forbidden("Member credential required"))
      const actor = request.principal.userId
      const row = yield* find(request.approvalId)
      if (!row || row.thread_id !== request.threadId) return yield* Effect.fail(notFound())
      if (row.decision_id) {
        if (row.decision_id === request.decisionId && row.decision === request.decision && row.decided_by === actor)
          return approval(row)
        return yield* Effect.fail(conflict("Approval already decided"))
      }
      const run = yield* input.queue.getRun(row.run_id)
      if (!run || run.threadId !== row.thread_id || run.state !== "waiting_approval")
        return yield* Effect.fail(conflict("Run is no longer waiting for approval"))
      const time = now()
      if (row.version !== request.expectedVersion || (row.state !== "pending" && row.state !== "claimed"))
        return yield* Effect.fail(conflict("Approval version or state changed"))
      if (row.state === "claimed" && row.claimed_by !== actor && (row.claim_expires_at ?? 0) > time)
        return yield* Effect.fail(conflict("Approval is claimed by another member"))
      const version = row.version + 1
      yield* input.events.append(
        {
          projectId: row.project_id,
          threadId: row.thread_id,
          kind: "run.approval.resolved",
          occurredAt: new Date(time).toISOString(),
          actorId: actor,
          runId: row.run_id,
          payload: {
            approvalId: row.id,
            decisionId: request.decisionId,
            decision: request.decision,
            deliveryState: "pending",
            version,
          },
        },
        () =>
          Effect.gen(function* () {
            const updated = yield* input.db
              .update(ApprovalTable)
              .set({
                state: request.decision === "approve" ? "approved" : "rejected",
                version,
                decision_id: request.decisionId,
                decision: request.decision,
                delivery_state: "pending",
                decided_by: actor,
                decided_at: time,
              })
              .where(
                and(
                  eq(ApprovalTable.id, row.id),
                  eq(ApprovalTable.version, row.version),
                  eq(ApprovalTable.state, row.state),
                ),
              )
              .returning({ id: ApprovalTable.id })
              .get()
              .pipe(Effect.orDie)
            if (!updated) return yield* Effect.fail(conflict("Approval decision lost the version race"))
          }),
      )
      const current = yield* find(row.id)
      if (!current) return yield* Effect.fail(notFound())
      return approval(current)
    })

  const markDelivered: ApprovalStore["markDelivered"] = (approvalId, decisionId) =>
    Effect.gen(function* () {
      const row = yield* find(approvalId)
      if (!row) return yield* Effect.fail(notFound())
      if (row.decision_id !== decisionId) return yield* Effect.fail(conflict("Approval decision mismatch"))
      if (row.delivery_state === "delivered") return approval(row)
      if (row.delivery_state !== "pending") return yield* Effect.fail(conflict("Approval delivery is not pending"))
      const version = row.version + 1
      yield* input.events.append(
        {
          projectId: row.project_id,
          threadId: row.thread_id,
          kind: "run.approval.resolved",
          occurredAt: new Date(now()).toISOString(),
          runId: row.run_id,
          payload: { approvalId, decisionId, deliveryState: "delivered", version },
        },
        () =>
          Effect.gen(function* () {
            const updated = yield* input.db
              .update(ApprovalTable)
              .set({ delivery_state: "delivered", version })
              .where(
                and(
                  eq(ApprovalTable.id, approvalId),
                  eq(ApprovalTable.version, row.version),
                  eq(ApprovalTable.decision_id, decisionId),
                  eq(ApprovalTable.delivery_state, "pending"),
                ),
              )
              .returning({ id: ApprovalTable.id })
              .get()
              .pipe(Effect.orDie)
            if (!updated) return yield* Effect.fail(conflict("Approval delivery changed"))
          }),
      )
      const current = yield* find(approvalId)
      if (!current) return yield* Effect.fail(notFound())
      return approval(current)
    })

  const pendingDecisions: ApprovalStore["pendingDecisions"] = (executionOwner, threadId) =>
    Effect.gen(function* () {
      const rows = yield* input.db
        .select()
        .from(ApprovalTable)
        .where(
          threadId
            ? and(eq(ApprovalTable.delivery_state, "pending"), eq(ApprovalTable.thread_id, threadId))
            : eq(ApprovalTable.delivery_state, "pending"),
        )
        .orderBy(asc(ApprovalTable.requested_at))
        .all()
        .pipe(Effect.orDie)
      const principal: Coordination.AuthContext = {
        kind: "runner",
        workerId: executionOwner.workerId,
        instanceId: executionOwner.instanceId,
      }
      const result: { thread: Coordination.Thread; approval: Coordination.Approval }[] = []
      for (const row of rows) {
        const run = yield* input.queue.getRun(row.run_id)
        if (
          !run?.executionOwner ||
          run.executionOwner.workerId !== executionOwner.workerId ||
          run.executionOwner.instanceId !== executionOwner.instanceId
        )
          continue
        const thread = yield* input.access.getThread(principal, row.thread_id, "runner")
        result.push({ thread, approval: approval(row) })
      }
      return result
    })

  const list = (threadId: Coordination.ThreadID) =>
    Effect.gen(function* () {
      const rows = yield* input.db
        .select()
        .from(ApprovalTable)
        .where(eq(ApprovalTable.thread_id, threadId))
        .orderBy(asc(ApprovalTable.requested_at))
        .all()
        .pipe(Effect.orDie)
      return rows.map(approval)
    })

  return { requested, claim, decide, markDelivered, pendingDecisions, list }
}

function approval(row: Row): Coordination.Approval {
  return {
    id: row.id,
    threadId: row.thread_id,
    runId: row.run_id,
    toolCallId: row.tool_call_id,
    version: row.version,
    state: row.state,
    requestedAt: new Date(row.requested_at).toISOString(),
    ...(row.claimed_by ? { claimedBy: row.claimed_by } : {}),
    ...(row.claim_expires_at ? { claimExpiresAt: new Date(row.claim_expires_at).toISOString() } : {}),
    ...(row.decision_id ? { decisionId: row.decision_id } : {}),
    ...(row.decision ? { decision: row.decision } : {}),
    deliveryState: row.delivery_state,
    ...(row.decided_by ? { decidedBy: row.decided_by } : {}),
    ...(row.decided_at ? { decidedAt: new Date(row.decided_at).toISOString() } : {}),
  }
}

function conflict(message: string): CoordinationContracts.Failure {
  return { code: "conflict", message }
}

function forbidden(message: string): CoordinationContracts.Failure {
  return { code: "forbidden", message }
}

function notFound(): CoordinationContracts.Failure {
  return { code: "not_found", message: "Approval not found" }
}
