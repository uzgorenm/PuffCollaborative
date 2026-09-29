import { expect, test } from "bun:test"
import { DateTime, Effect } from "effect"
import { Coordination } from "@opencode-ai/schema/coordination"
import { Permission } from "@opencode-ai/schema/permission"
import { Session } from "@opencode-ai/schema/session"
import { SessionInput } from "@opencode-ai/schema/session-input"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Database } from "@opencode-ai/core/database/database"
import { RunnerLifecycle } from "@opencode-ai/core/runner-harness/lifecycle"
import { ExecutionTable } from "@opencode-ai/core/runner-harness/sql"
import { Hash } from "@opencode-ai/core/util/hash"
import type { RunnerArtifacts } from "@opencode-ai/core/runner-harness/artifacts"
import type { RunnerHarnessContracts } from "@opencode-ai/core/runner-harness/contracts"
import { eq } from "drizzle-orm"

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

function artifactBaseline(execution: RunnerHarnessContracts.LocalExecution): RunnerArtifacts.Baseline {
  return {
    projectId: execution.run.projectId,
    threadId: execution.run.command.threadId,
    runId: execution.run.command.runId,
    workspaceId: execution.workspace!.id,
    directoryHash: Hash.sha256(execution.workspace!.directory),
    revision: "baseline-revision",
    dirtyPaths: [],
    head: "head-revision",
    branchBase: "base-revision",
    branchBaseKind: "origin/main",
    untrackedPaths: [],
    skipped: [],
    skippedTruncated: false,
    excludedCount: 0,
    state: "complete",
  }
}

