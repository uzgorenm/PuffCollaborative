import { describe, expect } from "bun:test"
import { Effect, Schema, Redacted } from "effect"
import { Coordination } from "@opencode-ai/schema/coordination"
import { Permission } from "@opencode-ai/schema/permission"
import { Session } from "@opencode-ai/schema/session"
import { RunnerHarnessApproval } from "@opencode-ai/core/runner-harness/approval"
import { Database } from "@opencode-ai/core/database/database"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { RunnerRedaction } from "@opencode-ai/core/runner-harness/security/redaction"
import type { RunnerHarnessContracts } from "@opencode-ai/core/runner-harness/contracts"
import migration from "@opencode-ai/core/database/migration/20260929202000_runner_harness_approval"
import { testEffect } from "../lib/effect"

const it = testEffect(Database.layerFromPath(":memory:"))
const runId = Schema.decodeUnknownSync(Coordination.RunID)("run_approval_bridge")
const threadId = Schema.decodeUnknownSync(Coordination.ThreadID)("thr_approval_bridge")
const projectId = Schema.decodeUnknownSync(Coordination.ProjectID)("prj_approval_bridge")
const workerId = Schema.decodeUnknownSync(Coordination.WorkerID)("wrk_approval_bridge")
const sessionId = Schema.decodeUnknownSync(Session.ID)("ses_approval_bridge")

function fixture(db: Database.Interface["db"], redact: (text: string) => string = (text) => text.replaceAll("inert", "[redacted]")) {
  const request = Schema.decodeUnknownSync(Permission.Request)({
    id: "per_approval_bridge",
    sessionID: sessionId,
    action: "bash",
    resources: ["echo inert"],
    save: ["*"],
    source: { type: "tool", messageID: "msg_tool_call", callID: "call_approval_bridge" },
  })
  const pending = new Map([[request.id, request]])
  const replies: Permission.Reply[] = []
  const results: RunnerHarnessContracts.ApprovalResult[] = []
  const execution: RunnerHarnessContracts.LocalExecution = {
    run: {
      command: {
        runId,
        threadId,
        sessionId,
        executionOwner: { workerId, instanceId: "instance_approval_bridge" },
        runnerMessageId: "msg_approval_bridge",
        text: "An inert test turn",
      },
      projectId,
      attempt: 1,
      session: {} as Session.Info,
    },
    phase: "running",
  }
  let current = execution
  let transport: "ok" | "lost_before" | "lost_after" = "ok"
  let authenticated = true
  let authorityDelivery: "pending" | "delivered" = "pending"
  let authorizedDecision: { readonly id: string; readonly decision: "approve" | "reject" } | undefined
  let tool: { name: string; input: Readonly<Record<string, unknown>> } | undefined = { name: "bash", input: { command: "echo inert" } }

  const lifecycle: Pick<RunnerHarnessContracts.Lifecycle, "get" | "approvalRequested" | "approvalResolved"> = {
    get: () => Effect.succeed(current),
    approvalRequested: () =>
      Effect.sync(() => {
        current = { ...current, phase: "waiting_approval" }
        return current
      }),
    approvalResolved: (result) =>
      Effect.sync(() => {
        results.push(result)
        if (result.delivery === "delivered") current = { ...current, phase: "running" }
        return current
      }),
  }
  const permission: Pick<PermissionV2.Interface, "get" | "forSession" | "reply"> = {
    get: (id) => Effect.succeed(pending.get(id)),
    forSession: (id) => Effect.succeed([...pending.values()].filter((item) => item.sessionID === id)),
    reply: ({ requestID, reply }) =>
      Effect.gen(function* () {
        replies.push(reply)
        if (transport === "lost_before") return yield* new PermissionV2.NotFoundError({ requestID })
        pending.delete(requestID)
        if (transport === "lost_after") return yield* new PermissionV2.NotFoundError({ requestID })
      }),
  }
  const authority: RunnerHarnessContracts.ApprovalAuthority = {
    verifyDecision: (command) => {
      if (!authenticated) return Effect.fail({ code: "forbidden", message: "No authenticated coordinator decision" })
      return Effect.succeed(
        Schema.decodeUnknownSync(Coordination.Approval)({
          id: command.approvalId,
          threadId,
          runId,
          toolCallId: request.source?.type === "tool" ? request.source.callID : "",
          version: 2,
          state: authorizedDecision?.decision === "reject" ? "rejected" : "approved",
          requestedAt: "2026-09-29T20:20:00.000Z",
          decisionId: authorizedDecision?.id,
          decision: authorizedDecision?.decision,
          deliveryState: authorityDelivery,
        }),
      )
    },
  }
  const reopen = () =>
    RunnerHarnessApproval.make({
      db,
      lifecycle,
      permission,
      authority,
      redact,
      toolCall: ({ sessionId: actualSession, messageId, callId }) => Effect.succeed(actualSession === sessionId && messageId === "msg_tool_call" && callId === "call_approval_bridge" ? tool : undefined),
      now: () => 1_000,
    })
  const bridge = reopen()
  const command = (approvalId: string, decision: "approve" | "reject", decisionId = "dec_approval_bridge") => {
    authorizedDecision = { id: decisionId, decision }
    return { approvalId, decisionId, runId, sessionId, decision }
  }

  return {
    bridge,
    reopen,
    request,
    pending,
    replies,
    results,
    execution,
    command,
    setPhase: (phase: RunnerHarnessContracts.LocalPhase) => {
      current = { ...current, phase }
    },
    setTransport: (value: typeof transport) => {
      transport = value
    },
    setAuthenticated: (value: boolean) => {
      authenticated = value
    },
    setAuthorityDelivery: (value: typeof authorityDelivery) => {
      authorityDelivery = value
    },
    setDecision: (id: string, decision: "approve" | "reject") => {
      authorizedDecision = { id, decision }
    },
    setTool: (value: typeof tool) => { tool = value },
  }
}

