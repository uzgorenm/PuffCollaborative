import { expect, test } from "bun:test"
import { DateTime, Effect } from "effect"
import { Coordination } from "@opencode-ai/schema/coordination"
import { Session } from "@opencode-ai/schema/session"
import { SessionInput } from "@opencode-ai/schema/session-input"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Database } from "@opencode-ai/core/database/database"
import { RunnerLifecycle } from "@opencode-ai/core/runner-harness/lifecycle"
import type { RunnerHarnessContracts } from "@opencode-ai/core/runner-harness/contracts"

function command(name: string, thread = name): RunnerHarnessContracts.StartCommand {
  return {
    runId: Coordination.RunID.make(`run_${name}`),
    threadId: Coordination.ThreadID.make(`thr_${thread}`),
    sessionId: Session.ID.make(`ses_${thread}`),
    executionOwner: {
      workerId: Coordination.WorkerID.make("worker_one"),
      instanceId: "instance_one",
    },
    runnerMessageId: `msg_${name}`,
    text: `Implement ${name}`,
  }
}

function session(command: RunnerHarnessContracts.StartCommand) {
  return Session.Info.make({
    id: command.sessionId,
    projectID: Coordination.ProjectID.make("project_one"),
    title: "Runner fixture",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
    location: { directory: AbsolutePath.make(`/tmp/runner-${command.threadId}`) },
  })
}

function setup(db: Database.Interface["db"]) {
  const observations = new Map<
    Coordination.RunID,
    (observation: RunnerHarnessContracts.Observation) => Effect.Effect<void, RunnerHarnessContracts.Failure>
  >()
  const drafts: RunnerHarnessContracts.CallbackDraft[] = []
  const calls = { prompts: 0, workspaces: 0, watches: 0, wakes: 0, order: [] as string[] }
  const state = {
    promptFailure: false,
    reconciliation: "missing" as RunnerHarnessContracts.Reconciliation,
    activeTools: 0,
  }
  const sessions = new Map<string, Session.Info>()
  const principal: Extract<Coordination.AuthContext, { kind: "runner" }> = {
    kind: "runner",
    workerId: Coordination.WorkerID.make("worker_one"),
    instanceId: "instance_one",
  }
  const service = RunnerLifecycle.make({
    db,
    sessions: {
      get: (id) => Effect.succeed(sessions.get(id) ?? session(command(id.slice(4)))),
      prompt: (input) => {
        calls.prompts++
        calls.order.push("prompt")
        if (state.promptFailure)
          return Effect.fail({ _tag: "Session.NotFoundError", sessionID: input.sessionID } as never)
        return Effect.succeed(
          SessionInput.Admitted.make({
            id: input.id!,
            sessionID: input.sessionID,
            admittedSeq: calls.prompts,
            prompt: { text: input.prompt.text },
            delivery: input.delivery ?? "steer",
            timeCreated: DateTime.makeUnsafe(0),
          }),
        )
      },
    },
    binding: {
      authorize: (value) => {
        const bound = session(value)
        sessions.set(value.sessionId, bound)
        return Effect.succeed({ command: value, projectId: bound.projectID, attempt: 1, session: bound })
      },
      attach: ({ run }) => Effect.succeed(run.session),
      coordinator: {
        resolve: () =>
          Effect.succeed({
            projectId: Coordination.ProjectID.make("project_one"),
            workerId: Coordination.WorkerID.make("worker_one"),
          }),
      },
    },
    credentials: {
      verify: (owner) =>
        owner.workerId === principal.workerId && owner.instanceId === principal.instanceId
          ? Effect.void
          : Effect.fail({ code: "forbidden", message: "Wrong owner" }),
      principal: () => Effect.succeed(principal),
    },
    policy: {
      workspace: () => Effect.void,
      runtimeAccess: () => Effect.void,
      toolEnvironment: () => Effect.succeed({}),
      artifact: () => Effect.succeed(undefined),
      redact: (text) => text,
    },
    workspaces: {
      ensure: (run) =>
        Effect.sync(() => {
          calls.workspaces++
          return {
            id: `workspace_${run.command.threadId}`,
            threadId: run.command.threadId,
            projectId: run.projectId,
            directory: run.session.location.directory,
          }
        }),
    },
    runtimes: {
      ensure: ({ run }) => Effect.succeed({ id: `runtime_${run.command.threadId}`, ...run.command.executionOwner }),
      health: (runtime) => Effect.succeed({ runtime, state: "ready", checkedAt: 0 }),
      watch: () =>
        Effect.sync(() => {
          calls.watches++
          calls.order.push("watch")
        }),
      wake: () =>
        Effect.sync(() => {
          calls.wakes++
        }),
      inspect: (execution) =>
        Effect.succeed({
          runtime: execution.runtime!,
          sessionId: execution.run.session.id,
          state: "idle",
          activeTools: state.activeTools,
          checkedAt: 0,
        }),
      interrupt: (execution) =>
        Effect.succeed({
          runtime: execution.runtime!,
          sessionId: execution.run.session.id,
          state: "stopped",
          checkedAt: 0,
        }),
      shutdown: () => Effect.void,
    },
    ingestion: {
      observe: ({ execution, onObservation }) => {
        observations.set(execution.run.command.runId, onObservation)
        return Effect.void
      },
    },
    delivery: {
      append: (_tx, input) =>
        Effect.sync(() => {
          drafts.push(...input)
          return input.map((draft, index) => ({
            ...draft,
            callbackId: `callback_${drafts.length + index}`,
            ordinal: drafts.length + index,
          }))
        }),
      flush: () => Effect.void,
      pending: () => Effect.succeed([]),
      drainDue: () => Effect.succeed(0),
      diagnostics: Effect.succeed({ pending: 0, failed: 0 }),
    },
    approvals: {
      requested: () => Effect.fail({ code: "unavailable", message: "No approval fixture" }),
      invalidate: () => Effect.void,
    },
    recovery: {
      reconcile: () => Effect.succeed(state.reconciliation),
      recover: Effect.void,
    },
  })
  return {
    service,
    calls,
    drafts,
    state,
    emit: (runId: Coordination.RunID, observation: RunnerHarnessContracts.Observation) =>
      observations.get(runId)?.(observation) ?? Effect.die("Observer was not installed"),
  }
}

