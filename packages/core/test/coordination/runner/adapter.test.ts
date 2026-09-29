import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { Coordination } from "@opencode-ai/schema/coordination"
import type { CoordinationContracts } from "@opencode-ai/core/coordination/contracts"
import { RunnerAdapter } from "@opencode-ai/core/coordination/runner/adapter"
import { MockRunner } from "@opencode-ai/core/coordination/runner/mock"

const date = "2026-09-29T18:00:00.000Z"
const thread = Schema.decodeUnknownSync(Coordination.Thread)({
  id: "thr_runner",
  projectId: "prj_demo",
  sessionId: "ses_runner",
  workerId: "wrk_runner",
  title: "Runner test",
  createdBy: "usr_one",
  createdAt: date,
  activitySeq: 0,
})
const instruction = Schema.decodeUnknownSync(Coordination.InstructionRequest)({
  id: "ins_one",
  requestId: "req_one",
  threadId: thread.id,
  actorId: "usr_one",
  text: "Do the work",
  queueSeq: 1,
  submittedAt: date,
  runId: "run_one",
})
const initialRun = Schema.decodeUnknownSync(Coordination.Run)({
  id: instruction.runId,
  threadId: thread.id,
  instructionId: instruction.id,
  state: "queued",
  attempt: 0,
  runnerMessageId: "msg_run_one",
  createdAt: date,
})
const laterInstruction = Schema.decodeUnknownSync(Coordination.InstructionRequest)({
  id: "ins_later",
  requestId: "req_later",
  threadId: thread.id,
  actorId: "usr_two",
  text: "Do the next thing",
  queueSeq: 2,
  submittedAt: date,
  runId: "run_later",
})
const initialLaterRun = Schema.decodeUnknownSync(Coordination.Run)({
  id: laterInstruction.runId,
  threadId: thread.id,
  instructionId: laterInstruction.id,
  state: "queued",
  attempt: 0,
  runnerMessageId: "msg_later",
  createdAt: date,
})
const owner = Schema.decodeUnknownSync(Coordination.ExecutionOwner)({ workerId: thread.workerId, instanceId: "host_1" })
const runner = Schema.decodeUnknownSync(Coordination.AuthContext)({
  kind: "runner",
  workerId: thread.workerId,
  instanceId: owner.instanceId,
})
const member = Schema.decodeUnknownSync(Coordination.AuthContext)({
  kind: "member",
  userId: "usr_one",
})
const otherMember = Schema.decodeUnknownSync(Coordination.AuthContext)({
  kind: "member",
  userId: "usr_two",
})

