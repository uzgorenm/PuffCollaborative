import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { Coordination } from "@opencode-ai/schema/coordination"
import { Database } from "@opencode-ai/core/database/database"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { RunnerRecovery } from "@opencode-ai/core/runner-harness/recovery"
import { RunnerHarnessRuntime } from "@opencode-ai/core/runner-harness/runtime"
import type {
  CallbackIntent,
  LocalExecution,
  RuntimeInspection,
  Runtimes,
} from "@opencode-ai/core/runner-harness/contracts"
import { ExecutionTable } from "@opencode-ai/core/runner-harness/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { fromRow } from "@opencode-ai/core/session/info"
import { SessionInputTable, SessionTable } from "@opencode-ai/core/session/sql"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { testEffect } from "../lib/effect"

const it = testEffect(Database.layerFromPath(":memory:"))

const threadId = Coordination.ThreadID.make("thr_recovery")
const runId = Coordination.RunID.make("run_recovery")
const sessionId = SessionSchema.ID.make("ses_recovery")
const workerId = Coordination.WorkerID.make("wrk_recovery")
const workspaceId = WorkspaceV2.ID.make("wrk_recovery_workspace")
const directory = AbsolutePath.make("/tmp/runner-recovery-fixture")
const runtime = { id: "runtime_recovery", workerId, instanceId: "instance_recovery" }

