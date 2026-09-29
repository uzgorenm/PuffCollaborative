export * as RunnerHarnessApproval from "./approval"

import { and, eq, inArray } from "drizzle-orm"
import { Effect, Exit } from "effect"
import { createHash } from "node:crypto"
import type { Permission } from "@opencode-ai/schema/permission"
import type { PermissionV2 } from "../permission"
import type { Database } from "../database/database"
import type { RunnerHarnessContracts } from "./contracts"
import { ApprovalMappingTable } from "./approval.sql"

type Row = typeof ApprovalMappingTable.$inferSelect

export interface Dependencies {
  readonly db: Database.Interface["db"]
  readonly lifecycle: Pick<RunnerHarnessContracts.Lifecycle, "get" | "approvalRequested" | "approvalResolved">
  readonly authority: RunnerHarnessContracts.ApprovalAuthority
  readonly permission: Pick<PermissionV2.Interface, "get" | "forSession" | "reply">
  readonly redact: RunnerHarnessContracts.SecurityPolicy["redact"]
  readonly now?: () => number
}

export function make(input: Dependencies): RunnerHarnessContracts.Approvals {
  const now = input.now ?? Date.now
  const sending = new Set<string>()
  const find = (approvalId: string) =>
    input.db
      .select()
      .from(ApprovalMappingTable)
      .where(eq(ApprovalMappingTable.approval_id, approvalId))
      .get()
      .pipe(Effect.orDie)

  const requested: RunnerHarnessContracts.Approvals["requested"] = ({ execution, request }) =>
    Effect.gen(function* () {
      if (request.source?.type !== "tool")
        return yield* Effect.fail(invalid("Only tool permission requests can be approved"))
      if (request.sessionID !== execution.run.command.sessionId)
        return yield* Effect.fail(conflict("Permission belongs to another Session"))

      const approvalId = `apr_${request.id}`
      const existing = yield* find(approvalId)
      if (
        existing &&
        (existing.thread_id !== execution.run.command.threadId ||
          !sameRow(existing, execution.run.command.runId, request))
      )
        return yield* Effect.fail(conflict("Permission request identity changed"))
      if (existing?.delivery === "invalidated") return yield* Effect.fail(conflict("Approval is invalidated"))
      if (existing?.delivery === "delivered") return mapping(existing)

      const current = yield* input.lifecycle.get(execution.run.command.runId)
      if (!current || !sameExecution(current, execution) || !["running", "waiting_approval"].includes(current.phase))
        return yield* Effect.fail(conflict("Run is not executing this permission request"))

      const native = yield* input.permission.get(request.id)
      if (!native || !sameRequest(native, request))
        return yield* Effect.fail(conflict("Native permission request is missing or changed"))

      if (existing) {
        if (current.phase === "running") yield* input.lifecycle.approvalRequested(mapping(existing))
        return mapping(existing)
      }
      if (current.phase !== "running") return yield* Effect.fail(conflict("Run is already waiting for approval"))

      const toolName = input.redact(request.action).slice(0, 8_000)
      const resources = request.resources.slice(0, 8).map((resource) => input.redact(resource).slice(0, 512))
      const summary =
        `${toolName}: ${resources.join(", ")}${request.resources.length > 8 ? ` (${request.resources.length - 8} more)` : ""}`.slice(
          0,
          8_000,
        )

      const inserted = yield* input.db
        .insert(ApprovalMappingTable)
        .values({
          approval_id: approvalId,
          run_id: execution.run.command.runId,
          thread_id: execution.run.command.threadId,
          session_id: request.sessionID,
          permission_request_id: request.id,
          tool_call_id: request.source.callID,
          source_message_id: request.source.messageID,
          scope_hash: scopeHash(request),
          tool_name: toolName,
          summary,
          delivery: "pending",
          requested_at: now(),
          updated_at: now(),
        })
        .onConflictDoNothing()
        .returning({ approval_id: ApprovalMappingTable.approval_id })
        .get()
        .pipe(Effect.orDie)
      if (!inserted) {
        const raced = yield* find(approvalId)
        if (!raced || !sameRow(raced, execution.run.command.runId, request))
          return yield* Effect.fail(conflict("Another permission is already pending for this Run"))
        yield* input.lifecycle.approvalRequested(mapping(raced))
        return mapping(raced)
      }
      const row = yield* find(approvalId)
      if (!row) return yield* Effect.fail(unavailable("Approval mapping was not persisted"))
      yield* input.lifecycle.approvalRequested(mapping(row))
      return mapping(row)
    })

  const resolve: RunnerHarnessContracts.Approvals["resolve"] = (command) =>
    Effect.gen(function* () {
      const row = yield* find(command.approvalId)
      if (!row) return yield* Effect.fail({ code: "not_found" as const, message: "Approval mapping not found" })
      if (row.run_id !== command.runId || row.session_id !== command.sessionId)
        return yield* Effect.fail(conflict("Approval Run or Session mismatch"))

      const approved = yield* input.authority.verifyDecision(command)
      if (
        approved.id !== row.approval_id ||
        approved.runId !== row.run_id ||
        approved.threadId !== row.thread_id ||
        approved.toolCallId !== row.tool_call_id ||
        approved.decisionId !== command.decisionId ||
        approved.decision !== command.decision ||
        approved.state !== (command.decision === "approve" ? "approved" : "rejected") ||
        !["pending", "delivered"].includes(approved.deliveryState) ||
        (approved.deliveryState === "delivered" && row.delivery !== "delivered")
      )
        return yield* Effect.fail(conflict("Coordinator decision does not match the pending action"))

      if (row.delivery === "invalidated") return yield* Effect.fail(conflict("Approval is invalidated"))
      if (row.decision_id && (row.decision_id !== command.decisionId || row.decision !== command.decision))
        return yield* Effect.fail(conflict("Approval already has a different decision"))

      const reply = command.decision === "approve" ? "once" : "reject"
      if (row.delivery === "delivered") {
        const execution = yield* input.lifecycle.get(row.run_id)
        if (execution?.phase === "waiting_approval")
          yield* input.lifecycle.approvalResolved({
            mapping: mapping(row),
            decisionId: command.decisionId,
            nativeReply: reply,
            delivery: "delivered",
          })
        return
      }

      const execution = yield* input.lifecycle.get(row.run_id)
      if (
        !execution ||
        execution.phase !== "waiting_approval" ||
        execution.run.command.threadId !== row.thread_id ||
        execution.run.command.sessionId !== row.session_id
      )
        return yield* Effect.fail(conflict("Run is no longer waiting for this approval"))
      if (sending.has(row.approval_id)) return yield* Effect.fail(unavailable("Approval delivery is still in progress"))

      const native = yield* input.permission.get(row.permission_request_id)
      if (!native) {
        if (row.delivery === "pending") yield* invalidate({ runId: row.run_id, reason: "native_request_missing" })
        return yield* Effect.fail(unavailable("Native permission outcome is unknown"))
      }
      if (!sameRow(row, row.run_id, native)) return yield* Effect.fail(conflict("Native permission scope changed"))

      if (reply === "reject") {
        const pending = yield* input.permission.forSession(row.session_id)
        if (pending.length !== 1 || pending[0]?.id !== row.permission_request_id)
          return yield* Effect.fail(conflict("Reject would affect another pending permission"))
      }

      if (row.delivery === "pending") {
        const claimed = yield* input.db
          .update(ApprovalMappingTable)
          .set({ decision_id: command.decisionId, decision: command.decision, delivery: "unknown", updated_at: now() })
          .where(
            and(eq(ApprovalMappingTable.approval_id, row.approval_id), eq(ApprovalMappingTable.delivery, "pending")),
          )
          .returning({ approval_id: ApprovalMappingTable.approval_id })
          .get()
          .pipe(Effect.orDie)
        if (!claimed) return yield* Effect.fail(unavailable("Approval delivery changed concurrently"))
      }

      sending.add(row.approval_id)
      return yield* Effect.gen(function* () {
        const outcome = yield* Effect.exit(input.permission.reply({ requestID: row.permission_request_id, reply }))
        if (Exit.isFailure(outcome)) {
          yield* input.lifecycle.approvalResolved({
            mapping: {
              ...mapping(row),
              decisionId: command.decisionId,
              decision: command.decision,
              delivery: "unknown",
            },
            decisionId: command.decisionId,
            nativeReply: reply,
            delivery: "unknown",
          })
          return yield* Effect.fail(unavailable("Native permission reply has an unknown outcome"))
        }

        const delivered = yield* input.db
          .update(ApprovalMappingTable)
          .set({ delivery: "delivered", updated_at: now() })
          .where(
            and(
              eq(ApprovalMappingTable.approval_id, row.approval_id),
              eq(ApprovalMappingTable.decision_id, command.decisionId),
              eq(ApprovalMappingTable.delivery, "unknown"),
            ),
          )
          .returning({ approval_id: ApprovalMappingTable.approval_id })
          .get()
          .pipe(Effect.orDie)
        if (!delivered) return yield* Effect.fail(unavailable("Native reply succeeded but local delivery changed"))
        yield* input.lifecycle.approvalResolved({
          mapping: {
            ...mapping(row),
            decisionId: command.decisionId,
            decision: command.decision,
            delivery: "delivered",
          },
          decisionId: command.decisionId,
          nativeReply: reply,
          delivery: "delivered",
        })
      }).pipe(Effect.ensuring(Effect.sync(() => sending.delete(row.approval_id))))
    })

  const get: RunnerHarnessContracts.Approvals["get"] = (approvalId) =>
    Effect.map(find(approvalId), (row) => (row ? mapping(row) : undefined))

  const invalidate: RunnerHarnessContracts.Approvals["invalidate"] = ({ runId, reason }) =>
    Effect.gen(function* () {
      const active = yield* input.db
        .select({ approval_id: ApprovalMappingTable.approval_id })
        .from(ApprovalMappingTable)
        .where(
          and(eq(ApprovalMappingTable.run_id, runId), inArray(ApprovalMappingTable.delivery, ["pending", "unknown"])),
        )
        .all()
        .pipe(Effect.orDie)
      if (active.some((row) => sending.has(row.approval_id)))
        // The caller must reconcile an in-flight native reply before confirming termination.
        return yield* Effect.fail(unavailable("Approval delivery is still in progress"))
      yield* input.db
        .update(ApprovalMappingTable)
        .set({ delivery: "invalidated", invalidated_reason: reason, updated_at: now() })
        .where(
          and(eq(ApprovalMappingTable.run_id, runId), inArray(ApprovalMappingTable.delivery, ["pending", "unknown"])),
        )
        .run()
        .pipe(Effect.orDie)
    })

  return { requested, resolve, get, invalidate }
}

