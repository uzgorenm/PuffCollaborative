import { describe, expect, test } from "bun:test"
import { Coordination } from "@opencode-ai/schema/coordination"
import { Session } from "@opencode-ai/schema/session"
import { Deferred, Effect, Fiber, Schema } from "effect"
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
const observe = (onReady: Effect.Effect<void>) => onReady.pipe(Effect.andThen(Effect.never))

function fixture(options?: {
  readonly get?: () => Effect.Effect<Session.Info>
  readonly locationReady?: () => Effect.Effect<void, RunnerHarnessContracts.Failure>
  readonly interrupt?: SessionExecution.Interface["interrupt"]
  readonly monitorGraceMs?: number
}) {
  const active = new Set<Session.ID>()
  const failures: string[] = []
  const local: { current?: RunnerHarnessContracts.LocalExecution } = {}
  const calls = { wake: 0, resume: 0, interrupt: 0, locationReady: 0, localGet: 0 }
  const execution: SessionExecution.Interface = {
    active: Effect.sync(() => new Set(active)),
    resume: () =>
      Effect.sync(() => {
        calls.resume++
      }),
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
    localExecution: {
      get: () =>
        Effect.sync(() => {
          calls.localGet++
          return local.current
        }),
    },
    monitorGraceMs: options?.monitorGraceMs,
    runtimeFailed: (input) =>
      Effect.sync(() => {
        failures.push(input.reason)
        local.current = local.current
          ? { ...local.current, phase: "recovery_required" }
          : { run, phase: "recovery_required", workspace, runtime: input.runtime }
        return local.current
      }),
  }
  return {
    active,
    calls,
    failures,
    local,
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

  test("waits for observer registration before allowing a wake", async () => {
    const system = fixture()
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtimes = yield* RunnerHarnessRuntime.make(system.deps)
          const runtime = yield* runtimes.ensure({ run, workspace, readinessTimeoutMs: 100 })
          const current = { run, phase: "admitted" as const, workspace, runtime }
          const entered = yield* Deferred.make<void>()
          const registered = yield* Deferred.make<void>()
          const waiting = yield* runtimes
            .watch({
              execution: current,
              session,
              readinessTimeoutMs: 100,
              observe: (onReady) =>
                Deferred.succeed(entered, undefined).pipe(
                  Effect.andThen(Deferred.await(registered)),
                  Effect.andThen(onReady),
                  Effect.andThen(Effect.never),
                ),
            })
            .pipe(Effect.forkScoped)
          yield* Deferred.await(entered)
          const premature = yield* runtimes
            .wake(current)
            .pipe(Effect.match({ onFailure: (error) => error.code, onSuccess: () => "started" as const }))
          expect(premature).toBe("conflict")
          expect(system.calls.wake).toBe(0)
          yield* Deferred.succeed(registered, undefined)
          yield* Fiber.join(waiting)
          yield* runtimes.wake(current)
          expect(system.calls.wake).toBe(1)
        }),
      ),
    )
  })

  test("times out an observer that never registers", async () => {
    const system = fixture()
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtimes = yield* RunnerHarnessRuntime.make(system.deps)
          const runtime = yield* runtimes.ensure({ run, workspace, readinessTimeoutMs: 100 })
          const current = { run, phase: "admitted" as const, workspace, runtime }
          const result = yield* runtimes
            .watch({ execution: current, session, observe: () => Effect.never, readinessTimeoutMs: 5 })
            .pipe(Effect.match({ onFailure: (error) => error.code, onSuccess: () => "ready" as const }))
          expect(result).toBe("unavailable")
          expect(system.failures).toContain("Observer readiness timed out")
          const wake = yield* runtimes
            .wake(current)
            .pipe(Effect.match({ onFailure: (error) => error.code, onSuccess: () => "started" as const }))
          expect(wake).toBe("conflict")
        }),
      ),
    )
  })

  test("reports an observer startup failure without waking the Session", async () => {
    const system = fixture()
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtimes = yield* RunnerHarnessRuntime.make(system.deps)
          const runtime = yield* runtimes.ensure({ run, workspace, readinessTimeoutMs: 100 })
          const current = { run, phase: "admitted" as const, workspace, runtime }
          const result = yield* runtimes
            .watch({
              execution: current,
              session,
              readinessTimeoutMs: 100,
              observe: () => Effect.fail({ code: "unavailable" as const, message: "secret listener failure" }),
            })
            .pipe(Effect.match({ onFailure: (error) => error.code, onSuccess: () => "ready" as const }))
          expect(result).toBe("unavailable")
          expect(system.calls.wake).toBe(0)
          expect(system.failures.join(" ")).toContain("[redacted]")
          expect(system.failures.join(" ")).not.toContain("secret")
        }),
      ),
    )
  })

  test("waits for the owned drain to settle after its final event", async () => {
    const system = fixture()
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtimes = yield* RunnerHarnessRuntime.make(system.deps)
          const runtime = yield* runtimes.ensure({ run, workspace, readinessTimeoutMs: 100 })
          const current = { run, phase: "running" as const, workspace, runtime }
          yield* runtimes.watch({ execution: current, session, observe, readinessTimeoutMs: 100 })
          yield* runtimes.wake(current)
          expect((yield* runtimes.awaitIdle(current, 5)).state).toBe("unknown")
          const waiting = yield* runtimes.awaitIdle(current, 100).pipe(Effect.forkScoped)
          yield* Effect.sleep("10 millis")
          system.active.delete(session.id)
          expect(yield* Fiber.join(waiting)).toMatchObject({ state: "idle", activeTools: 0 })
        }),
      ),
    )
  })

  test("holds a pre-stream failure when the owned drain becomes idle without terminal evidence", async () => {
    const system = fixture({ monitorGraceMs: 10 })
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtimes = yield* RunnerHarnessRuntime.make(system.deps)
          const runtime = yield* runtimes.ensure({ run, workspace, readinessTimeoutMs: 100 })
          const current = { run, phase: "running" as const, workspace, runtime }
          system.local.current = current
          yield* runtimes.watch({ execution: current, session, observe, readinessTimeoutMs: 100 })
          yield* runtimes.wake(current)
          system.active.delete(session.id)
          yield* Effect.gen(function* () {
            while (system.failures.length === 0) yield* Effect.sleep("1 millis")
          }).pipe(Effect.timeout("1 second"))
          expect(system.failures[0]).toContain("without a confirmed terminal observation")
          expect(system.local.current?.phase).toBe("recovery_required")
          expect(system.calls.wake).toBe(1)
          expect(system.calls.resume).toBe(0)
        }),
      ),
    )
  })

  test("accepts a normal local terminal phase before the idle grace expires", async () => {
    const system = fixture({ monitorGraceMs: 10 })
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtimes = yield* RunnerHarnessRuntime.make(system.deps)
          const runtime = yield* runtimes.ensure({ run, workspace, readinessTimeoutMs: 100 })
          const current = { run, phase: "running" as const, workspace, runtime }
          system.local.current = current
          yield* runtimes.watch({ execution: current, session, observe, readinessTimeoutMs: 100 })
          yield* runtimes.wake(current)
          system.active.delete(session.id)
          system.local.current = { ...current, phase: "completed" }
          yield* Effect.gen(function* () {
            while (system.calls.localGet === 0) yield* Effect.sleep("1 millis")
          }).pipe(Effect.timeout("1 second"))
          yield* Effect.sleep("20 millis")
          expect(system.failures).toEqual([])
          expect(system.calls.resume).toBe(0)
        }),
      ),
    )
  })

  test("does not report a stale drain against a changed Run attempt", async () => {
    const system = fixture({ monitorGraceMs: 10 })
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtimes = yield* RunnerHarnessRuntime.make(system.deps)
          const runtime = yield* runtimes.ensure({ run, workspace, readinessTimeoutMs: 100 })
          const current = { run, phase: "running" as const, workspace, runtime }
          system.local.current = current
          yield* runtimes.watch({ execution: current, session, observe, readinessTimeoutMs: 100 })
          yield* runtimes.wake(current)
          system.active.delete(session.id)
          system.local.current = { ...current, run: { ...run, attempt: 2 } }
          yield* Effect.gen(function* () {
            while (system.calls.localGet === 0) yield* Effect.sleep("1 millis")
          }).pipe(Effect.timeout("1 second"))
          yield* Effect.sleep("20 millis")
          expect(system.failures).toEqual([])
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
          yield* runtimes.watch({ execution: current, session, observe, readinessTimeoutMs: 100 })
          yield* runtimes.wake(current)
          yield* runtimes.wake(current)
          expect(system.calls.wake).toBe(1)
          expect((yield* runtimes.inspect(current)).state).toBe("active")
          expect((yield* runtimes.inspect(current)).activeTools).toBe("unknown")
          const stopped = yield* runtimes.interrupt(current)
          expect(stopped.state).toBe("stopped")
          expect(stopped.abort).toBe("acknowledged")
          expect((yield* runtimes.inspect(current)).activeTools).toBe("unknown")
          expect(
            (yield* runtimes.inspect({
              ...current,
              run: {
                ...run,
                command: {
                  ...run.command,
                  runId: Coordination.RunID.make("run_runtime_followup"),
                  runnerMessageId: "msg_runtime_followup",
                },
              },
            })).activeTools,
          ).toBe("unknown")
          yield* runtimes.shutdown(runtime)
          expect((yield* runtimes.health(runtime)).state).toBe("stopped")
        }),
      ),
    )
  })

  test("shutdown still interrupts a woken Session after its observer fails", async () => {
    const system = fixture()
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtimes = yield* RunnerHarnessRuntime.make(system.deps)
          const runtime = yield* runtimes.ensure({ run, workspace, readinessTimeoutMs: 100 })
          const current = { run, phase: "running" as const, workspace, runtime }
          const failObserver = yield* Deferred.make<void>()
          yield* runtimes.watch({
            execution: current,
            session,
            readinessTimeoutMs: 100,
            observe: (onReady) =>
              onReady.pipe(
                Effect.andThen(Deferred.await(failObserver)),
                Effect.andThen(Effect.fail({ code: "unavailable" as const, message: "Observer lost" })),
              ),
          })
          yield* runtimes.wake(current)
          yield* Deferred.succeed(failObserver, undefined)
          yield* Effect.gen(function* () {
            while (true) {
              const result = yield* runtimes
                .wake(current)
                .pipe(Effect.match({ onFailure: (error) => error.code, onSuccess: () => "started" as const }))
              if (result === "conflict") return
              yield* Effect.sleep("1 millis")
            }
          }).pipe(Effect.timeout("1 second"))
          yield* runtimes.shutdown(runtime)
          expect(system.calls.interrupt).toBe(1)
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
          expect((yield* runtimes.inspect(current)).activeTools).toBe(0)
          system.active.add(session.id)
          expect((yield* runtimes.inspect(current)).state).toBe("unknown")
          expect(yield* runtimes.interrupt(current)).toMatchObject({ abort: "not_delivered", state: "uncertain" })
          expect(system.calls.interrupt).toBe(0)
          system.active.delete(session.id)
          yield* runtimes.watch({ execution: current, session, observe, readinessTimeoutMs: 100 })
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
