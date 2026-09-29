import { describe, expect, test } from "bun:test"
import { Coordination } from "@opencode-ai/schema/coordination"
import { Session } from "@opencode-ai/schema/session"
import { Deferred, Effect, Schema } from "effect"
import type { SessionExecution } from "../../src/session/execution"
import type { RunnerHarnessContracts } from "../../src/runner-harness/contracts"
import { RunnerHarnessRuntime } from "../../src/runner-harness/runtime"

const session = Schema.decodeUnknownSync(Session.Info)({
  id: "ses_runtime",
  projectID: "prj_runtime",
  location: { directory: "/tmp/runner-runtime-workspace", workspaceID: "wrk_runtime" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
  title: "Runtime fixture",
})
const owner = Schema.decodeUnknownSync(Coordination.ExecutionOwner)({
  workerId: "worker_runtime",
  instanceId: "instance_runtime",
})
const run: RunnerHarnessContracts.AuthorizedRun = {
  command: {
    runId: Coordination.RunID.make("run_runtime"),
    threadId: Coordination.ThreadID.make("thread_runtime"),
    sessionId: session.id,
    executionOwner: owner,
    runnerMessageId: "msg_runtime",
    text: "Work on the assigned task",
  },
  projectId: session.projectID,
  attempt: 1,
  session,
}
const workspace: RunnerHarnessContracts.WorkspaceIdentity = {
  id: "wrk_runtime",
  threadId: run.command.threadId,
  projectId: run.projectId,
  directory: session.location.directory,
}

function fixture(options?: {
  readonly get?: () => Effect.Effect<Session.Info>
  readonly locationReady?: () => Effect.Effect<void, RunnerHarnessContracts.Failure>
  readonly interrupt?: SessionExecution.Interface["interrupt"]
}) {
  const active = new Set<Session.ID>()
  const failures: string[] = []
  const calls = { wake: 0, interrupt: 0, locationReady: 0 }
  const execution: SessionExecution.Interface = {
    active: Effect.sync(() => new Set(active)),
    resume: () => Effect.void,
    wake: (sessionId) =>
      Effect.sync(() => {
        calls.wake++
        active.add(sessionId)
      }),
    interrupt: (sessionId) =>
      Effect.sync(() => {
        calls.interrupt++
      }).pipe(
        Effect.andThen(
          options?.interrupt?.(sessionId) ??
            Effect.sync(() => {
              active.delete(sessionId)
            }),
        ),
      ),
  }
  const credentials: RunnerHarnessContracts.Credentials = {
    verify: () => Effect.void,
    principal: (value) => Effect.succeed({ kind: "runner", workerId: value.workerId, instanceId: value.instanceId }),
  }
  const policy: RunnerHarnessContracts.SecurityPolicy = {
    workspace: () => Effect.void,
    runtimeAccess: () => Effect.void,
    toolEnvironment: () => Effect.succeed({}),
    artifact: () => Effect.succeed(undefined),
    redact: (value) => value.replaceAll("secret", "[redacted]"),
  }
  const deps: Parameters<typeof RunnerHarnessRuntime.make>[0] = {
    sessions: { get: options?.get ?? (() => Effect.succeed(session)) },
    execution,
    locationReady: () =>
      Effect.sync(() => {
        calls.locationReady++
      }).pipe(Effect.andThen(options?.locationReady?.() ?? Effect.void)),
    credentials,
    policy,
    runtimeFailed: (input) =>
      Effect.sync(() => {
        failures.push(input.reason)
        return { run, phase: "failed" as const, workspace, runtime: input.runtime }
      }),
  }
  return {
    active,
    calls,
    failures,
    deps,
  }
}

describe("embedded runtime lifecycle with service doubles", () => {
  test("attaches to the pinned Session, reports health, and reuses one runtime", async () => {
    const system = fixture()
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtimes = yield* RunnerHarnessRuntime.make(system.deps)
          const [first, second] = yield* Effect.all(
            [
              runtimes.ensure({ run, workspace, readinessTimeoutMs: 100 }),
              runtimes.ensure({ run, workspace, readinessTimeoutMs: 100 }),
            ],
            { concurrency: "unbounded" },
          )
          expect(first).toEqual(second)
          expect(first.workerId).toBe(owner.workerId)
          expect((yield* runtimes.health(first)).state).toBe("ready")
        }),
      ),
    )
  })

  test("conflicting startup owners cannot adopt the same process runtime", async () => {
    const system = fixture()
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtimes = yield* RunnerHarnessRuntime.make(system.deps)
          const other = {
            ...run,
            command: {
              ...run.command,
              executionOwner: { workerId: Coordination.WorkerID.make("worker_other"), instanceId: "instance_other" },
            },
          }
          const results = yield* Effect.all(
            [
              runtimes
                .ensure({ run, workspace, readinessTimeoutMs: 100 })
                .pipe(Effect.match({ onFailure: (error) => error.code, onSuccess: () => "ready" as const })),
              runtimes
                .ensure({ run: other, workspace, readinessTimeoutMs: 100 })
                .pipe(Effect.match({ onFailure: (error) => error.code, onSuccess: () => "ready" as const })),
            ],
            { concurrency: "unbounded" },
          )
          expect(results.sort()).toEqual(["conflict", "ready"])
        }),
      ),
    )
  })

  test("readiness times out and reports failure evidence", async () => {
    const system = fixture({ locationReady: () => Effect.never })
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtimes = yield* RunnerHarnessRuntime.make(system.deps)
          const result = yield* runtimes
            .ensure({ run, workspace, readinessTimeoutMs: 5 })
            .pipe(Effect.match({ onFailure: (error) => error.code, onSuccess: () => "ready" as const }))
          expect(result).toBe("unavailable")
          expect(system.failures).toEqual(["Embedded runtime readiness timed out"])
        }),
      ),
    )
  })

  test("startup diagnostics redact sensitive content", async () => {
    const system = fixture({
      locationReady: () => Effect.fail({ code: "unavailable", message: "secret boot failure" }),
    })
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtimes = yield* RunnerHarnessRuntime.make(system.deps)
          const result = yield* runtimes
            .ensure({ run, workspace, readinessTimeoutMs: 100 })
            .pipe(Effect.match({ onFailure: (error) => error.code, onSuccess: () => "ready" as const }))
          expect(result).toBe("unavailable")
          expect(system.failures).toHaveLength(1)
          expect(system.failures[0]).toContain("[redacted]")
          expect(system.failures[0]).not.toContain("secret")
        }),
      ),
    )
  })

  test("rejects the wrong workspace before attaching or waking", async () => {
    const system = fixture()
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtimes = yield* RunnerHarnessRuntime.make(system.deps)
          const result = yield* runtimes
            .ensure({
              run,
              workspace: { ...workspace, directory: "/tmp/another-workspace" },
              readinessTimeoutMs: 100,
            })
            .pipe(Effect.match({ onFailure: (error) => error.code, onSuccess: () => "ready" as const }))
          expect(result).toBe("conflict")
          expect(system.calls.wake).toBe(0)
          expect(system.calls.locationReady).toBe(0)
        }),
      ),
    )
  })

  test("does not boot services for a stored Session in another workspace", async () => {
    const system = fixture({
      get: () =>
        Effect.succeed({
          ...session,
          location: { ...session.location, directory: "/tmp/another-workspace" as typeof session.location.directory },
        }),
    })
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtimes = yield* RunnerHarnessRuntime.make(system.deps)
          const result = yield* runtimes
            .ensure({ run, workspace, readinessTimeoutMs: 100 })
            .pipe(Effect.match({ onFailure: (error) => error.code, onSuccess: () => "ready" as const }))
          expect(result).toBe("conflict")
          expect(system.calls.locationReady).toBe(0)
        }),
      ),
    )
  })

  test("observes before wake, interrupts its own drain, and shuts down", async () => {
    const system = fixture()
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtimes = yield* RunnerHarnessRuntime.make(system.deps)
          const runtime = yield* runtimes.ensure({ run, workspace, readinessTimeoutMs: 100 })
          const current = { run, phase: "admitted" as const, workspace, runtime }
          yield* runtimes.watch({ execution: current, session, observe: Effect.never })
          yield* runtimes.wake(current)
          yield* runtimes.wake(current)
          expect(system.calls.wake).toBe(1)
          expect((yield* runtimes.inspect(current)).state).toBe("active")
          expect((yield* runtimes.inspect(current)).activeTools).toBe("unknown")
          const stopped = yield* runtimes.interrupt(current)
          expect(stopped.state).toBe("stopped")
          expect(stopped.abort).toBe("acknowledged")
          expect((yield* runtimes.inspect(current)).activeTools).toBe(0)
          yield* runtimes.shutdown(runtime)
          expect((yield* runtimes.health(runtime)).state).toBe("stopped")
        }),
      ),
    )
  })

  test("idle and lost abort responses do not prove tool cleanup", async () => {
    const system = fixture({ interrupt: () => Effect.die(new Error("abort response lost")) })
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtimes = yield* RunnerHarnessRuntime.make(system.deps)
          const runtime = yield* runtimes.ensure({ run, workspace, readinessTimeoutMs: 100 })
          const current = { run, phase: "admitted" as const, workspace, runtime }
          const idle = yield* runtimes.interrupt(current)
          expect(idle).toMatchObject({ abort: "not_delivered", state: "already_idle" })
          expect((yield* runtimes.inspect(current)).activeTools).toBe("unknown")
          system.active.add(session.id)
          expect((yield* runtimes.inspect(current)).state).toBe("unknown")
          expect(yield* runtimes.interrupt(current)).toMatchObject({ abort: "not_delivered", state: "uncertain" })
          expect(system.calls.interrupt).toBe(0)
          system.active.delete(session.id)
          yield* runtimes.watch({ execution: current, session, observe: Effect.never })
          yield* runtimes.wake(current)
          const uncertain = yield* runtimes.interrupt(current)
          expect(uncertain).toMatchObject({ abort: "unknown", state: "uncertain" })
          expect((yield* runtimes.inspect(current)).activeTools).toBe("unknown")
        }),
      ),
    )
  })

  test("starts one bounded delivery tick and stops it on shutdown", async () => {
    const system = fixture()
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtimes = yield* RunnerHarnessRuntime.make(system.deps)
          const runtime = yield* runtimes.ensure({ run, workspace, readinessTimeoutMs: 100 })
          const first = yield* Deferred.make<void>()
          const batches: number[] = []
          const drainDue = (limit: number) =>
            Effect.gen(function* () {
              batches.push(limit)
              yield* Deferred.succeed(first, undefined)
              return 1
            })
          const input = { drainDue, batchSize: 32, intervalMs: 10 }
          yield* runtimes.startDelivery(input)
          yield* runtimes.startDelivery(input)
          yield* Deferred.await(first).pipe(Effect.timeout("1 second"))
          expect(batches[0]).toBe(32)
          const conflict = yield* runtimes
            .startDelivery({ ...input, batchSize: 64 })
            .pipe(Effect.match({ onFailure: (error) => error.code, onSuccess: () => "started" as const }))
          expect(conflict).toBe("conflict")
          yield* runtimes.shutdown(runtime)
          const total = batches.length
          yield* Effect.sleep("30 millis")
          expect(batches).toHaveLength(total)
        }),
      ),
    )
  })

  test("refuses to shut down an unrelated runtime", async () => {
    const system = fixture()
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtimes = yield* RunnerHarnessRuntime.make(system.deps)
          const runtime = yield* runtimes.ensure({ run, workspace, readinessTimeoutMs: 100 })
          const result = yield* runtimes
            .shutdown({ ...runtime, id: "runtime_unrelated" })
            .pipe(Effect.match({ onFailure: (error) => error.code, onSuccess: () => "stopped" as const }))
          expect(result).toBe("forbidden")
          expect((yield* runtimes.health(runtime)).state).toBe("ready")
          expect(system.calls.interrupt).toBe(0)
        }),
      ),
    )
  })
})
