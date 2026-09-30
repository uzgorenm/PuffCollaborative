import { expect, test } from "bun:test"
import { DateTime, Deferred, Effect, Fiber, Queue } from "effect"
import { TestClock } from "effect/testing"
import { Coordination } from "@opencode-ai/schema/coordination"
import { Permission } from "@opencode-ai/schema/permission"
import type { Data, Definition } from "@opencode-ai/schema/event"
import { Session } from "@opencode-ai/schema/session"
import { EventV2 } from "@opencode-ai/core/event"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { make, type Dependencies, type RejectedEvent } from "@opencode-ai/core/runner-harness/event-ingest"
import type { LocalExecution, Observation } from "@opencode-ai/core/runner-harness/contracts"

const sessionID = Session.ID.make("ses_runner_ingest")
const otherSessionID = Session.ID.make("ses_runner_other")
const messageID = SessionMessage.ID.make("msg_runner_ingest")
const assistantID = SessionMessage.ID.make("msg_runner_assistant")
const secondAssistantID = SessionMessage.ID.make("msg_runner_assistant_2")
const projectID = Coordination.ProjectID.make("prj_runner_ingest")
const runID = Coordination.RunID.make("run_runner_ingest")
const directory = AbsolutePath.make("/tmp/runner-ingest")
const timestamp = DateTime.makeUnsafe(1)
const model = { id: ModelV2.ID.make("model"), providerID: ProviderV2.ID.make("provider") }

const session = Session.Info.make({
  id: sessionID,
  projectID,
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: timestamp, updated: timestamp },
  title: "runner",
  location: { directory },
})

const execution: LocalExecution = {
  run: {
    command: {
      runId: runID,
      threadId: Coordination.ThreadID.make("thr_runner_ingest"),
      sessionId: sessionID,
      executionOwner: { workerId: Coordination.WorkerID.make("worker"), instanceId: "instance" },
      runnerMessageId: messageID,
      text: "test",
    },
    projectId: projectID,
    attempt: 1,
    session,
  },
  phase: "prepared",
}

function event<D extends Definition>(definition: D, data: Data<D>, seq: number, sourceSessionID = sessionID) {
  return {
    id: EventV2.ID.create(),
    type: definition.type,
    data,
    durable: { aggregateID: sourceSessionID, seq, version: definition.durable?.version ?? 1 },
  } as EventV2.Payload<D>
}

const prompted = (seq: number, id = messageID, sourceSessionID = sessionID) =>
  event(
    SessionEvent.Prompted,
    { sessionID: sourceSessionID, timestamp, messageID: id, prompt: { text: "test" }, delivery: "queue" },
    seq,
    sourceSessionID,
  )

const step = (seq: number, sourceSessionID = sessionID) =>
  event(
    SessionEvent.Step.Started,
    { sessionID: sourceSessionID, timestamp, assistantMessageID: assistantID, agent: "build", model },
    seq,
    sourceSessionID,
  )

const text = (seq: number, value: string, sourceSessionID = sessionID) =>
  event(
    SessionEvent.Text.Ended,
    { sessionID: sourceSessionID, timestamp, assistantMessageID: assistantID, textID: "text-1", text: value },
    seq,
    sourceSessionID,
  )