function setup(db: Database.Interface["db"]) {
  const observations = new Map<
    Coordination.RunID,
    (observation: RunnerHarnessContracts.Observation) => Effect.Effect<void, RunnerHarnessContracts.Failure>
  >()
  const drafts: RunnerHarnessContracts.CallbackDraft[] = []
  const calls = { prompts: 0, workspaces: 0, watches: 0, wakes: 0, collections: 0, order: [] as string[] }
  const state = {
    promptFailure: false,
    workspaceFailure: false,
    reconciliation: "missing" as RunnerHarnessContracts.Reconciliation,
    activeTools: 0,
    artifactActivities: [] as Coordination.RunnerActivity[],
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
        if (state.promptFailure) return Effect.die(new Error("Prompt timed out after possible admission"))
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
        Effect.gen(function* () {
          calls.workspaces++
          if (state.workspaceFailure)
            return yield* Effect.fail({ code: "conflict" as const, message: "Workspace binding changed" })
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
      watch: ({ observe }) =>
        Effect.gen(function* () {
          calls.watches++
          calls.order.push("watch")
          yield* observe(
            Effect.sync(() => {
              calls.order.push("ready")
            }),
          )
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
      awaitIdle: (execution) =>
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
          abort: "acknowledged",
          state: "stopped",
          checkedAt: 0,
        }),
      startDelivery: () => Effect.void,
      shutdown: () => Effect.void,
    },
    ingestion: {
      observe: ({ execution, onObservation, onReady }) =>
        Effect.gen(function* () {
          observations.set(execution.run.command.runId, onObservation)
          if (onReady) yield* onReady
        }),
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
    artifacts: {
      baseline: (execution) =>
        Effect.sync(() => {
          calls.order.push("baseline")
          return artifactBaseline(execution)
        }),
      collect: ({ execution }) =>
        Effect.sync(() => {
          calls.collections++
          const baseline = execution.artifactBaseline!
          const scope = { state: "complete" as const, changed: [], excludedCount: 0, omittedCount: 0 }
          return {
            state: "complete" as const,
            changed: [],
            activity: state.artifactActivities,
            projectId: execution.run.projectId,
            threadId: execution.run.command.threadId,
            runId: execution.run.command.runId,
            sessionId: execution.run.command.sessionId,
            workspaceId: execution.workspace!.id,
            baseline: baseline.revision,
            final: "final-revision",
            head: baseline.head,
            branchBase: baseline.branchBase,
            branchBaseKind: baseline.branchBaseKind,
            excludedCount: 0,
            scopes: { run: scope, beforeRun: scope, overall: scope },
          }
        }),
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
      expect(harness.calls.order.slice(0, 4)).toEqual(["baseline", "watch", "ready", "prompt"])
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
      harness.state.reconciliation = "admitted"
      const knownAdmission = yield* harness.service.start(first).pipe(Effect.flip)
      expect(knownAdmission.code).toBe("unavailable")
      expect(harness.calls.prompts).toBe(1)
      expect(harness.calls.wakes).toBe(0)
    }),
  ))

test("holds a prepared retry when durable admission exists but scheduling is unverified", () =>
  withDatabase((db) =>
    Effect.gen(function* () {
      const harness = setup(db)
      const first = command("prepared")
      const bound = session(first)
      const accepted = yield* harness.service.accept({
        command: first,
        projectId: bound.projectID,
        attempt: 1,
        session: bound,
      })
      const workspace = {
        id: `workspace_${first.threadId}`,
        threadId: first.threadId,
        projectId: bound.projectID,
        directory: bound.location.directory,
      }
      const preparation = {
        runId: first.runId,
        workspace,
        runtime: { id: `runtime_${first.threadId}`, ...first.executionOwner },
        sessionId: first.sessionId,
        artifactBaseline: artifactBaseline({ ...accepted, workspace }),
      }
      yield* harness.service.prepared(preparation)
      expect((yield* harness.service.prepared(preparation)).artifactBaseline).toEqual(preparation.artifactBaseline)
      const changedBaseline = yield* harness.service
        .prepared({ ...preparation, artifactBaseline: { ...preparation.artifactBaseline, revision: "different" } })
        .pipe(Effect.flip)
      expect(changedBaseline.code).toBe("conflict")
      harness.state.reconciliation = "admitted"
      const retry = yield* harness.service.start(first).pipe(Effect.flip)
      expect(retry.code).toBe("unavailable")
      expect((yield* harness.service.get(first.runId))?.phase).toBe("recovery_required")
      expect(harness.calls.prompts).toBe(0)
      expect(harness.calls.wakes).toBe(0)
    }),
  ))

test("records a deterministic preparation failure before prompt side effects", () =>
  withDatabase((db) =>
    Effect.gen(function* () {
      const harness = setup(db)
      const first = command("bad-workspace")
      harness.state.workspaceFailure = true
      const rejected = yield* harness.service.start(first).pipe(Effect.flip)
      expect(rejected.code).toBe("conflict")
      expect((yield* harness.service.get(first.runId))?.phase).toBe("failed")
      expect(harness.calls.prompts).toBe(0)
      expect(harness.drafts.at(-1)?.callback).toMatchObject({
        kind: "state",
        expectedState: "reserved",
        nextState: "failed",
      })
    }),
  ))

test("records output before the matching terminal callback", () =>
  withDatabase((db) =>
    Effect.gen(function* () {
      const harness = setup(db)
      const first = command("output")
      harness.state.artifactActivities = [{ kind: "run.diff", ref: "runner-artifact:output" }]
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
        sourceSessionSeq: 12,
        activity: { kind: "run.output", text: "Finished work" },
      })
      yield* harness.emit(first.runId, {
        kind: "activity",
        runId: first.runId,
        sourceKey: "output:next-chunk",
        sourceSessionSeq: 12,
        activity: { kind: "run.output", text: " and more" },
      })
      const invalidTerminal = yield* harness.service
        .transition({
          runId: first.runId,
          expected: "running",
          next: "running",
          callbacks: [
            {
              runId: first.runId,
              producerKey: "premature-terminal",
              callback: { kind: "state", expectedState: "running", nextState: "completed" },
            },
          ],
        })
        .pipe(Effect.flip)
      expect(invalidTerminal.code).toBe("invalid")
      yield* harness.emit(first.runId, {
        kind: "settled",
        runId: first.runId,
        messageId: first.runnerMessageId,
        sourceKey: "settled",
        sourceSessionSeq: 13,
      })
      expect(harness.drafts.map((draft) => draft.producerKey)).toEqual([
        "promoted",
        "output",
        "output:next-chunk",
        "artifact:settled:0",
        "settled",
      ])
      expect(harness.drafts[1]?.callback.kind).toBe("activity")
      expect(harness.drafts[3]?.callback.kind).toBe("activity")
      expect(harness.drafts[4]?.callback).toMatchObject({ kind: "state", nextState: "completed" })
      expect(harness.calls.collections).toBe(1)
      const completed = yield* harness.service.get(first.runId)
      expect(completed?.phase).toBe("completed")
      expect(completed?.artifactReport?.baseline).toBe("baseline-revision")
      expect(completed?.artifactReport?.activity).toEqual(harness.state.artifactActivities)
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
      expect((yield* harness.service.get(first.runId))?.phase).toBe("recovery_required")
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
      expect((yield* harness.service.get(first.runId))?.phase).toBe("recovery_required")
    }),
  ))