function mapping(row: Row): RunnerHarnessContracts.ApprovalMapping {
  return {
    runId: row.run_id,
    sessionId: row.session_id,
    permissionRequestId: row.permission_request_id,
    toolCallId: row.tool_call_id,
    toolName: row.tool_name,
    summary: row.summary,
    approvalId: row.approval_id,
    ...(row.decision_id ? { decisionId: row.decision_id } : {}),
    ...(row.decision ? { decision: row.decision } : {}),
    delivery: row.delivery,
  }
}

function sameExecution(left: RunnerHarnessContracts.LocalExecution, right: RunnerHarnessContracts.LocalExecution) {
  return (
    left.run.command.runId === right.run.command.runId &&
    left.run.command.threadId === right.run.command.threadId &&
    left.run.command.sessionId === right.run.command.sessionId &&
    left.run.command.runnerMessageId === right.run.command.runnerMessageId &&
    left.run.command.executionOwner.workerId === right.run.command.executionOwner.workerId &&
    left.run.command.executionOwner.instanceId === right.run.command.executionOwner.instanceId
  )
}

function sameRequest(left: Permission.Request, right: Permission.Request) {
  return (
    left.id === right.id &&
    left.sessionID === right.sessionID &&
    left.action === right.action &&
    left.source?.type === "tool" &&
    right.source?.type === "tool" &&
    left.source.callID === right.source.callID &&
    left.source.messageID === right.source.messageID &&
    JSON.stringify(left.resources) === JSON.stringify(right.resources) &&
    JSON.stringify(left.save) === JSON.stringify(right.save) &&
    JSON.stringify(left.metadata) === JSON.stringify(right.metadata)
  )
}

function sameRow(row: Row, runId: RunnerHarnessContracts.ApprovalMapping["runId"], request: Permission.Request) {
  return (
    row.run_id === runId &&
    row.session_id === request.sessionID &&
    row.permission_request_id === request.id &&
    request.source?.type === "tool" &&
    row.tool_call_id === request.source.callID &&
    row.source_message_id === request.source.messageID &&
    row.scope_hash === scopeHash(request)
  )
}

function scopeHash(request: Permission.Request) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        action: request.action,
        resources: request.resources,
        save: request.save,
        source: request.source,
        metadata: request.metadata,
      }),
    )
    .digest("hex")
}

function invalid(message: string): RunnerHarnessContracts.Failure {
  return { code: "invalid", message }
}

function conflict(message: string): RunnerHarnessContracts.Failure {
  return { code: "conflict", message }
}

function unavailable(message: string): RunnerHarnessContracts.Failure {
  return { code: "unavailable", message }
}