function withDatabase<A, E>(run: (db: Database.Interface["db"]) => Effect.Effect<A, E>) {
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* run((yield* Database.Service).db)
    }).pipe(Effect.provide(Database.layerFromPath(":memory:"))),
  )
}

test("deduplicates exact starts and rejects changed Run payloads", () =>
  withDatabase((db) =>
    Effect.gen(function* () {
      const harness = setup(db)
      const first = command("first")
      expect(yield* harness.service.start(first)).toEqual({ messageId: first.runnerMessageId })
      expect(yield* harness.service.start(first)).toEqual({ messageId: first.runnerMessageId })
      expect(harness.calls.prompts).toBe(1)
      expect(harness.calls.order.slice(0, 2)).toEqual(["watch", "prompt"])
      const conflict = yield* harness.service.start({ ...first, text: "Changed text" }).pipe(Effect.flip)
      expect(conflict.code).toBe("conflict")
      expect(harness.calls.prompts).toBe(1)
    }),
  ))

test("rejects another active Run in the same thread before workspace side effects", () =>
  withDatabase((db) =>
    Effect.gen(function* () {
      const harness = setup(db)
      yield* harness.service.start(command("first", "shared"))
      const rejected = yield* harness.service.start(command("second", "shared")).pipe(Effect.flip)
      expect(rejected.code).toBe("conflict")
      expect(harness.calls.workspaces).toBe(1)
    }),
  ))

test("starts independent threads concurrently", () =>
  withDatabase((db) =>
    Effect.gen(function* () {
      const harness = setup(db)
      const first = command("first")
      const second = command("second")
      const results = yield* Effect.all([harness.service.start(first), harness.service.start(second)], {
        concurrency: "unbounded",
      })
      expect(results.map((item) => item.messageId)).toEqual([first.runnerMessageId, second.runnerMessageId])
      expect(harness.calls.prompts).toBe(2)
      expect(harness.calls.wakes).toBe(2)
    }),
  ))

test("holds an ambiguous prompt submission for reconciliation without resubmitting", () =>
  withDatabase((db) =>
    Effect.gen(function* () {
      const harness = setup(db)
      const first = command("uncertain")
      harness.state.promptFailure = true
      const initial = yield* harness.service.start(first).pipe(Effect.flip)
      expect(initial.code).toBe("unavailable")
      expect((yield* harness.service.get(first.runId))?.phase).toBe("recovery_required")
      const retry = yield* harness.service.start(first).pipe(Effect.flip)
      expect(retry.code).toBe("unavailable")
      expect(harness.calls.prompts).toBe(1)
    }),
  ))