test("ignores an older Session observation for the same Run", () =>
  withDatabase((db) =>
    Effect.gen(function* () {
      const harness = setup(db)
      const first = command("older-event")
      yield* harness.service.start(first)
      yield* harness.emit(first.runId, {
        kind: "promoted",
        runId: first.runId,
        messageId: first.runnerMessageId,
        sourceKey: "promoted",
        sourceSessionSeq: 10,
      })
      yield* harness.emit(first.runId, {
        kind: "settled",
        runId: first.runId,
        messageId: first.runnerMessageId,
        sourceKey: "stale-settled",
        sourceSessionSeq: 9,
      })
      expect((yield* harness.service.get(first.runId))?.phase).toBe("running")
      expect(harness.drafts.some((draft) => draft.producerKey === "stale-settled")).toBe(false)
      yield* harness.emit(first.runId, {
        kind: "settled",
        runId: first.runId,
        messageId: first.runnerMessageId,
        sourceKey: "settled",
        sourceSessionSeq: 11,
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

test("records tool activity before the approval state callback", () =>
  withDatabase((db) =>
    Effect.gen(function* () {
      const harness = setup(db)
      const first = command("approval")
      yield* harness.service.start(first)
      yield* harness.emit(first.runId, {
        kind: "promoted",
        runId: first.runId,
        messageId: first.runnerMessageId,
        sourceKey: "promoted",
      })
      yield* harness.service.approvalRequested({
        runId: first.runId,
        sessionId: first.sessionId,
        permissionRequestId: Permission.ID.make("per_approval"),
        toolCallId: "tool_call",
        toolName: "shell",
        summary: "Needs permission",
        approvalId: "approval_one",
        delivery: "pending",
      })
      expect(harness.drafts.slice(-2).map((draft) => draft.producerKey)).toEqual([
        "approval:approval_one:tool",
        "approval:approval_one:requested",
      ])
      expect(harness.drafts.at(-1)?.callback).toMatchObject({
        kind: "state",
        expectedState: "running",
        nextState: "waiting_approval",
      })
    }),
  ))

test("persists exact cancellation evidence and rejects an older observation", () =>
  withDatabase((db) =>
    Effect.gen(function* () {
      const harness = setup(db)
      const first = command("cancel")
      yield* harness.service.start(first)
      yield* harness.service.cancellationRequested(first.runId)
      const result = {
        runId: first.runId,
        result: {
          runtime: { id: `runtime_${first.threadId}`, ...first.executionOwner },
          sessionId: first.sessionId,
          abort: "acknowledged" as const,
          state: "uncertain" as const,
          checkedAt: 10,
        },
      }
      expect((yield* harness.service.cancellationObserved(result)).phase).toBe("cancelling")
      expect((yield* harness.service.cancellationObserved(result)).phase).toBe("cancelling")
      const stale = yield* harness.service
        .cancellationObserved({ ...result, result: { ...result.result, checkedAt: 9 } })
        .pipe(Effect.flip)
      expect(stale.code).toBe("conflict")
      const row = yield* db.select().from(ExecutionTable).where(eq(ExecutionTable.run_id, first.runId)).get()
      expect(row?.interrupt_abort).toBe("acknowledged")
      expect(row?.interrupt_state).toBe("uncertain")
      expect(row?.interrupt_checked_at).toBe(10)
    }),
  ))