const settled = (seq: number) =>
  event(
    SessionEvent.Step.Ended,
    {
      sessionID,
      timestamp,
      assistantMessageID: assistantID,
      finish: "stop",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    seq,
  )

const tool = (seq: number) =>
  event(
    SessionEvent.Tool.Called,
    {
      sessionID,
      timestamp,
      assistantMessageID: assistantID,
      callID: "call-1",
      tool: "bash",
      input: { command: "private command" },
      provider: { executed: false },
    },
    seq,
  )

const toolFailed = (seq: number) =>
  event(
    SessionEvent.Tool.Failed,
    {
      sessionID,
      timestamp,
      assistantMessageID: assistantID,
      callID: "call-1",
      error: { type: "unknown", message: "private tool output" },
      provider: { executed: false },
    },
    seq,
  )

const stepFailed = (seq: number) =>
  event(
    SessionEvent.Step.Failed,
    {
      sessionID,
      timestamp,
      assistantMessageID: assistantID,
      error: { type: "unknown", message: "private provider error" },
    },
    seq,
  )

const request = (id: string, sourceSessionID = sessionID) =>
  Permission.Request.make({
    id: Permission.ID.make(id),
    sessionID: sourceSessionID,
    action: "bash",
    resources: ["/tmp"],
    source: { type: "tool", messageID: assistantID, callID: "call-1" },
  })

function fixture(
  initial: ReadonlyArray<SessionEvent.DurableEvent> = [],
  pending: ReadonlyArray<Permission.Request> = [],
  trustedSteer?: Dependencies["trustedSteer"],
  active?: NonNullable<Dependencies["sessions"]["active"]>,
) {
  return Effect.gen(function* () {
    const ready = yield* Deferred.make<void>()
    const signal = yield* Queue.unbounded<number>()
    const received: Observation[] = []
    const rejected: RejectedEvent[] = []
    const history = [...initial]
    const listeners = new Set<(event: EventV2.Payload) => Effect.Effect<void>>()
    const deps: Dependencies = {
      sessions: {
        ...(active ? { active } : {}),
        history: ({ after = -1, limit }) =>
          Deferred.succeed(ready, undefined).pipe(
            Effect.as({
              events: history.filter((item) => (item.durable?.seq ?? -1) > after).slice(0, limit),
              hasMore: history.filter((item) => (item.durable?.seq ?? -1) > after).length > limit,
            }),
          ),
      },
      events: {
        listen: (listener) =>
          Effect.sync(() => {
            listeners.add(listener)
            return Effect.sync(() => {
              listeners.delete(listener)
            })
          }),
      },
      permissions: { forSession: () => Effect.succeed(pending) },
      ...(trustedSteer ? { trustedSteer } : {}),
      rejected: (item) =>
        Effect.sync(() => rejected.push(item)).pipe(
          Effect.andThen(Queue.offer(signal, received.length)),
          Effect.asVoid,
        ),
    }
    const onObservation = (item: Observation) =>
      Effect.sync(() => received.push(item)).pipe(Effect.andThen(Queue.offer(signal, received.length)), Effect.asVoid)
    const publish = (item: EventV2.Payload) =>
      Effect.forEach(listeners, (listener) => listener(item), { discard: true })
    const record = (item: SessionEvent.DurableEvent) =>
      Effect.sync(() => history.push(item)).pipe(Effect.andThen(publish(item)), Effect.asVoid)
    const awaitCount = (count: number) =>
      Effect.gen(function* () {
        while (received.length < count) yield* Queue.take(signal)
      })
    const start = (onReady?: Effect.Effect<void>) => {
      const observation = { execution, session, onObservation, onReady }
      return make(deps).observe(observation).pipe(Effect.forkScoped)
    }
    return { ready, received, rejected, publish, record, awaitCount, start, listenerCount: () => listeners.size }
  })
}

test("continues reporting a registered informational steer within the original Run", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const steerID = SessionMessage.ID.make("msg_registered_awareness")
        const source = yield* fixture(
          [
            prompted(0),
            step(1),
            text(2, "original output"),
            event(
              SessionEvent.Prompted,
              {
                sessionID,
                timestamp,
                messageID: steerID,
                prompt: { text: "An informational related finding" },
                delivery: "steer",
              },
              3,
            ),
            event(
              SessionEvent.Step.Started,
              { sessionID, timestamp, assistantMessageID: secondAssistantID, agent: "build", model },
              4,
            ),
            event(
              SessionEvent.Text.Ended,
              {
                sessionID,
                timestamp,
                assistantMessageID: secondAssistantID,
                textID: "text-2",
                text: "continued output",
              },
              5,
            ),
          ],
          [],
          ({ run, messageID: id }) =>
            Effect.succeed(run.command.runId === runID && run.command.sessionId === sessionID && id === steerID),
        )
        yield* source.start()
        yield* Deferred.await(source.ready)
        yield* source.publish({ id: EventV2.ID.create(), type: "session.next.unknown", data: { sessionID } })
        while (!source.rejected.some((item) => item.type === "session.next.unknown")) yield* Effect.yieldNow
        expect(source.received.filter((item) => item.kind === "activity").map((item) => item.activity)).toEqual([
          { kind: "run.output", text: "original output" },
          { kind: "run.output", text: "continued output" },
        ])
        expect(source.received.filter((item) => item.kind === "promoted")).toHaveLength(1)
        expect(source.rejected.map((item) => item.reason)).toEqual(["invalid"])
      }),
    ),
  )
})