test("records output before the matching terminal callback", () =>
  withDatabase((db) =>
    Effect.gen(function* () {
      const harness = setup(db)
      const first = command("output")
      yield* harness.service.start(first)
      yield* harness.emit(first.runId, {
        kind: "promoted",
        runId: first.runId,
        messageId: first.runnerMessageId,
        sourceKey: "promoted",
      })
      yield* harness.emit(first.runId, {
        kind: "activity",
        runId: first.runId,
        sourceKey: "output",
        activity: { kind: "run.output", text: "Finished work" },
      })
      yield* harness.emit(first.runId, {
        kind: "settled",
        runId: first.runId,
        messageId: first.runnerMessageId,
        sourceKey: "settled",
      })
      expect(harness.drafts.map((draft) => draft.producerKey)).toEqual(["promoted", "output", "settled"])
      expect(harness.drafts[1]?.callback.kind).toBe("activity")
      expect(harness.drafts[2]?.callback).toMatchObject({ kind: "state", nextState: "completed" })
      expect((yield* harness.service.get(first.runId))?.phase).toBe("completed")
    }),
  ))

test("ignores stale and unrelated observations after the next Run starts", () =>
  withDatabase((db) =>
    Effect.gen(function* () {
      const harness = setup(db)
      const first = command("first", "shared")
      const second = command("second", "shared")
      yield* harness.service.start(first)
      yield* harness.emit(first.runId, {
        kind: "promoted",
        runId: first.runId,
        messageId: first.runnerMessageId,
        sourceKey: "first-promoted",
      })
      yield* harness.emit(first.runId, {
        kind: "settled",
        runId: first.runId,
        messageId: first.runnerMessageId,
        sourceKey: "first-settled",
      })
      yield* harness.service.start(second)
      yield* harness.emit(first.runId, {
        kind: "activity",
        runId: first.runId,
        sourceKey: "late-output",
        activity: { kind: "run.output", text: "late" },
      })
      yield* harness.emit(second.runId, {
        kind: "settled",
        runId: second.runId,
        messageId: first.runnerMessageId,
        sourceKey: "wrong-message",
      })
      expect((yield* harness.service.get(second.runId))?.phase).toBe("admitted")
      expect(
        harness.drafts.some((draft) => draft.producerKey === "late-output" || draft.producerKey === "wrong-message"),
      ).toBe(false)
    }),
  ))

test("waits for outstanding tools before accepting settled turn evidence", () =>
  withDatabase((db) =>
    Effect.gen(function* () {
      const harness = setup(db)
      const first = command("tools")
      yield* harness.service.start(first)
      yield* harness.emit(first.runId, {
        kind: "promoted",
        runId: first.runId,
        messageId: first.runnerMessageId,
        sourceKey: "promoted",
      })
      harness.state.activeTools = 1
      yield* harness.emit(first.runId, {
        kind: "settled",
        runId: first.runId,
        messageId: first.runnerMessageId,
        sourceKey: "early-idle",
      })
      expect((yield* harness.service.get(first.runId))?.phase).toBe("running")
      expect(
        harness.drafts.some((draft) => draft.callback.kind === "state" && draft.callback.nextState === "completed"),
      ).toBe(false)
      harness.state.activeTools = 0
      yield* harness.emit(first.runId, {
        kind: "settled",
        runId: first.runId,
        messageId: first.runnerMessageId,
        sourceKey: "settled",
      })
      expect((yield* harness.service.get(first.runId))?.phase).toBe("completed")
    }),
  ))

test("records a runtime failure before preparation and refuses unauthenticated acceptance", () =>
  withDatabase((db) =>
    Effect.gen(function* () {
      const harness = setup(db)
      const first = command("boot")
      const untrusted = { ...first, executionOwner: { ...first.executionOwner, instanceId: "other" } }
      const rejected = yield* harness.service
        .accept({
          command: untrusted,
          projectId: session(untrusted).projectID,
          attempt: 1,
          session: session(untrusted),
        })
        .pipe(Effect.flip)
      expect(rejected.code).toBe("forbidden")
      expect(yield* harness.service.get(first.runId)).toBeUndefined()
      yield* harness.service.accept({
        command: first,
        projectId: session(first).projectID,
        attempt: 1,
        session: session(first),
      })
      const recovered = yield* harness.service.runtimeFailed({
        runId: first.runId,
        runtime: { id: "runtime_boot", ...first.executionOwner },
        reason: "boot timeout",
      })
      expect(recovered.phase).toBe("recovery_required")
      expect(recovered.runtime?.id).toBe("runtime_boot")
      expect(harness.drafts.at(-1)?.callback).toMatchObject({
        kind: "state",
        expectedState: "reserved",
        nextState: "recovery_required",
      })
    }),
  ))