function setup(plan: (command: CoordinationContracts.RunnerCommand) => ReadonlyArray<MockRunner.MockStep>) {
  let run: Coordination.Run = initialRun
  let laterRun: Coordination.Run = initialLaterRun
  let approval: Coordination.Approval | undefined
  let acceptedDecision: { id: string; decision: "approve" | "reject" } | undefined
  const activity: Coordination.RunnerActivity[] = []
  const seen = new Map<string, string>()
  const states: Coordination.RunState[] = []

  const access: CoordinationContracts.Access = {
    authorize: () => Effect.void,
    getThread: (principal) =>
      principal.kind === "member" && ["usr_one", "usr_two"].includes(principal.userId)
        ? Effect.succeed(thread)
        : principal.kind === "runner" &&
            principal.workerId === thread.workerId &&
            principal.instanceId === owner.instanceId
          ? Effect.succeed(thread)
          : Effect.fail({ code: "forbidden", message: "No thread access" }),
  }

  const queue: CoordinationContracts.Queue = {
    instructions: () => Effect.succeed([instruction, laterInstruction]),
    runs: () => Effect.succeed([run, laterRun]),
    submit: () => Effect.fail({ code: "unavailable", message: "Not used in this mock test" }),
    reserveNext: ({ executionOwner }) =>
      Effect.sync(() => {
        if (run.state === "queued") {
          run = { ...run, state: "reserved", attempt: 1, executionOwner }
          return { instruction, run }
        }
        if (["completed", "failed", "cancelled"].includes(run.state) && laterRun.state === "queued") {
          laterRun = { ...laterRun, state: "reserved", attempt: 1, executionOwner }
          return { instruction: laterInstruction, run: laterRun }
        }
        return undefined
      }),
    cancel: ({ instructionId }) =>
      Effect.sync(() => {
        if (instructionId !== instruction.id) return laterRun
        run = { ...run, state: run.state === "queued" ? "cancelled" : "cancelling" }
        return run
      }),
    transition: ({ runId, callbackId, callback, commitApproval }) =>
      Effect.gen(function* () {
        const current = runId === run.id ? run : laterRun
        const payload = JSON.stringify(callback)
        const prior = seen.get(callbackId)
        if (prior) {
          if (prior !== payload)
            return yield* Effect.fail({ code: "conflict" as const, message: "Callback ID conflict" })
          return current
        }
        if (
          callback.kind === "state" &&
          current.state !== callback.expectedState &&
          !(
            current.state === "recovery_required" &&
            callback.expectedState === "reserved" &&
            callback.nextState === "running"
          )
        )
          return yield* Effect.fail({ code: "conflict" as const, message: "Stale callback" })
        if (callback.kind === "activity" && current.state !== callback.state)
          return yield* Effect.fail({ code: "conflict" as const, message: "Stale activity" })
        seen.set(callbackId, payload)
        if (callback.kind === "activity") {
          activity.push(callback.activity)
          return current
        }
        if (callback.nextState === "waiting_approval" && commitApproval) yield* commitApproval(1)
        const updated = { ...current, state: callback.nextState }
        if (runId === run.id) run = updated
        else laterRun = updated
        states.push(updated.state)
        return updated
      }),
    pending: (executionOwner) =>
      Effect.succeed(
        [
          { thread, instruction, run },
          { thread, instruction: laterInstruction, run: laterRun },
        ].filter(
          (item) =>
            ["reserved", "running", "waiting_approval", "cancelling", "recovery_required"].includes(item.run.state) &&
            item.run.executionOwner?.workerId === executionOwner.workerId &&
            item.run.executionOwner.instanceId === executionOwner.instanceId,
        ),
      ),
    getRun: (runId) => Effect.succeed(runId === run.id ? run : runId === laterRun.id ? laterRun : undefined),
  }

  const approvals: RunnerAdapter.ApprovalStore = {
    list: () => Effect.succeed(approval ? [approval] : []),
    requested: (request) =>
      Effect.sync(() => {
        approval = Schema.decodeUnknownSync(Coordination.Approval)({
          id: request.approvalId,
          threadId: request.thread.id,
          runId: request.run.id,
          toolCallId: request.toolCallId,
          version: 1,
          state: "pending",
          requestedAt: date,
          deliveryState: "none",
        })
      }),
    claim: (request) =>
      Effect.gen(function* () {
        if (!approval || approval.version !== request.expectedVersion || approval.state !== "pending")
          return yield* Effect.fail({ code: "conflict" as const, message: "Approval claim conflict" })
        if (request.principal.kind !== "member")
          return yield* Effect.fail({ code: "forbidden" as const, message: "Member required" })
        approval = { ...approval, state: "claimed", claimedBy: request.principal.userId, version: 2 }
        return approval
      }),
    decide: (request) =>
      Effect.gen(function* () {
        if (!approval || approval.id !== request.approvalId)
          return yield* Effect.fail({ code: "not_found" as const, message: "Approval missing" })
        if (acceptedDecision) {
          if (acceptedDecision.id === request.decisionId && acceptedDecision.decision === request.decision)
            return approval
          return yield* Effect.fail({ code: "conflict" as const, message: "Approval already decided" })
        }
        if (approval.version !== request.expectedVersion)
          return yield* Effect.fail({ code: "conflict" as const, message: "Approval version changed" })
        if (request.principal.kind !== "member")
          return yield* Effect.fail({ code: "forbidden" as const, message: "Member required" })
        acceptedDecision = { id: request.decisionId, decision: request.decision }
        approval = {
          ...approval,
          state: request.decision === "approve" ? "approved" : "rejected",
          version: approval.version + 1,
          decisionId: request.decisionId,
          decision: request.decision,
          deliveryState: "pending",
          decidedBy: request.principal.userId,
          decidedAt: date,
        }
        return approval
      }),
    markDelivered: (approvalId, decisionId) =>
      Effect.gen(function* () {
        if (!approval || approval.id !== approvalId || approval.decisionId !== decisionId)
          return yield* Effect.fail({ code: "conflict" as const, message: "Approval decision mismatch" })
        approval = { ...approval, deliveryState: "delivered" }
        return approval
      }),
    pendingDecisions: (executionOwner) =>
      Effect.succeed(
        approval?.deliveryState === "pending" &&
          run.executionOwner?.workerId === executionOwner.workerId &&
          run.executionOwner.instanceId === executionOwner.instanceId
          ? [{ thread, approval }]
          : [],
      ),
  }

  let adapter: CoordinationContracts.Runner
  const mock = MockRunner.createMockRunner({
    report: (callback) => Effect.runPromise(adapter.report({ ...callback, principal: runner })).then(() => {}),
    plan,
  })
  adapter = RunnerAdapter.make({ access, queue, port: mock.port, approvals, now: () => Date.parse(date) })
  return {
    adapter,
    mock,
    activity,
    states,
    getRun: () => run,
    getLaterRun: () => laterRun,
    getApproval: () => approval,
    markRecoveryRequired: () => {
      run = { ...run, state: "recovery_required" }
    },
  }
}