const fixture = (phase: LocalExecution["phase"]) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: directory, sandboxes: [] })
      .onConflictDoNothing()
      .run()
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionId,
        project_id: Project.ID.global,
        workspace_id: workspaceId,
        slug: "recovery",
        directory,
        title: "Recovery fixture",
        version: "1.18.33",
      })
      .run()
    const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, sessionId)).get()
    if (!row) return yield* Effect.die("Fixture Session row is missing")

    const command = {
      runId,
      threadId,
      sessionId,
      executionOwner: { workerId, instanceId: runtime.instanceId },
      runnerMessageId: SessionMessage.ID.create(),
      text: "Continue the shared task",
    }
    const authorized = { command, projectId: Project.ID.global, attempt: 1, session: fromRow(row) }
    const execution: LocalExecution = {
      run: authorized,
      phase,
      workspace:
        phase === "accepted" ? undefined : { id: workspaceId, threadId, projectId: Project.ID.global, directory },
      runtime: phase === "accepted" ? undefined : runtime,
      admittedMessageId: phase === "accepted" || phase === "prepared" ? undefined : command.runnerMessageId,
    }
    yield* db
      .insert(ExecutionTable)
      .values({
        run_id: runId,
        thread_id: threadId,
        project_id: Project.ID.global,
        session_id: sessionId,
        worker_id: workerId,
        instance_id: runtime.instanceId,
        attempt: 1,
        runner_message_id: command.runnerMessageId,
        command,
        phase,
        workspace_id: execution.workspace?.id,
        workspace_directory: execution.workspace?.directory,
        runtime_id: execution.runtime?.id,
        admitted_message_id: execution.admittedMessageId,
        created_at: 1,
        updated_at: 1,
      })
      .run()

    const state = {
      execution,
      authorized,
      coordinatorRun: {
        id: runId,
        threadId,
        instructionId: Coordination.InstructionID.make("ins_recovery"),
        state: "reserved",
        attempt: 1,
        runnerMessageId: command.runnerMessageId,
        executionOwner: command.executionOwner,
        leaseUntil: new Date(Date.now() + 60_000).toISOString(),
        createdAt: "2026-09-29T00:00:00.000Z",
      } as Coordination.Run,
      coordinatorAvailable: true,
      reservationChecks: 0,
      inspection: "idle" as RuntimeInspection["state"],
      activeTools: 0 as RuntimeInspection["activeTools"],
      runtimeAvailable: true,
      reattachAvailable: true,
      reboundRuntime: undefined as LocalExecution["runtime"],
      inspectionRuntime: runtime,
      reportAvailable: true,
      startUnavailable: false,
      pending: [] as CallbackIntent[],
      starts: [] as string[],
      wakes: 0,
      interrupts: 0,
      flushes: [] as string[],
      transitions: [] as string[],
      reattachments: [] as string[],
      order: [] as string[],
    }
    const make = (runtimes?: Pick<Runtimes, "inspect" | "wake">) =>
      RunnerRecovery.make({
        db,
        lifecycle: {
          start: (received) =>
            Effect.sync(() => {
              state.starts.push(received.runnerMessageId)
            }).pipe(
              Effect.flatMap(() =>
                state.startUnavailable
                  ? Effect.fail({ code: "unavailable" as const, message: "Watcher installed; Run remains held" })
                  : Effect.succeed({ messageId: received.runnerMessageId }),
              ),
            ),
          transition: (request) =>
            Effect.gen(function* () {
              state.transitions.push(`${request.expected}->${request.next}`)
              state.execution = { ...state.execution, phase: request.next }
              yield* db
                .update(ExecutionTable)
                .set({ phase: request.next })
                .where(eq(ExecutionTable.run_id, request.runId))
                .run()
                .pipe(Effect.orDie)
              return state.execution
            }),
          get: (received) => Effect.succeed(received === runId ? state.execution : undefined),
          byMessageId: (received) => Effect.succeed(received === command.runnerMessageId ? state.execution : undefined),
          reattach: (received) =>
            Effect.gen(function* () {
              state.reattachments.push(received)
              state.order.push("reattach")
              if (!state.reattachAvailable)
                return yield* Effect.fail({ code: "unavailable" as const, message: "Runtime reattachment failed" })
              if (state.reboundRuntime) {
                state.execution = { ...state.execution, runtime: state.reboundRuntime }
                yield* db
                  .update(ExecutionTable)
                  .set({ runtime_id: state.reboundRuntime.id })
                  .where(eq(ExecutionTable.run_id, received))
                  .run()
                  .pipe(Effect.orDie)
              }
              return state.execution
            }),
        },
        binding: {
          authorize: () => Effect.succeed(state.authorized),
          currentRun: () =>
            Effect.sync(() => {
              state.reservationChecks += 1
            }).pipe(
              Effect.flatMap(() =>
                state.coordinatorAvailable
                  ? Effect.succeed(state.coordinatorRun)
                  : Effect.fail({ code: "unavailable" as const, message: "Coordinator is offline" }),
              ),
            ),
          attach: () => Effect.succeed(state.authorized.session),
        },
        runtimes: runtimes ?? {
          inspect: () => {
            state.order.push("inspect")
            return state.runtimeAvailable
              ? Effect.succeed({
                  runtime: state.inspectionRuntime,
                  sessionId,
                  state: state.inspection,
                  activeTools: state.activeTools,
                  checkedAt: 1,
                })
              : Effect.fail({ code: "unavailable" as const, message: "Runtime could not be found" })
          },
          wake: () =>
            Effect.sync(() => {
              state.wakes += 1
            }),
        },
        reports: {
          pending: () => Effect.succeed(state.pending),
          flush: () =>
            state.reportAvailable
              ? Effect.sync(() => {
                  state.flushes.push(...state.pending.map((item) => item.callbackId))
                  state.pending = []
                })
              : Effect.fail({ code: "unavailable" as const, message: "Coordinator is offline" }),
        },
        cancellations: {
          interrupt: () =>
            Effect.sync(() => {
              state.interrupts += 1
            }),
        },
      })
    const admit = (promotedSeq?: number) =>
      db
        .insert(SessionInputTable)
        .values({
          id: SessionMessage.ID.make(command.runnerMessageId),
          session_id: sessionId,
          prompt: Prompt.make({ text: command.text }),
          delivery: "queue" as const,
          admitted_seq: 1,
          promoted_seq: promotedSeq,
          time_created: 1,
        })
        .run()
    const pending = () => {
      state.pending = [
        {
          runId,
          producerKey: "terminal",
          callbackId: "callback_terminal",
          ordinal: 1,
          callback: { kind: "state", expectedState: "running", nextState: "completed" },
        },
      ]
    }
    return { make, state, command, admit, pending }
  })