describe("runner approval bridge with real SQLite and inert native permission actions", () => {
  it.effect("redacts secret fields while retaining valid reviewable JSON arguments", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* DatabaseMigration.applyOnly(db, [migration])
      const test = fixture(db, RunnerRedaction.make([Redacted.make("registered-fixture-secret")]))
      const native = Schema.decodeUnknownSync(Permission.Request)({ ...test.request, metadata: { password: "unregistered-fixture-secret", description: "registered-fixture-secret" } })
      test.pending.set(native.id, native)
      test.setTool({ name: "bash", input: { command: "echo safe", headers: { authorization: "Bearer fixture-value" }, password: "unregistered-fixture-secret" } })
      const mapped = yield* test.bridge.requested({ execution: test.execution, request: native })
      const approval = Schema.decodeUnknownSync(Coordination.Approval)({ id: mapped.approvalId, threadId, runId, toolCallId: mapped.toolCallId, version: 1, state: "pending", requestedAt: "2026-09-29T20:20:00.000Z", deliveryState: "none" })
      const thread = Schema.decodeUnknownSync(Coordination.Thread)({ id: threadId, projectId, sessionId, workerId, title: "Actual approval", createdBy: "usr_alice", createdAt: "2026-09-29T20:20:00.000Z", activitySeq: 0 })
      const review = yield* test.bridge.review(approval, thread)
      expect(review?.complete).toBe(true)
      expect(JSON.parse(review!.inputJson!)).toEqual({ command: "echo safe", headers: { authorization: "[REDACTED]" }, password: "[REDACTED]" })
      expect(JSON.parse(review!.metadataJson!)).toEqual({ password: "[REDACTED]", description: "[REDACTED]" })
    }),
  )

  it.effect("reviews only an exact durable mapping and current native scope after reopening", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* DatabaseMigration.applyOnly(db, [migration])
      const test = fixture(db)
      const native = Schema.decodeUnknownSync(Permission.Request)({ ...test.request, metadata: { command: "echo inert" } })
      test.pending.set(native.id, native)
      const mapped = yield* test.bridge.requested({ execution: test.execution, request: native })
      const approval = Schema.decodeUnknownSync(Coordination.Approval)({ id: mapped.approvalId, threadId, runId, toolCallId: mapped.toolCallId, version: 1, state: "pending", requestedAt: "2026-09-29T20:20:00.000Z", deliveryState: "none" })
      const thread = Schema.decodeUnknownSync(Coordination.Thread)({ id: threadId, projectId, sessionId, workerId, title: "Actual approval", createdBy: "usr_alice", createdAt: "2026-09-29T20:20:00.000Z", activitySeq: 0 })
      const review = yield* test.reopen().review(approval, thread)
      expect(review).toMatchObject({ permissionRequestId: native.id, sessionId, toolCallId: mapped.toolCallId, sourceMessageId: "msg_tool_call", toolName: "bash", inputJson: '{"command":"echo [redacted]"}', permission: "bash", patterns: ["echo [redacted]"], savePatterns: ["*"], metadataJson: '{"command":"echo [redacted]"}', complete: true })
      expect(review?.scopeHash).toMatch(/^[a-f0-9]{64}$/)
      expect(yield* test.bridge.review({ ...approval, toolCallId: "call_other" }, thread)).toBeUndefined()
      test.pending.set(native.id, { ...native, resources: ["changed native scope"] })
      expect(yield* test.bridge.review(approval, thread)).toBeUndefined()
      test.pending.set(native.id, native)
      test.setTool(undefined)
      expect((yield* test.bridge.review(approval, thread))?.complete).toBe(false)
      expect((yield* test.bridge.review(approval, thread))?.inputJson).toBeUndefined()
      test.setPhase("completed")
      expect(yield* test.bridge.review(approval, thread)).toBeUndefined()
      test.setPhase("waiting_approval")
      test.pending.delete(native.id)
      expect(yield* test.bridge.review(approval, thread)).toBeUndefined()
    }),
  )

  it.effect("marks bounded permission details incomplete instead of silently hiding scope", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* DatabaseMigration.applyOnly(db, [migration])
      const test = fixture(db)
      const native = Schema.decodeUnknownSync(Permission.Request)({ ...test.request, resources: ["x".repeat(2_000)], metadata: { command: "y".repeat(20_000) } })
      test.pending.set(native.id, native)
      const mapped = yield* test.bridge.requested({ execution: test.execution, request: native })
      const approval = Schema.decodeUnknownSync(Coordination.Approval)({ id: mapped.approvalId, threadId, runId, toolCallId: mapped.toolCallId, version: 1, state: "pending", requestedAt: "2026-09-29T20:20:00.000Z", deliveryState: "none" })
      const thread = Schema.decodeUnknownSync(Coordination.Thread)({ id: threadId, projectId, sessionId, workerId, title: "Actual approval", createdBy: "usr_alice", createdAt: "2026-09-29T20:20:00.000Z", activitySeq: 0 })
      const review = yield* test.bridge.review(approval, thread)
      expect(review?.complete).toBe(false)
      expect(review?.patterns[0].length).toBeLessThanOrEqual(512)
      expect(review?.metadataJson?.length).toBeLessThanOrEqual(8_000)
    }),
  )

  it.effect("maps one coordinator approval to native once and persists an exact retry", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* DatabaseMigration.applyOnly(db, [migration])
      const test = fixture(db)
      const mapped = yield* test.bridge.requested({ execution: test.execution, request: test.request })
      expect(mapped).toMatchObject({
        runId,
        sessionId,
        permissionRequestId: test.request.id,
        toolCallId: "call_approval_bridge",
      })
      expect(mapped.toolName).toBe("bash")
      expect(mapped.summary).toBe("bash: echo [redacted]")
      expect(yield* test.bridge.requested({ execution: test.execution, request: test.request })).toEqual(mapped)
      const decision = test.command(mapped.approvalId, "approve")
      yield* test.bridge.resolve(decision)
      yield* test.reopen().resolve(decision)
      expect((yield* test.bridge.requested({ execution: test.execution, request: test.request })).delivery).toBe(
        "delivered",
      )
      expect(test.replies).toEqual(["once"])
      expect((yield* test.bridge.get(mapped.approvalId))?.delivery).toBe("delivered")
      expect(test.results.at(-1)?.nativeReply).toBe("once")
    }),
  )

  it.effect("rejects only the sole pending native permission", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* DatabaseMigration.applyOnly(db, [migration])
      const test = fixture(db)
      const mapped = yield* test.bridge.requested({ execution: test.execution, request: test.request })
      yield* test.bridge.resolve(test.command(mapped.approvalId, "reject"))
      expect(test.replies).toEqual(["reject"])
      expect((yield* test.bridge.get(mapped.approvalId))?.delivery).toBe("delivered")
    }),
  )

  it.effect("blocks a reject that would cascade to another pending permission", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* DatabaseMigration.applyOnly(db, [migration])
      const test = fixture(db)
      const mapped = yield* test.bridge.requested({ execution: test.execution, request: test.request })
      const other = Schema.decodeUnknownSync(Permission.Request)({
        ...test.request,
        id: "per_another_action",
        source: { type: "tool", messageID: "msg_tool_call", callID: "call_another_action" },
      })
      test.pending.set(other.id, other)
      const failure = yield* test.bridge
        .resolve(test.command(mapped.approvalId, "reject"))
        .pipe(Effect.match({ onFailure: (error) => error, onSuccess: () => undefined }))
      expect(failure?.code).toBe("conflict")
      expect(test.replies).toEqual([])
      expect((yield* test.bridge.get(mapped.approvalId))?.delivery).toBe("pending")
    }),
  )

  it.effect("rejects changed, unauthenticated, wrong-Run, wrong-Session, and stale decisions", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* DatabaseMigration.applyOnly(db, [migration])
      const test = fixture(db)
      const mapped = yield* test.bridge.requested({ execution: test.execution, request: test.request })
      const decision = test.command(mapped.approvalId, "approve")
      const wrongThread = {
        ...test.execution,
        run: {
          ...test.execution.run,
          command: {
            ...test.execution.run.command,
            threadId: Schema.decodeUnknownSync(Coordination.ThreadID)("thr_wrong"),
          },
        },
      }
      expect(
        (yield* test.bridge
          .requested({ execution: wrongThread, request: test.request })
          .pipe(Effect.match({ onFailure: (e) => e, onSuccess: () => undefined })))?.code,
      ).toBe("conflict")
      test.setAuthenticated(false)
      expect(
        (yield* test.bridge.resolve(decision).pipe(Effect.match({ onFailure: (e) => e, onSuccess: () => undefined })))
          ?.code,
      ).toBe("forbidden")
      test.setAuthenticated(true)
      expect(
        (yield* test.bridge
          .resolve({ ...decision, runId: Schema.decodeUnknownSync(Coordination.RunID)("run_wrong") })
          .pipe(Effect.match({ onFailure: (e) => e, onSuccess: () => undefined })))?.code,
      ).toBe("conflict")
      expect(
        (yield* test.bridge
          .resolve({ ...decision, sessionId: Schema.decodeUnknownSync(Session.ID)("ses_wrong") })
          .pipe(Effect.match({ onFailure: (e) => e, onSuccess: () => undefined })))?.code,
      ).toBe("conflict")
      test.setAuthorityDelivery("delivered")
      expect(
        (yield* test.bridge.resolve(decision).pipe(Effect.match({ onFailure: (e) => e, onSuccess: () => undefined })))
          ?.code,
      ).toBe("conflict")
      test.setAuthorityDelivery("pending")
      test.setPhase("completed")
      expect(
        (yield* test.bridge.resolve(decision).pipe(Effect.match({ onFailure: (e) => e, onSuccess: () => undefined })))
          ?.code,
      ).toBe("conflict")
      expect(test.replies).toEqual([])
    }),
  )

  it.effect("invalidates a pending approval when its Run is cancelled", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* DatabaseMigration.applyOnly(db, [migration])
      const test = fixture(db)
      const mapped = yield* test.bridge.requested({ execution: test.execution, request: test.request })
      yield* test.bridge.invalidate({ runId, reason: "cancelled" })
      expect((yield* test.bridge.get(mapped.approvalId))?.delivery).toBe("invalidated")
      expect(
        (yield* test.bridge
          .resolve(test.command(mapped.approvalId, "approve"))
          .pipe(Effect.match({ onFailure: (e) => e, onSuccess: () => undefined })))?.code,
      ).toBe("conflict")
      expect(test.replies).toEqual([])
    }),
  )

  it.effect("keeps an ambiguous reply unknown and never sends a contradictory decision", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* DatabaseMigration.applyOnly(db, [migration])
      const test = fixture(db)
      const mapped = yield* test.bridge.requested({ execution: test.execution, request: test.request })
      const decision = test.command(mapped.approvalId, "approve")
      test.setTransport("lost_after")
      expect(
        (yield* test.bridge.resolve(decision).pipe(Effect.match({ onFailure: (e) => e, onSuccess: () => undefined })))
          ?.code,
      ).toBe("unavailable")
      expect((yield* test.bridge.get(mapped.approvalId))?.delivery).toBe("unknown")
      expect(
        (yield* test
          .reopen()
          .resolve(decision)
          .pipe(Effect.match({ onFailure: (e) => e, onSuccess: () => undefined })))?.code,
      ).toBe("unavailable")
      test.setDecision("dec_conflicting", "reject")
      expect(
        (yield* test.bridge
          .resolve({ ...decision, decisionId: "dec_conflicting", decision: "reject" })
          .pipe(Effect.match({ onFailure: (e) => e, onSuccess: () => undefined })))?.code,
      ).toBe("conflict")
      expect(test.replies).toEqual(["once"])
    }),
  )

  it.effect("reconciles a failed send when the exact native request is still pending", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* DatabaseMigration.applyOnly(db, [migration])
      const test = fixture(db)
      const mapped = yield* test.bridge.requested({ execution: test.execution, request: test.request })
      const decision = test.command(mapped.approvalId, "approve")
      test.setTransport("lost_before")
      expect(
        (yield* test.bridge.resolve(decision).pipe(Effect.match({ onFailure: (e) => e, onSuccess: () => undefined })))
          ?.code,
      ).toBe("unavailable")
      expect(test.pending.has(test.request.id)).toBe(true)
      test.setTransport("ok")
      yield* test.bridge.resolve(decision)
      expect((yield* test.bridge.get(mapped.approvalId))?.delivery).toBe("delivered")
      expect(test.replies).toEqual(["once", "once"])
    }),
  )

  it.effect("treats a user question as a separate interaction and never uses remembered approval", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* DatabaseMigration.applyOnly(db, [migration])
      const test = fixture(db)
      const question = Schema.decodeUnknownSync(Permission.Request)({
        id: "per_question",
        sessionID: sessionId,
        action: "question",
        resources: ["What should I do next?"],
      })
      const failure = yield* test.bridge
        .requested({ execution: test.execution, request: question })
        .pipe(Effect.match({ onFailure: (error) => error, onSuccess: () => undefined }))
      expect(failure?.code).toBe("invalid")
      const mapped = yield* test.bridge.requested({ execution: test.execution, request: test.request })
      yield* test.bridge.resolve(test.command(mapped.approvalId, "approve"))
      expect(test.replies).toEqual(["once"])
    }),
  )
})