async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return
    await Bun.sleep(5)
  }
  throw new Error("Mock runner did not reach the expected state")
}

describe("coordination runner with mocked access, queue and approval storage", () => {
  test("delivers reserved work with a stable run ID and streams activity", async () => {
    const test = setup(() => [
      { kind: "activity", activity: { kind: "run.output", text: "Working" } },
      { kind: "activity", activity: { kind: "run.tool", toolName: "read", status: "completed" } },
      { kind: "activity", activity: { kind: "run.workspace", workspaceId: "ws_1", ref: "workspace:1" } },
      { kind: "activity", activity: { kind: "run.diff", ref: "diff:1" } },
      { kind: "complete" },
    ])
    await Effect.runPromise(test.adapter.claim(runner, thread.id, owner))
    await test.mock.wait(initialRun.id)

    expect(test.mock.starts).toHaveLength(1)
    expect(test.mock.starts[0]?.runId).toBe(initialRun.id)
    expect(test.mock.starts[0]?.executionOwner).toEqual(owner)
    expect(test.activity.map((item) => item.kind)).toEqual(["run.output", "run.tool", "run.workspace", "run.diff"])
    expect(test.getRun().state).toBe("completed")
  })

  test("retains a reservation after a disconnected start and recovers the same command", async () => {
    const test = setup(() => [{ kind: "complete" }])
    test.mock.setConnected(false)
    const first = await Effect.runPromise(result(test.adapter.claim(runner, thread.id, owner)))
    expect(first.ok).toBe(false)
    expect(test.getRun().state).toBe("reserved")
    test.mock.setConnected(true)
    await Effect.runPromise(test.adapter.recoverPending(owner))
    await test.mock.wait(initialRun.id)
    expect(test.mock.starts).toHaveLength(1)
    expect(test.mock.starts[0]?.runnerMessageId).toBe(initialRun.runnerMessageId)
  })

  test("does not start a second execution when the accepted start response is lost", async () => {
    const test = setup(() => [
      { kind: "activity", activity: { kind: "run.output", text: "started" }, delayMs: 10 },
      { kind: "complete" },
    ])
    test.mock.loseNextStartResponse()
    const first = await Effect.runPromise(result(test.adapter.claim(runner, thread.id, owner)))
    expect(first.ok).toBe(false)
    await Effect.runPromise(test.adapter.recoverPending(owner))
    await test.mock.wait(initialRun.id)
    expect(test.mock.starts).toHaveLength(1)
    expect(test.getRun().state).toBe("completed")
  })

  test("retries the same Run after an unconfirmed reservation expires", async () => {
    const test = setup(() => [{ kind: "complete" }])
    test.mock.setConnected(false)
    const first = await Effect.runPromise(result(test.adapter.claim(runner, thread.id, owner)))
    expect(first.ok).toBe(false)
    test.markRecoveryRequired()
    test.mock.setConnected(true)
    await Effect.runPromise(test.adapter.recoverPending(owner))
    await test.mock.wait(initialRun.id)
    expect(test.mock.starts).toHaveLength(1)
    expect(test.mock.starts[0]?.runId).toBe(initialRun.id)
    expect(test.getRun().state).toBe("completed")
  })

  test("keeps a cancelling run occupied and retries interrupt delivery", async () => {
    const test = setup(() => [
      { kind: "approval", approvalId: "apr_interrupt", toolCallId: "tool_interrupt" },
      { kind: "complete" },
    ])
    await Effect.runPromise(test.adapter.claim(runner, thread.id, owner))
    await until(() => test.getRun().state === "waiting_approval")
    test.mock.setConnected(false)
    const cancellation = await Effect.runPromise(
      result(test.adapter.cancel({ principal: member, threadId: thread.id, instructionId: instruction.id })),
    )
    expect(cancellation.ok).toBe(false)
    expect(test.getRun().state).toBe("cancelling")
    expect(test.getLaterRun().state).toBe("queued")
    test.mock.setConnected(true)
    await Effect.runPromise(test.adapter.recoverPending(owner))
    await test.mock.wait(initialRun.id)
    expect(test.getRun().state).toBe("cancelled")
  })

  test("delivers cancellation during an approval wait without starting later work", async () => {
    const test = setup((command) =>
      command.runId === initialRun.id
        ? [{ kind: "approval", approvalId: "apr_one", toolCallId: "tool_one" }, { kind: "complete" }]
        : [{ kind: "complete" }],
    )
    await Effect.runPromise(test.adapter.claim(runner, thread.id, owner))
    await until(() => test.getRun().state === "waiting_approval")
    await Effect.runPromise(
      test.adapter.cancel({ principal: member, threadId: thread.id, instructionId: instruction.id }),
    )
    expect(test.getLaterRun().state).toBe("queued")
    await test.mock.wait(initialRun.id)
    expect(test.getRun().state).toBe("cancelled")
    expect(test.mock.starts).toHaveLength(1)
    await Effect.runPromise(test.adapter.claim(runner, thread.id, owner))
    await test.mock.wait(initialLaterRun.id)
    expect(test.getLaterRun().state).toBe("completed")
  })

  test("forwards one approval decision when members respond concurrently", async () => {
    const test = setup(() => [
      { kind: "approval", approvalId: "apr_one", toolCallId: "tool_one" },
      { kind: "complete" },
    ])
    await Effect.runPromise(test.adapter.claim(runner, thread.id, owner))
    await until(() => test.getApproval()?.state === "pending")
    const decisions = await Promise.all([
      Effect.runPromise(
        result(
          test.adapter.decideApproval({
            principal: member,
            threadId: thread.id,
            approvalId: "apr_one",
            expectedVersion: 1,
            decisionId: "dec_first",
            decision: "approve",
          }),
        ),
      ),
      Effect.runPromise(
        result(
          test.adapter.decideApproval({
            principal: otherMember,
            threadId: thread.id,
            approvalId: "apr_one",
            expectedVersion: 1,
            decisionId: "dec_second",
            decision: "reject",
          }),
        ),
      ),
    ])
    await test.mock.wait(initialRun.id)
    expect(decisions.map((item) => item.ok).sort()).toEqual([false, true])
    expect(test.mock.decisions).toHaveLength(1)
  })

  test("recovers a committed approval decision after delivery fails", async () => {
    const test = setup(() => [
      { kind: "approval", approvalId: "apr_recovery", toolCallId: "tool_recovery" },
      { kind: "complete" },
    ])
    await Effect.runPromise(test.adapter.claim(runner, thread.id, owner))
    await until(() => test.getApproval()?.state === "pending")
    test.mock.setConnected(false)
    const first = await Effect.runPromise(
      result(
        test.adapter.decideApproval({
          principal: member,
          threadId: thread.id,
          approvalId: "apr_recovery",
          expectedVersion: 1,
          decisionId: "dec_recovery",
          decision: "approve",
        }),
      ),
    )
    expect(first.ok).toBe(false)
    expect(test.getApproval()?.deliveryState).toBe("pending")
    test.mock.setConnected(true)
    await Effect.runPromise(test.adapter.recoverPending(owner))
    await test.mock.wait(initialRun.id)
    expect(test.mock.decisions).toEqual([{ runId: initialRun.id, decisionId: "dec_recovery" }])
    expect(test.getApproval()?.deliveryState).toBe("delivered")
  })

  test("deduplicates repeated callbacks and rejects untrusted or stale ones", async () => {
    const test = setup(() => [
      { kind: "activity", activity: { kind: "run.output", text: "once" }, duplicate: true },
      { kind: "complete", duplicate: true },
    ])
    await Effect.runPromise(test.adapter.claim(runner, thread.id, owner))
    await test.mock.wait(initialRun.id)
    expect(test.activity).toHaveLength(1)
    expect(test.states.filter((state) => state === "completed")).toHaveLength(1)

    const untrusted = await Effect.runPromise(
      result(
        test.adapter.report({
          principal: member,
          runId: initialRun.id,
          callbackId: "forged",
          callback: { kind: "activity", state: "running", activity: { kind: "run.output", text: "forged" } },
        }),
      ),
    )
    expect(untrusted.ok).toBe(false)
    if (!untrusted.ok) expect(untrusted.error.code).toBe("forbidden")

    const wrongInstance = await Effect.runPromise(
      result(
        test.adapter.report({
          principal: { kind: "runner", workerId: thread.workerId, instanceId: "other_host" },
          runId: initialRun.id,
          callbackId: "wrong_instance",
          callback: { kind: "activity", state: "running", activity: { kind: "run.output", text: "forged" } },
        }),
      ),
    )
    expect(wrongInstance.ok).toBe(false)
    if (!wrongInstance.ok) expect(wrongInstance.error.code).toBe("forbidden")

    const stale = await Effect.runPromise(
      result(
        test.adapter.report({
          principal: runner,
          runId: initialRun.id,
          callbackId: "stale",
          callback: { kind: "state", expectedState: "running", nextState: "completed" },
        }),
      ),
    )
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.error.code).toBe("conflict")
  })
})

function result<A>(effect: Effect.Effect<A, CoordinationContracts.Failure>) {
  return Effect.match(effect, {
    onFailure: (error) => ({ ok: false as const, error }),
    onSuccess: (value) => ({ ok: true as const, value }),
  })
}