test("closes attribution for an unregistered steer even when trusted steering is configured", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const source = yield* fixture(
          [
            prompted(0),
            step(1),
            text(2, "original output"),
            event(
              SessionEvent.Prompted,
              {
                sessionID,
                timestamp,
                messageID: SessionMessage.ID.make("msg_unregistered"),
                prompt: { text: "An unregistered steer" },
                delivery: "steer",
              },
              3,
            ),
            text(4, "original output that must not be attributed"),
          ],
          [],
          () => Effect.succeed(false),
        )
        yield* source.start()
        yield* Deferred.await(source.ready)
        yield* source.publish({ id: EventV2.ID.create(), type: "session.next.unknown", data: { sessionID } })
        while (!source.rejected.some((item) => item.type === "session.next.unknown")) yield* Effect.yieldNow
        expect(source.received.filter((item) => item.kind === "activity").map((item) => item.activity)).toEqual([
          { kind: "run.output", text: "original output" },
        ])
        expect(source.rejected.map((item) => item.reason)).toEqual(["foreign_prompt", "invalid"])
      }),
    ),
  )
})

test("reports continuation output before settling the actual Session drain", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        let active = true
        const source = yield* fixture(
          [prompted(0), step(1), text(2, "first turn")],
          [],
          () => Effect.succeed(true),
          Effect.sync(() => (active ? new Set([sessionID]) : new Set())),
        )
        yield* source.start()
        yield* Deferred.await(source.ready)
        yield* source.record(settled(3))
        yield* source.publish({ id: EventV2.ID.create(), type: "session.next.unknown", data: { sessionID } })
        while (source.rejected.length < 1) yield* Effect.yieldNow
        expect(source.received.some((item) => item.kind === "settled")).toBe(false)

        yield* source.record(
          event(
            SessionEvent.Prompted,
            {
              sessionID,
              timestamp,
              messageID: SessionMessage.ID.make("msg_trusted_continuation"),
              prompt: { text: "Related informational finding" },
              delivery: "steer",
            },
            4,
          ),
        )
        yield* source.record(
          event(
            SessionEvent.Step.Started,
            { sessionID, timestamp, assistantMessageID: secondAssistantID, agent: "build", model },
            5,
          ),
        )
        yield* source.record(
          event(
            SessionEvent.Text.Ended,
            { sessionID, timestamp, assistantMessageID: secondAssistantID, textID: "text-2", text: "second turn" },
            6,
          ),
        )
        const finalStep = event(
          SessionEvent.Step.Ended,
          {
            sessionID,
            timestamp,
            assistantMessageID: secondAssistantID,
            finish: "stop",
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          },
          7,
        )
        yield* source.record(finalStep)
        yield* source.publish({ id: EventV2.ID.create(), type: "session.next.unknown", data: { sessionID } })
        while (source.rejected.length < 2) yield* Effect.yieldNow
        expect(source.received.some((item) => item.kind === "settled")).toBe(false)
        yield* Effect.sync(() => {
          active = false
        })
        yield* source.awaitCount(4)
        expect(source.received.map((item) => item.kind)).toEqual(["promoted", "activity", "activity", "settled"])
        expect(source.received.at(-1)?.sourceKey).toBe(finalStep.id)
        expect(source.received.filter((item) => item.kind === "activity").map((item) => item.activity)).toEqual([
          { kind: "run.output", text: "first turn" },
          { kind: "run.output", text: "second turn" },
        ])
      }),
    ),
  )
})