describe("runner recovery with persisted SQLite records and dependency doubles", () => {
  it.effect("resumes a definitely unsubmitted accepted command", () =>
    Effect.gen(function* () {
      const setup = yield* fixture("accepted")
      expect(yield* setup.make().reconcile(setup.command.runnerMessageId)).toBe("missing")
      yield* setup.make().recover
      expect(setup.state.starts).toEqual([setup.command.runnerMessageId])
      expect(setup.state.wakes).toBe(0)
      expect(setup.state.reattachments).toHaveLength(0)
    }),
  )

  it.effect("reattaches a persisted runtime before inspecting and waking a reserved unpromoted input", () =>
    Effect.gen(function* () {
      const setup = yield* fixture("admitted")
      yield* setup.admit()
      setup.state.reboundRuntime = { ...runtime, id: "runtime_after_restart" }
      setup.state.inspectionRuntime = setup.state.reboundRuntime
      yield* setup.make().recover
      expect(setup.state.order[0]).toBe("reattach")
      expect(setup.state.order).toContain("inspect")
      expect(setup.state.reattachments).toEqual([runId])
      expect(setup.state.execution.runtime?.id).toBe("runtime_after_restart")
      expect(setup.state.starts).toEqual([setup.command.runnerMessageId])
      expect(setup.state.wakes).toBe(1)
      expect(setup.state.reservationChecks).toBeGreaterThan(0)
    }),
  )

  it.effect("holds a Run when its persisted runtime cannot be reattached", () =>
    Effect.gen(function* () {
      const setup = yield* fixture("admitted")
      yield* setup.admit()
      setup.state.reattachAvailable = false
      yield* setup.make().recover
      expect(setup.state.reattachments).toEqual([runId])
      expect(setup.state.execution.phase).toBe("recovery_required")
      expect(setup.state.starts).toHaveLength(0)
      expect(setup.state.wakes).toBe(0)
      expect(setup.state.order).not.toContain("inspect")
    }),
  )

  it.effect("keeps a recorded uncertain cancellation held across restart and explicit reconciliation", () =>
    Effect.gen(function* () {
      const setup = yield* fixture("cancelling")
      yield* setup.admit(2)
      yield* (yield* Database.Service).db
        .update(ExecutionTable)
        .set({ interrupt_abort: "unknown", interrupt_state: "uncertain", interrupt_checked_at: 2 })
        .where(eq(ExecutionTable.run_id, runId))
        .run()
      yield* setup.make().recover
      expect(setup.state.execution.phase).toBe("recovery_required")
      expect(setup.state.reattachments).toHaveLength(0)
      expect(setup.state.interrupts).toBe(0)
      expect(setup.state.starts).toHaveLength(0)
      expect(setup.state.wakes).toBe(0)
      const unknown = yield* setup
        .make()
        .reconcile(setup.command.runnerMessageId)
        .pipe(Effect.catch((error) => Effect.succeed(error)))
      expect(unknown).toMatchObject({ code: "unavailable" })
    }),
  )

  it.effect("reconciles lost submission acknowledgment while the same coordinator Run remains active", () =>
    Effect.gen(function* () {
      const setup = yield* fixture("admitted")
      yield* setup.admit()
      setup.state.coordinatorRun = {
        ...setup.state.coordinatorRun,
        state: "running",
        startedAt: "2026-09-29T00:00:01.000Z",
      }
      expect(yield* setup.make().reconcile(setup.command.runnerMessageId)).toBe("admitted")
      yield* setup.make().recover
      expect(setup.state.starts).toEqual([setup.command.runnerMessageId])
      expect(setup.state.wakes).toBe(1)
    }),
  )

  it.effect("holds an unpromoted input after the coordinator marks its Run terminal", () =>
    Effect.gen(function* () {
      const setup = yield* fixture("admitted")
      yield* setup.admit()
      setup.state.coordinatorRun = { ...setup.state.coordinatorRun, state: "completed" }
      yield* setup.make().recover
      expect(setup.state.execution.phase).toBe("recovery_required")
      expect(setup.state.starts).toHaveLength(0)
      expect(setup.state.wakes).toBe(0)
    }),
  )

  it.effect("holds an unpromoted input after its reserved lease expires", () =>
    Effect.gen(function* () {
      const setup = yield* fixture("admitted")
      yield* setup.admit()
      setup.state.coordinatorRun = {
        ...setup.state.coordinatorRun,
        leaseUntil: new Date(Date.now() - 1_000).toISOString(),
      }
      yield* setup.make().recover
      expect(setup.state.execution.phase).toBe("recovery_required")
      expect(setup.state.starts).toHaveLength(0)
      expect(setup.state.wakes).toBe(0)
    }),
  )

  it.effect("holds an unpromoted input when the coordinator attempt changed", () =>
    Effect.gen(function* () {
      const setup = yield* fixture("admitted")
      yield* setup.admit()
      setup.state.coordinatorRun = { ...setup.state.coordinatorRun, attempt: 2 }
      yield* setup.make().recover
      expect(setup.state.execution.phase).toBe("recovery_required")
      expect(setup.state.wakes).toBe(0)
    }),
  )

  it.effect("holds an unpromoted input when the coordinator owner changed", () =>
    Effect.gen(function* () {
      const setup = yield* fixture("admitted")
      yield* setup.admit()
      setup.state.coordinatorRun = {
        ...setup.state.coordinatorRun,
        executionOwner: { workerId, instanceId: "replacement_instance" },
      }
      yield* setup.make().recover
      expect(setup.state.execution.phase).toBe("recovery_required")
      expect(setup.state.wakes).toBe(0)
    }),
  )

  it.effect("holds an unpromoted input while scoped tool cleanup is unknown", () =>
    Effect.gen(function* () {
      const setup = yield* fixture("admitted")
      yield* setup.admit()
      setup.state.activeTools = "unknown"
      const unknown = yield* setup
        .make()
        .reconcile(setup.command.runnerMessageId)
        .pipe(Effect.catch((error) => Effect.succeed(error)))
      expect(unknown).toMatchObject({ code: "unavailable" })
      expect(setup.state.execution.phase).toBe("admitted")
      expect(setup.state.transitions).toHaveLength(0)
      yield* setup.make().recover
      expect(setup.state.execution.phase).toBe("recovery_required")
      expect(setup.state.wakes).toBe(0)
    }),
  )

  it.effect("holds a prepared command when submission may be in flight", () =>
    Effect.gen(function* () {
      const setup = yield* fixture("prepared")
      setup.state.inspection = "active"
      const unknown = yield* setup
        .make()
        .reconcile(setup.command.runnerMessageId)
        .pipe(Effect.catch((error) => Effect.succeed(error)))
      expect(unknown).toMatchObject({ code: "unavailable" })
      expect(setup.state.execution.phase).toBe("prepared")
      expect(setup.state.transitions).toHaveLength(0)
      yield* setup.make().recover
      expect(setup.state.execution.phase).toBe("recovery_required")
      expect(setup.state.starts).toHaveLength(0)
      expect(setup.state.wakes).toBe(0)
    }),
  )

  it.effect("keeps a held unpromoted input unavailable without reservation proof", () =>
    Effect.gen(function* () {
      const setup = yield* fixture("recovery_required")
      yield* setup.admit()
      setup.state.startUnavailable = true
      setup.state.coordinatorAvailable = false
      const uncertain = yield* setup
        .make()
        .reconcile(setup.command.runnerMessageId)
        .pipe(Effect.catch((error) => Effect.succeed(error)))
      expect(uncertain).toMatchObject({ code: "unavailable" })
      yield* setup.make().recover
      expect(setup.state.starts).toHaveLength(0)
      expect(setup.state.wakes).toBe(0)
      expect(setup.state.execution.phase).toBe("recovery_required")
    }),
  )

  it.effect("reattaches to a live promoted drain after runner replacement without waking it", () =>
    Effect.gen(function* () {
      const setup = yield* fixture("running")
      yield* setup.admit(2)
      setup.state.inspection = "active"
      const replacement = setup.make()
      expect(yield* replacement.reconcile(setup.command.runnerMessageId)).toBe("running")
      yield* replacement.recover
      expect(setup.state.starts).toEqual([setup.command.runnerMessageId])
      expect(setup.state.wakes).toBe(0)
    }),
  )

  it.effect("reconciles a replaced runner against the same live embedded runtime", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const setup = yield* fixture("running")
        yield* setup.admit(2)
        const active = new Set([sessionId])
        const runtimes = yield* RunnerHarnessRuntime.make({
          sessions: { get: () => Effect.succeed(setup.state.authorized.session) },
          execution: {
            active: Effect.sync(() => new Set(active)),
            resume: () => Effect.void,
            wake: () => Effect.void,
            interrupt: () =>
              Effect.sync(() => {
                active.clear()
              }),
          },
          locationReady: () => Effect.void,
          credentials: {
            verify: () => Effect.void,
            principal: (owner) =>
              Effect.succeed({ kind: "runner", workerId: owner.workerId, instanceId: owner.instanceId }),
          },
          policy: {
            workspace: () => Effect.void,
            runtimeAccess: () => Effect.void,
            toolEnvironment: () => Effect.succeed({}),
            artifact: () => Effect.succeed(undefined),
            redact: (text) => text,
          },
          runtimeFailed: () => Effect.succeed(setup.state.execution),
        })
        const runtimeId = yield* runtimes.ensure({
          run: setup.state.execution.run,
          workspace: setup.state.execution.workspace!,
          readinessTimeoutMs: 100,
        })
        setup.state.execution = { ...setup.state.execution, runtime: runtimeId }
        yield* runtimes.watch({
          execution: setup.state.execution,
          session: setup.state.authorized.session,
          readinessTimeoutMs: 100,
          observe: (onReady) => onReady.pipe(Effect.andThen(Effect.never)),
        })
        yield* runtimes.wake(setup.state.execution)

        const replacement = setup.make(runtimes)
        expect(yield* replacement.reconcile(setup.command.runnerMessageId)).toBe("running")
        yield* replacement.recover
        expect(setup.state.starts).toEqual([setup.command.runnerMessageId])
        expect(setup.state.wakes).toBe(0)
        expect((yield* runtimes.inspect(setup.state.execution)).state).toBe("active")
      }),
    ),
  )

  it.effect("keeps an unresolvable promoted run occupied", () =>
    Effect.gen(function* () {
      const setup = yield* fixture("running")
      yield* setup.admit(2)
      setup.state.runtimeAvailable = false
      const unknown = yield* setup
        .make()
        .reconcile(setup.command.runnerMessageId)
        .pipe(Effect.catch((error) => Effect.succeed(error)))
      expect(unknown).toMatchObject({ code: "unavailable" })
      expect(setup.state.execution.phase).toBe("running")
      expect(setup.state.transitions).toHaveLength(0)
      yield* setup.make().recover
      expect(setup.state.execution.phase).toBe("recovery_required")
      expect(setup.state.starts).toHaveLength(0)
    }),
  )

  it.effect("restores observation without waking an uncertain promoted input", () =>
    Effect.gen(function* () {
      const setup = yield* fixture("running")
      yield* setup.admit(2)
      setup.state.inspection = "unknown"
      yield* setup.make().recover
      expect(setup.state.execution.phase).toBe("recovery_required")
      expect(setup.state.starts).toEqual([setup.command.runnerMessageId])
      expect(setup.state.wakes).toBe(0)
    }),
  )

  it.effect("holds a changed attempt and does not deliver its stale callback", () =>
    Effect.gen(function* () {
      const setup = yield* fixture("running")
      yield* setup.admit(2)
      setup.state.authorized = { ...setup.state.authorized, attempt: 2 }
      setup.pending()
      yield* setup.make().recover
      expect(setup.state.flushes).toHaveLength(0)
      expect(setup.state.execution.phase).toBe("recovery_required")
    }),
  )

  it.effect("holds changed execution ownership before callback delivery", () =>
    Effect.gen(function* () {
      const setup = yield* fixture("running")
      yield* setup.admit(2)
      setup.state.authorized = {
        ...setup.state.authorized,
        command: {
          ...setup.state.authorized.command,
          executionOwner: { workerId, instanceId: "replacement_instance" },
        },
      }
      setup.pending()
      yield* setup.make().recover
      expect(setup.state.flushes).toHaveLength(0)
      expect(setup.state.execution.phase).toBe("recovery_required")
    }),
  )

  it.effect("retries completed but unacknowledged reports after coordinator outage", () =>
    Effect.gen(function* () {
      const setup = yield* fixture("completed")
      yield* setup.admit(2)
      setup.pending()
      setup.state.reportAvailable = false
      yield* setup.make().recover
      expect(setup.state.pending).toHaveLength(1)
      expect(setup.state.flushes).toHaveLength(0)
      setup.state.reportAvailable = true
      yield* setup.make().recover
      expect(setup.state.flushes).toEqual(["callback_terminal"])
      expect(setup.state.starts).toHaveLength(0)
    }),
  )

  it.effect("explicit reconciliation retries a terminal callback with the same identity", () =>
    Effect.gen(function* () {
      const setup = yield* fixture("completed")
      yield* setup.admit(2)
      setup.pending()
      setup.state.reportAvailable = false
      const offline = yield* setup
        .make()
        .reconcile(setup.command.runnerMessageId)
        .pipe(Effect.catch((error) => Effect.succeed(error)))
      expect(offline).toMatchObject({ code: "unavailable" })
      expect(setup.state.pending).toHaveLength(1)
      setup.state.reportAvailable = true
      expect(yield* setup.make().reconcile(setup.command.runnerMessageId)).toBe("terminal")
      expect(setup.state.flushes).toEqual(["callback_terminal"])
      expect(setup.state.starts).toHaveLength(0)
    }),
  )

  it.effect("delegates an occupied cancellation to the scoped interruption path", () =>
    Effect.gen(function* () {
      const setup = yield* fixture("cancelling")
      yield* setup.admit(2)
      setup.state.inspection = "active"
      yield* setup.make().recover
      expect(setup.state.interrupts).toBe(1)
      expect(setup.state.execution.phase).toBe("cancelling")
    }),
  )
})
