import { describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { Coordination } from "@opencode-ai/schema/coordination"
import type { CoordinationContracts } from "@opencode-ai/core/coordination/contracts"
import { CoordinationEvents } from "@opencode-ai/core/coordination/events/events"
import { CoordinationQueue } from "@opencode-ai/core/coordination/queue/queue"
import { CoordinationApproval } from "@opencode-ai/core/coordination/approval/store"
import { RunnerAdapter } from "@opencode-ai/core/coordination/runner/adapter"
import { MockRunner } from "@opencode-ai/core/coordination/runner/mock"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import queueMigration from "@opencode-ai/core/database/migration/20260929193000_coordination_queue"
import approvalMigration from "@opencode-ai/core/database/migration/20260929190000_coordination_runner_approval"
import { testEffect } from "../../lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, CoordinationEvents.node])))
const date = "2026-09-29T18:00:00.000Z"
const thread = Schema.decodeUnknownSync(Coordination.Thread)({
  id: "thr_runner_integration",
  projectId: "prj_runner_integration",
  sessionId: "ses_runner_integration",
  workerId: "wrk_runner_integration",
  title: "Runner integration",
  createdBy: "usr_runner_integration",
  createdAt: date,
  activitySeq: 0,
})
const member = Schema.decodeUnknownSync(Coordination.AuthContext)({ kind: "member", userId: thread.createdBy })
const secondMember = Schema.decodeUnknownSync(Coordination.AuthContext)({ kind: "member", userId: "usr_second" })
const owner = Schema.decodeUnknownSync(Coordination.ExecutionOwner)({
  workerId: thread.workerId,
  instanceId: "host_integration",
})
const runner = Schema.decodeUnknownSync(Coordination.AuthContext)({ kind: "runner", ...owner })

const access: CoordinationContracts.Access = {
  authorize: () => Effect.void,
  getThread: (principal, threadId) =>
    threadId === thread.id &&
    (principal.kind === "member" ||
      (principal.kind === "runner" &&
        principal.workerId === thread.workerId &&
        principal.instanceId === owner.instanceId))
      ? Effect.succeed(thread)
      : Effect.fail({ code: "forbidden", message: "Fixture access denied" }),
}

const services = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  const events = yield* CoordinationEvents.Service
  yield* db
    .transaction((tx) =>
      Effect.gen(function* () {
        yield* queueMigration.up(tx)
        yield* approvalMigration.up(tx)
      }),
    )
    .pipe(Effect.orDie)
  const queue = CoordinationQueue.make({ db, access, events, now: () => Date.parse(date) })
  const approvals = CoordinationApproval.make({ db, events, access, queue, now: () => Date.parse(date) })
  return { queue, approvals, events }
})

describe("coordination runner with real Queue, SQLite and EventV2; mocked Access and execution port", () => {
  it.effect("commits streamed output and tool activity once with their Run", () =>
    Effect.gen(function* () {
      const { queue, approvals, events } = yield* services
      let adapter: CoordinationContracts.Runner
      const mock = MockRunner.createMockRunner({
        report: (callback) => Effect.runPromise(adapter.report({ ...callback, principal: runner })).then(() => {}),
        plan: () => [
          { kind: "activity", activity: { kind: "run.output", text: "working" }, duplicate: true },
          { kind: "activity", activity: { kind: "run.tool", toolName: "read", status: "completed" }, duplicate: true },
          { kind: "complete", duplicate: true },
        ],
      })
      adapter = RunnerAdapter.make({ access, queue, port: mock.port, approvals, now: () => Date.parse(date) })

      const accepted = yield* queue.submit({
        principal: member,
        threadId: thread.id,
        requestId: "req_integrated",
        text: "Do the work",
      })
      const claimed = yield* adapter.claim(runner, thread.id, owner)
      expect(claimed?.id).toBe(accepted.run.id)
      yield* Effect.promise(() => mock.wait(accepted.run.id))

      const stored = yield* queue.getRun(accepted.run.id)
      expect(stored?.state).toBe("completed")
      const page = yield* events.replayProject(thread.projectId, -1, 20)
      expect(page.events.filter((event) => event.kind === "run.output")).toHaveLength(1)
      expect(page.events.filter((event) => event.kind === "run.tool")).toHaveLength(1)
      expect(page.events.filter((event) => event.kind === "run.completed")).toHaveLength(1)
      expect(page.events.find((event) => event.kind === "run.output")?.payload).toMatchObject({ text: "working" })
      expect(page.events.find((event) => event.kind === "run.tool")?.payload).toMatchObject({ toolName: "read" })
    }),
  )

  it.effect("forwards one approval decision through the real Queue and approval projection", () =>
    Effect.gen(function* () {
      const { queue, approvals, events } = yield* services
      let adapter: CoordinationContracts.Runner
      const mock = MockRunner.createMockRunner({
        report: (callback) => Effect.runPromise(adapter.report({ ...callback, principal: runner })).then(() => {}),
        plan: () => [
          { kind: "approval", approvalId: "apr_integrated", toolCallId: "tool_integrated" },
          { kind: "complete" },
        ],
      })
      adapter = RunnerAdapter.make({ access, queue, port: mock.port, approvals, now: () => Date.parse(date) })

      const accepted = yield* queue.submit({
        principal: member,
        threadId: thread.id,
        requestId: "req_approval",
        text: "Ask approval",
      })
      yield* adapter.claim(runner, thread.id, owner)
      const pending = yield* Effect.promise(async () => {
        for (let attempt = 0; attempt < 100; attempt++) {
          const rows = await Effect.runPromise(approvals.list(thread.id))
          if (rows[0]?.state === "pending") return rows[0]
          await Bun.sleep(5)
        }
        throw new Error("Mock runner did not request approval")
      })
      const decisions = yield* Effect.all(
        [
          adapter.decideApproval({
            principal: member,
            threadId: thread.id,
            approvalId: pending.id,
            expectedVersion: pending.version,
            decisionId: "dec_first",
            decision: "approve",
          }),
          adapter.decideApproval({
            principal: secondMember,
            threadId: thread.id,
            approvalId: pending.id,
            expectedVersion: pending.version,
            decisionId: "dec_second",
            decision: "reject",
          }),
        ].map((decision) => decision.pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }))),
        { concurrency: 2 },
      )
      yield* Effect.promise(() => mock.wait(accepted.run.id))
      expect(decisions.filter(Boolean)).toHaveLength(1)
      expect(mock.decisions).toHaveLength(1)
      expect((yield* queue.getRun(accepted.run.id))?.state).toBe("completed")
      const page = yield* events.replayProject(thread.projectId, -1, 20)
      expect(page.events.filter((event) => event.kind === "run.approval.requested")).toHaveLength(1)
      expect(
        page.events.filter((event) => event.kind === "run.approval.resolved" && event.payload.decisionId),
      ).toHaveLength(2)
    }),
  )
})