test("keeps observing while an informational continuation waits for human tool approval", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        let active = true
        const approval = Permission.Request.make({
          id: Permission.ID.make("per_awareness_continuation"),
          sessionID,
          action: "bash",
          resources: ["/tmp"],
          source: { type: "tool", messageID: secondAssistantID, callID: "call-2" },
        })
        const source = yield* fixture(
          [
            prompted(0),
            step(1),
            text(2, "first turn"),
            settled(3),
            event(
              SessionEvent.Prompted,
              {
                sessionID,
                timestamp,
                messageID: SessionMessage.ID.make("msg_approval_continuation"),
                prompt: { text: "Related informational finding" },
                delivery: "steer",
              },
              4,
            ),
            event(
              SessionEvent.Step.Started,
              { sessionID, timestamp, assistantMessageID: secondAssistantID, agent: "build", model },
              5,
            ),
            event(
              SessionEvent.Tool.Called,
              {
                sessionID,
                timestamp,
                assistantMessageID: secondAssistantID,
                callID: "call-2",
                tool: "bash",
                input: {},
                provider: { executed: false },
              },
              6,
            ),
          ],
          [approval],
          () => Effect.succeed(true),
          Effect.sync(() => (active ? new Set([sessionID]) : new Set())),
        )
        yield* source.start()
        yield* source.awaitCount(4)
        yield* TestClock.adjust("35 seconds")
        expect(source.listenerCount()).toBe(1)
        expect(source.received.filter((item) => item.kind === "permission")).toHaveLength(1)
        expect(source.received.some((item) => item.kind === "settled")).toBe(false)

        yield* source.record(
          event(
            SessionEvent.Text.Ended,
            {
              sessionID,
              timestamp,
              assistantMessageID: secondAssistantID,
              textID: "text-2",
              text: "continued after approval",
            },
            7,
          ),
        )
        yield* source.record(
          event(
            SessionEvent.Step.Ended,
            {
              sessionID,
              timestamp,
              assistantMessageID: secondAssistantID,
              finish: "stop",
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            },
            8,
          ),
        )
        yield* Effect.sync(() => {
          active = false
        })
        yield* TestClock.adjust("20 millis")
        yield* source.awaitCount(6)
        expect(source.received.map((item) => item.kind)).toEqual([
          "promoted",
          "activity",
          "activity",
          "permission",
          "activity",
          "settled",
        ])
        expect(source.received.filter((item) => item.kind === "activity").at(-1)?.activity).toEqual({
          kind: "run.output",
          text: "continued after approval",
        })
      }),
    ).pipe(Effect.provide(TestClock.layer())),
  )
})

test("deduplicates complete snapshots and never appends live-only token deltas", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const source = yield* fixture([prompted(0), step(1), text(2, "hello")])
        yield* source.start()
        yield* Deferred.await(source.ready)
        yield* source.awaitCount(2)
        yield* source.publish({
          id: EventV2.ID.create(),
          type: SessionEvent.Text.Delta.type,
          data: { sessionID, timestamp, assistantMessageID: assistantID, textID: "text-1", delta: " world" },
        })
        yield* source.record(text(3, "hello world"))
        yield* source.record(text(4, "hello world"))
        yield* source.record(settled(5))
        yield* source.awaitCount(4)
        expect(source.received.filter((item) => item.kind === "activity").map((item) => item.activity)).toEqual([
          { kind: "run.output", text: "hello" },
          { kind: "run.output", text: " world" },
        ])
        expect(source.received.at(-1)?.kind).toBe("settled")
      }),
    ),
  )
})

test("keeps interleaved, late, unknown, and unattributed events out of this Run", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const source = yield* fixture()
        yield* source.start()
        yield* Deferred.await(source.ready)
        yield* source.publish(prompted(0, messageID, otherSessionID))
        yield* source.publish(step(1, otherSessionID))
        yield* source.publish(text(2, "another thread's output", otherSessionID))
        yield* source.record(prompted(0))
        yield* source.record(step(1))
        yield* source.record(
          event(
            SessionEvent.Step.Started,
            {
              sessionID,
              timestamp,
              assistantMessageID: secondAssistantID,
              agent: "build",
              model,
            },
            2,
          ),
        )
        yield* source.record(
          event(
            SessionEvent.Tool.Called,
            {
              sessionID,
              timestamp,
              assistantMessageID: secondAssistantID,
              callID: "call-1",
              tool: "bash",
              input: {},
              provider: { executed: false },
            },
            3,
          ),
        )
        yield* source.publish({
          id: EventV2.ID.create(),
          type: Permission.Event.Asked.type,
          data: request("per_unmapped"),
        })
        yield* source.record(prompted(4, SessionMessage.ID.make("msg_later")))
        yield* source.record(text(5, "late output"))
        yield* source.publish({ id: EventV2.ID.create(), type: "session.next.unknown", data: { sessionID } })
        while (!source.rejected.some((item) => item.type === "session.next.unknown")) yield* Effect.yieldNow
        expect(source.received.map((item) => item.kind)).toEqual(["promoted", "activity"])
        const reasons: RejectedEvent["reason"][] = ["unattributed", "foreign_prompt", "invalid"]
        expect(source.rejected.map((item) => item.reason).sort()).toEqual(reasons.sort())
      }),
    ),
  )
})

