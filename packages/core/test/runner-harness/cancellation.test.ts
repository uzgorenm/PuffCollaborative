import { describe, expect, test } from "bun:test"
import { DateTime, Effect } from "effect"
import { Coordination } from "@opencode-ai/schema/coordination"
import { Session } from "@opencode-ai/schema/session"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { RunnerCancellation } from "../../src/runner-harness/cancellation"
import { RunnerHarnessContracts } from "../../src/runner-harness/contracts"

function fixture(phase: RunnerHarnessContracts.LocalPhase = "running") {
  const command: RunnerHarnessContracts.StartCommand = {
    runId: Coordination.RunID.make("run_r9"),
    threadId: Coordination.ThreadID.make("thread_r9"),
    sessionId: Session.ID.make("ses_r9"),
    executionOwner: { workerId: Coordination.WorkerID.make("worker_r9"), instanceId: "instance_r9" },
    runnerMessageId: "msg-r9",
    text: "Continue the assigned work",
  }
  const runtime = {
    id: "runtime-r9",
    workerId: command.executionOwner.workerId,
    instanceId: command.executionOwner.instanceId,
  }
  const run: RunnerHarnessContracts.AuthorizedRun = {
    command,
    projectId: Coordination.ProjectID.make("project_r9"),
    attempt: 1,
    session: Session.Info.make({
      id: command.sessionId,
      projectID: Coordination.ProjectID.make("project_r9"),
      title: "R9 cancellation fixture",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
      location: { directory: AbsolutePath.make("/tmp/r9-cancellation") },
    }),
  }
  const stopped: RunnerHarnessContracts.InterruptionResult = {
    runtime,
    sessionId: command.sessionId,
    abort: "acknowledged",
    state: "stopped",
    checkedAt: 10,
  }
  const idle: RunnerHarnessContracts.RuntimeInspection = {
    runtime,
    sessionId: command.sessionId,
    state: "idle",
    activeTools: 0,
    checkedAt: 11,
  }
  const state = {
    execution: { run, runtime, phase } as RunnerHarnessContracts.LocalExecution,
    calls: [] as string[],
    callbacks: [] as RunnerHarnessContracts.CallbackDraft[],
    observations: [] as RunnerHarnessContracts.InterruptionResult[],
    abort: Effect.succeed(stopped) as Effect.Effect<
      RunnerHarnessContracts.InterruptionResult,
      RunnerHarnessContracts.Failure
    >,
    inspect: Effect.succeed(idle) as Effect.Effect<
      RunnerHarnessContracts.RuntimeInspection,
      RunnerHarnessContracts.Failure
    >,
    invalidate: Effect.void as Effect.Effect<void, RunnerHarnessContracts.Failure>,
    verify: Effect.void as Effect.Effect<void, RunnerHarnessContracts.Failure>,
    onTransition: undefined as (() => void) | undefined,
  }
  const dependencies: RunnerCancellation.Dependencies = {
    sessions: {
      authorize: () =>
        Effect.sync(() => {
          state.calls.push("authorize")
          return run
        }),
    },
    credentials: {
      verify: () =>
        Effect.suspend(() => {
          state.calls.push("verify")
          return state.verify
        }),
    },
    lifecycle: {
      get: () => Effect.sync(() => state.execution),
      cancellationRequested: () =>
        Effect.sync(() => {
          state.calls.push("intent")
          if (state.execution.phase !== "completed" && state.execution.phase !== "failed")
            state.execution = { ...state.execution, phase: "cancelling" }
          return state.execution
        }),
      cancellationObserved: (input) =>
        Effect.sync(() => {
          state.calls.push("observed")
          state.observations.push(input.result)
          return state.execution
        }),
      transition: (input) =>
        Effect.suspend(() => {
          state.onTransition?.()
          if (state.execution.phase !== input.expected)
            return Effect.fail({ code: "conflict" as const, message: "Phase changed" })
          state.calls.push(`transition:${input.next}`)
          state.callbacks.push(...input.callbacks)
          state.execution = { ...state.execution, phase: input.next }
          return Effect.succeed(state.execution)
        }),
    },
    runtimes: {
      interrupt: () =>
        Effect.suspend(() => {
          state.calls.push("abort")
          return state.abort
        }),
      inspect: () =>
        Effect.suspend(() => {
          state.calls.push("inspect")
          return state.inspect
        }),
    },
    approvals: {
      invalidate: () =>
        Effect.suspend(() => {
          state.calls.push("invalidate")
          return state.invalidate
        }),
    },
    reports: {
      flush: () =>
        Effect.sync(() => {
          state.calls.push("flush")
        }),
    },
  }
  return { command, stopped, idle, state, cancel: RunnerCancellation.make(dependencies).interrupt }
}

