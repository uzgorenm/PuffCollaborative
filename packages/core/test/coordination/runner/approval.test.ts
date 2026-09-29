import { describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { Coordination } from "@opencode-ai/schema/coordination"
import type { CoordinationContracts } from "@opencode-ai/core/coordination/contracts"
import { CoordinationApproval } from "@opencode-ai/core/coordination/approval/store"
import { CoordinationEvents } from "@opencode-ai/core/coordination/events/events"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import migration from "@opencode-ai/core/database/migration/20260929190000_coordination_runner_approval"
import { testEffect } from "../../lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, CoordinationEvents.node])))
const thread = Schema.decodeUnknownSync(Coordination.Thread)({
  id: "thr_approval_test",
  projectId: "prj_approval_test",
  sessionId: "ses_approval_test",
  workerId: "wrk_approval_test",
  title: "Approval test",
  createdBy: "usr_first",
  createdAt: "2026-09-29T18:00:00.000Z",
  activitySeq: 0,
})
const owner = Schema.decodeUnknownSync(Coordination.ExecutionOwner)({
  workerId: thread.workerId,
  instanceId: "host_test",
})
const run = Schema.decodeUnknownSync(Coordination.Run)({
  id: "run_approval_test",
  threadId: thread.id,
  instructionId: "ins_approval_test",
  state: "waiting_approval",
  attempt: 1,
  runnerMessageId: "msg_approval_test",
  executionOwner: owner,
  createdAt: thread.createdAt,
})
const first = Schema.decodeUnknownSync(Coordination.AuthContext)({ kind: "member", userId: "usr_first" })
const second = Schema.decodeUnknownSync(Coordination.AuthContext)({ kind: "member", userId: "usr_second" })

describe("coordination approval with real SQLite and event journal; access and queue are fixtures", () => {
  it.effect("commits approval versions with events and accepts one competing decision", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const events = yield* CoordinationEvents.Service
      yield* db.transaction((tx) => migration.up(tx)).pipe(Effect.orDie)
      const access = {
        getThread: () => Effect.succeed(thread),
      } as unknown as CoordinationContracts.Access
      let currentRun: Coordination.Run = run
      const queue = {
        getRun: () => Effect.succeed(currentRun),
      } as unknown as CoordinationContracts.Queue
      const store = CoordinationApproval.make({ db, events, access, queue, now: () => Date.parse(thread.createdAt) })

      const request = (approvalId: string, toolCallId: string) =>
        events.append(
          {
            projectId: thread.projectId,
            threadId: thread.id,
            runId: run.id,
            kind: "run.approval.requested",
            occurredAt: thread.createdAt,
            payload: { approvalId, toolCallId },
          },
          (seq) => store.requested({ thread, run, approvalId, toolCallId, seq }),
        )

      yield* request("apr_claim", "tool_claim")
      const claimed = yield* store.claim({
        principal: first,
        threadId: thread.id,
        approvalId: "apr_claim",
        expectedVersion: 1,
      })
      expect(claimed).toMatchObject({ state: "claimed", version: 2, claimedBy: "usr_first" })
      const claimRetry = yield* store.claim({
        principal: first,
        threadId: thread.id,
        approvalId: "apr_claim",
        expectedVersion: 1,
      })
      expect(claimRetry).toEqual(claimed)

      yield* request("apr_race", "tool_race")
      const outcomes = yield* Effect.all(
        [
          store
            .decide({
              principal: first,
              threadId: thread.id,
              approvalId: "apr_race",
              expectedVersion: 1,
              decisionId: "dec_first",
              decision: "approve",
            })
            .pipe(
              Effect.match({
                onFailure: (error) => ({ ok: false as const, error }),
                onSuccess: (value) => ({ ok: true as const, value }),
              }),
            ),
          store
            .decide({
              principal: second,
              threadId: thread.id,
              approvalId: "apr_race",
              expectedVersion: 1,
              decisionId: "dec_second",
              decision: "reject",
            })
            .pipe(
              Effect.match({
                onFailure: (error) => ({ ok: false as const, error }),
                onSuccess: (value) => ({ ok: true as const, value }),
              }),
            ),
        ],
        { concurrency: 2 },
      )
      expect(outcomes.filter((item) => item.ok)).toHaveLength(1)
      expect(outcomes.filter((item) => !item.ok)).toHaveLength(1)
      const accepted = outcomes.find((item) => item.ok)
      if (!accepted?.ok || !accepted.value.decisionId) return yield* Effect.die("Missing accepted approval")
      const pending = yield* store.pendingDecisions(owner)
      expect(pending).toHaveLength(1)
      expect(pending[0]?.approval.decisionId).toBe(accepted.value.decisionId)
      const delivered = yield* store.markDelivered("apr_race", accepted.value.decisionId)
      expect(delivered.deliveryState).toBe("delivered")
      expect(yield* store.pendingDecisions(owner)).toEqual([])

      const page = yield* events.replayProject(thread.projectId, -1, 20)
      expect(page.events.map((event) => event.kind)).toEqual([
        "run.approval.requested",
        "run.approval.requested",
        "run.approval.requested",
        "run.approval.resolved",
        "run.approval.resolved",
      ])
      expect((yield* store.list(thread.id)).map((item) => item.id)).toEqual(["apr_claim", "apr_race"])

      yield* request("apr_stale", "tool_stale")
      currentRun = { ...run, state: "completed" }
      const stale = yield* store
        .decide({
          principal: first,
          threadId: thread.id,
          approvalId: "apr_stale",
          expectedVersion: 1,
          decisionId: "dec_stale",
          decision: "approve",
        })
        .pipe(Effect.match({ onFailure: (error) => error, onSuccess: () => undefined }))
      expect(stale?.code).toBe("conflict")
    }),
  )
})