test("re-observation reconciles durable history and pending native permission without replaying lost deltas", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const source = yield* fixture([prompted(0), step(1), text(2, "stored"), tool(3)], [request("per_pending")])
        const first = yield* source.start()
        yield* Deferred.await(source.ready)
        yield* source.awaitCount(4)
        const previous = source.received.map((item) => item.sourceKey)
        yield* source.publish({
          id: EventV2.ID.create(),
          type: SessionEvent.Text.Delta.type,
          data: { sessionID, timestamp, assistantMessageID: assistantID, textID: "text-2", delta: "lost" },
        })
        yield* Fiber.interrupt(first)
        yield* source.start()
        yield* source.awaitCount(8)
        expect(source.received.slice(4).map((item) => item.sourceKey)).toEqual(previous)
        expect(
          source.received.filter((item) => item.kind === "activity" && item.activity.kind === "run.output").length,
        ).toBe(2)
        expect(
          source.received.some(
            (item) => item.kind === "activity" && item.activity.kind === "run.output" && item.activity.text === "lost",
          ),
        ).toBe(false)
      }),
    ),
  )
})

test("signals observer readiness after listener registration, history, and pending permissions", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const source = yield* fixture([prompted(0), step(1), tool(2)], [request("per_ready")])
        const ready = yield* Deferred.make<void>()
        let atReady: Observation["kind"][] = []
        yield* source.start(
          Effect.sync(() => {
            expect(source.listenerCount()).toBe(1)
            atReady = source.received.map((item) => item.kind)
          }).pipe(Effect.andThen(Deferred.succeed(ready, undefined)), Effect.asVoid),
        )
        yield* Deferred.await(ready)
        expect(atReady).toEqual(["promoted", "activity", "permission"])
      }),
    ),
  )
})

test("routes matched permission and failure evidence without copying tool or provider details", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const source = yield* fixture([prompted(0), step(1), tool(2)])
        yield* source.start()
        yield* Deferred.await(source.ready)
        yield* source.awaitCount(2)
        yield* source.publish({ id: EventV2.ID.create(), type: Permission.Event.Asked.type, data: request("per_live") })
        yield* source.awaitCount(3)
        yield* source.record(toolFailed(3))
        yield* source.record(stepFailed(4))
        yield* source.awaitCount(5)
        expect(source.received.map((item) => item.kind)).toEqual([
          "promoted",
          "activity",
          "permission",
          "activity",
          "failed",
        ])
        expect(source.received.filter((item) => item.kind === "activity").map((item) => item.activity)).toEqual([
          { kind: "run.tool", toolName: "bash", status: "started" },
          { kind: "run.tool", toolName: "bash", status: "failed" },
        ])
        expect(source.received.find((item) => item.kind === "permission")?.sourceKey).toBe("permission:per_live")
        expect(JSON.stringify(source.received)).not.toContain("private")
      }),
    ),
  )
})

test("rejects a mismatched trusted Session before registering an observer", async () => {
  let registered = false
  const result = await Effect.runPromise(
    Effect.flip(
      make({
        sessions: { history: () => Effect.die("unexpected history") },
        events: {
          listen: () =>
            Effect.sync(() => {
              registered = true
              return Effect.void
            }),
        },
        permissions: { forSession: () => Effect.die("unexpected permission lookup") },
      }).observe({
        execution: { ...execution, run: { ...execution.run, projectId: Coordination.ProjectID.make("wrong") } },
        session,
        onObservation: () => Effect.void,
      }),
    ),
  )
  expect(result).toEqual({ code: "conflict", message: "Runner observation binding mismatch" })
  expect(registered).toBe(false)
})