describe("runner cancellation control path", () => {
  test("waits for delayed scoped termination before reporting cancelled", async () => {
    const item = fixture()
    const started = Promise.withResolvers<void>()
    const stop = Promise.withResolvers<RunnerHarnessContracts.InterruptionResult>()
    item.state.abort = Effect.promise(() => {
      started.resolve()
      return stop.promise
    })
    const pending = Effect.runPromise(item.cancel(item.command))
    await started.promise
    expect(item.state.execution.phase).toBe("cancelling")
    expect(item.state.callbacks).toHaveLength(0)
    stop.resolve(item.stopped)
    await pending
    expect(item.state.execution.phase).toBe("cancelled")
    expect(item.state.calls).toContain("invalidate")
    expect(item.state.observations).toEqual([item.stopped])
    expect(item.state.callbacks[0]?.callback).toEqual({
      kind: "state",
      expectedState: "cancelling",
      nextState: "cancelled",
    })
  })

  test("duplicate cancellation retains one terminal report", async () => {
    const item = fixture()
    await Effect.runPromise(item.cancel(item.command))
    await Effect.runPromise(item.cancel(item.command))
    expect(item.state.calls.filter((call) => call === "abort")).toHaveLength(1)
    expect(item.state.callbacks).toHaveLength(1)
    expect(item.state.execution.phase).toBe("cancelled")
  })

  test("concurrent duplicate does not replace a pending confirmed stop with uncertainty", async () => {
    const item = fixture()
    const started = Promise.withResolvers<void>()
    const stop = Promise.withResolvers<RunnerHarnessContracts.InterruptionResult>()
    item.state.abort = Effect.promise(() => {
      started.resolve()
      return stop.promise
    })

    const first = Effect.runPromise(item.cancel(item.command))
    await started.promise
    await Effect.runPromise(item.cancel(item.command))
    expect(item.state.calls.filter((call) => call === "abort")).toHaveLength(1)
    expect(item.state.execution.phase).toBe("cancelling")

    stop.resolve(item.stopped)
    await first
    expect(item.state.execution.phase).toBe("cancelled")
    expect(item.state.callbacks).toHaveLength(1)
  })

  test("cancellation during approval invalidates the pending native mapping", async () => {
    const item = fixture("waiting_approval")
    await Effect.runPromise(item.cancel(item.command))
    expect(item.state.calls.indexOf("invalidate")).toBeLessThan(item.state.calls.indexOf("transition:cancelled"))
    expect(item.state.execution.phase).toBe("cancelled")
  })

  test("a lost abort response remains occupied even if inspection is idle", async () => {
    const item = fixture()
    item.state.abort = Effect.fail({ code: "unavailable", message: "Abort response lost" })
    await Effect.runPromise(item.cancel(item.command))
    expect(item.state.execution.phase).toBe("recovery_required")
    expect(item.state.calls).not.toContain("invalidate")
    expect(item.state.observations).toHaveLength(0)
    expect(item.state.callbacks[0]?.callback).toEqual({
      kind: "state",
      expectedState: "cancelling",
      nextState: "recovery_required",
    })
  })

  test("an already idle drain is not evidence that cancellation caused the stop", async () => {
    const item = fixture()
    item.state.abort = Effect.succeed({ ...item.stopped, state: "already_idle" })
    await Effect.runPromise(item.cancel(item.command))
    expect(item.state.execution.phase).toBe("recovery_required")
    expect(item.state.observations[0]?.abort).toBe("acknowledged")
    expect(item.state.calls).not.toContain("invalidate")
  })

  test("a stopped drain with unknown abort delivery remains uncertain", async () => {
    const item = fixture()
    item.state.abort = Effect.succeed({ ...item.stopped, abort: "unknown" })
    await Effect.runPromise(item.cancel(item.command))
    expect(item.state.observations[0]?.abort).toBe("unknown")
    expect(item.state.execution.phase).toBe("recovery_required")
  })

  test("a natural completion race preserves the existing terminal phase", async () => {
    const item = fixture()
    item.state.onTransition = () => {
      item.state.execution = { ...item.state.execution, phase: "completed" }
    }
    await Effect.runPromise(item.cancel(item.command))
    expect(item.state.execution.phase).toBe("completed")
    expect(item.state.callbacks).toHaveLength(0)
  })

  test("a scoped tool outlasting abort acknowledgment blocks cancellation confirmation", async () => {
    const item = fixture()
    const tool = Bun.spawn(["sleep", "2"], { stdout: "ignore", stderr: "ignore" })
    item.state.inspect = Effect.sync(() => ({ ...item.idle, activeTools: tool.exitCode === null ? 1 : 0 }))
    await Effect.runPromise(item.cancel(item.command))
    expect(item.state.execution.phase).toBe("recovery_required")
    expect(item.state.observations[0]?.abort).toBe("acknowledged")
    expect(tool.exitCode).toBeNull()
    await tool.exited
  })

  test("wrong Session is rejected before cancellation intent or abort", async () => {
    const item = fixture()
    const mismatch = { ...item.command, sessionId: Session.ID.make("ses_other") }
    const result = await Effect.runPromise(Effect.result(item.cancel(mismatch)))
    expect(result._tag).toBe("Failure")
    expect(item.state.calls).toHaveLength(0)
    expect(item.state.execution.phase).toBe("running")
  })

  test("unverified worker identity cannot reach cancellation intent or abort", async () => {
    const item = fixture()
    item.state.verify = Effect.fail({ code: "forbidden", message: "Worker identity mismatch" })
    const result = await Effect.runPromise(Effect.result(item.cancel(item.command)))
    expect(result._tag).toBe("Failure")
    expect(item.state.calls).toEqual(["verify"])
    expect(item.state.execution.phase).toBe("running")
  })
})
