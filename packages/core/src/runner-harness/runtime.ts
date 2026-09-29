export * as RunnerHarnessRuntime from "./runtime"

import { Cause, Deferred, Duration, Effect, Exit, Fiber, Option, Schedule, Scope } from "effect"
import type { SessionV2 } from "../session"
import type { SessionExecution } from "../session/execution"
import type { RunnerHarnessContracts } from "./contracts"

type Dependencies = {
  readonly sessions: Pick<SessionV2.Interface, "get">
  readonly execution: SessionExecution.Interface
  /** Completes only after the Session's Location scoped OpenCode services can be built. */
  readonly locationReady: (
    session: RunnerHarnessContracts.AuthorizedRun["session"],
  ) => Effect.Effect<void, RunnerHarnessContracts.Failure>
  readonly credentials: RunnerHarnessContracts.Credentials
  readonly policy: RunnerHarnessContracts.SecurityPolicy
  readonly localExecution: Pick<RunnerHarnessContracts.Lifecycle, "get">
  readonly runtimeFailed: RunnerHarnessContracts.Lifecycle["runtimeFailed"]
  /** Shorter values are useful for deterministic service-double tests. */
  readonly monitorGraceMs?: number
}

type Watch = {
  readonly sessionId: RunnerHarnessContracts.AuthorizedRun["command"]["sessionId"]
  readonly workspaceId: string
  registered: boolean
  readonly ready: Deferred.Deferred<void, RunnerHarnessContracts.Failure>
}
type RunID = RunnerHarnessContracts.AuthorizedRun["command"]["runId"]

/** One embedded OpenCode runtime belongs to one configured worker instance and one process scope. */
export const make = (deps: Dependencies): Effect.Effect<RunnerHarnessContracts.Runtimes, never, Scope.Scope> =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))

    const runtimeId = `runtime_${crypto.randomUUID()}`
    const watches = new Map<RunID, Watch>()
    const woken = new Map<RunID, RunnerHarnessContracts.AuthorizedRun["command"]["sessionId"]>()
    const uncertainRuns = new Set<RunID>()
    const uncertainSessions = new Set<RunnerHarnessContracts.AuthorizedRun["command"]["sessionId"]>()
    let runtime: RunnerHarnessContracts.RuntimeIdentity | undefined
    let state: RunnerHarnessContracts.RuntimeHealth["state"] = "starting"
    let reason: string | undefined
    let delivery: Parameters<RunnerHarnessContracts.Runtimes["startDelivery"]>[0] | undefined
    let deliveryReason: string | undefined

    const diagnostic = (value: string) =>
      deps.policy
        .redact(value)
        .replace(/[\x00-\x1f\x7f]/g, " ")
        .slice(0, 2_000)

    const owned = (input: RunnerHarnessContracts.RuntimeIdentity) =>
      runtime?.id === input.id && runtime.workerId === input.workerId && runtime.instanceId === input.instanceId

    const requireExecution = (execution: RunnerHarnessContracts.LocalExecution) =>
      Effect.gen(function* () {
        if (!execution.runtime || !owned(execution.runtime))
          return yield* Effect.fail({ code: "forbidden" as const, message: "Runtime is not owned by this runner" })
        if (
          execution.runtime.workerId !== execution.run.command.executionOwner.workerId ||
          execution.runtime.instanceId !== execution.run.command.executionOwner.instanceId
        )
          return yield* Effect.fail({ code: "forbidden" as const, message: "Runtime owner changed" })
        if (state === "stopped")
          return yield* Effect.fail({ code: "unavailable" as const, message: "Runtime has stopped" })
        if (
          !execution.workspace ||
          execution.workspace.threadId !== execution.run.command.threadId ||
          execution.workspace.projectId !== execution.run.projectId ||
          execution.run.session.id !== execution.run.command.sessionId ||
          execution.run.session.location.directory !== execution.workspace.directory ||
          execution.run.session.location.workspaceID !== execution.workspace.id
        )
          return yield* Effect.fail({ code: "conflict" as const, message: "Session and workspace association changed" })
        yield* deps.credentials.verify(execution.run.command.executionOwner)
        const principal = yield* deps.credentials.principal(execution.run.command.executionOwner)
        return { runtime: execution.runtime, principal }
      })

    const reportFailure = (runId: RunID, message: string) =>
      runtime ? deps.runtimeFailed({ runId, runtime, reason: diagnostic(message) }).pipe(Effect.ignore) : Effect.void

    const markUncertain = (execution: RunnerHarnessContracts.LocalExecution) => {
      uncertainRuns.add(execution.run.command.runId)
      uncertainSessions.add(execution.run.command.sessionId)
    }

    const inspectRun: RunnerHarnessContracts.Runtimes["inspect"] = (execution) =>
      Effect.gen(function* () {
        const owner = yield* requireExecution(execution)
        yield* deps.policy.runtimeAccess({
          principal: owner.principal,
          sessionId: execution.run.command.sessionId,
          action: "read",
        })
        const active = yield* Effect.exit(deps.execution.active)
        const isActive = Exit.isSuccess(active) && active.value.has(execution.run.command.sessionId)
        const isOwnedRun =
          watches.get(execution.run.command.runId)?.registered && woken.has(execution.run.command.runId)
        return {
          runtime: owner.runtime,
          sessionId: execution.run.command.sessionId,
          state:
            Exit.isFailure(active) || (isActive && !isOwnedRun)
              ? ("unknown" as const)
              : isActive
                ? ("active" as const)
                : ("idle" as const),
          // The coordinator removes a drain after scoped tool fibers settle. Escaped OS descendants are not tracked.
          activeTools:
            !isActive &&
            Exit.isSuccess(active) &&
            !uncertainRuns.has(execution.run.command.runId) &&
            !uncertainSessions.has(execution.run.command.sessionId)
              ? 0
              : ("unknown" as const),
          checkedAt: Date.now(),
        }
      })

    const monitorDrain = (execution: RunnerHarnessContracts.LocalExecution) =>
      Effect.gen(function* () {
        const runId = execution.run.command.runId
        const sessionId = execution.run.command.sessionId
        const expected = execution.runtime
        if (!expected) return
        const isStopped = () => state === "stopped"

        while (!isStopped() && woken.get(runId) === sessionId) {
          const active = yield* Effect.exit(deps.execution.active)
          if (Exit.isFailure(active)) {
            markUncertain(execution)
            yield* reportFailure(runId, "Owned Session drain health became unavailable")
            return
          }
          if (!active.value.has(sessionId)) break
          yield* Effect.sleep(Duration.millis(100))
        }
        if (isStopped() || woken.get(runId) !== sessionId) return

        const graceMs =
          deps.monitorGraceMs === undefined || !Number.isFinite(deps.monitorGraceMs)
            ? 30_000
            : Math.min(Math.max(Math.floor(deps.monitorGraceMs), 1), 30_000)
        const deadline = performance.now() + graceMs
        while (!isStopped()) {
          const result = yield* Effect.exit(
            deps.localExecution.get(runId).pipe(Effect.timeoutOption(Duration.millis(1_000))),
          )
          if (Exit.isSuccess(result) && Option.isSome(result.value)) {
            const current = result.value.value
            if (!current) {
              markUncertain(execution)
              yield* reportFailure(runId, "Local Run record disappeared after the owned drain ended")
              return
            }
            if (
              current.run.command.runId !== runId ||
              current.run.command.sessionId !== sessionId ||
              current.run.command.runnerMessageId !== execution.run.command.runnerMessageId ||
              current.run.attempt !== execution.run.attempt ||
              current.workspace?.id !== execution.workspace?.id ||
              current.runtime?.id !== expected.id ||
              current.runtime.workerId !== expected.workerId ||
              current.runtime.instanceId !== expected.instanceId
            )
              return
            if (
              current.phase === "completed" ||
              current.phase === "failed" ||
              current.phase === "cancelled" ||
              current.phase === "recovery_required"
            )
              return
          }
          if (performance.now() >= deadline) {
            markUncertain(execution)
            yield* reportFailure(runId, "Owned Session drain ended without a confirmed terminal observation")
            return
          }
          yield* Effect.sleep(Duration.millis(Math.max(1, Math.min(1_000, deadline - performance.now()))))
        }
      })

    return {
      ensure: (input) =>
        Effect.gen(function* () {
          if (!Number.isInteger(input.readinessTimeoutMs) || input.readinessTimeoutMs <= 0)
            return yield* Effect.fail({ code: "invalid" as const, message: "Readiness timeout must be positive" })
          if (state === "stopped")
            return yield* Effect.fail({ code: "unavailable" as const, message: "Runtime has stopped" })
          if (
            input.workspace.threadId !== input.run.command.threadId ||
            input.workspace.projectId !== input.run.projectId ||
            input.run.session.id !== input.run.command.sessionId ||
            input.run.session.location.directory !== input.workspace.directory ||
            input.run.session.location.workspaceID !== input.workspace.id
          )
            return yield* Effect.fail({
              code: "conflict" as const,
              message: "Session and workspace association changed",
            })

          yield* deps.credentials.verify(input.run.command.executionOwner)
          yield* deps.policy.workspace({ run: input.run, workspace: input.workspace })
          const principal = yield* deps.credentials.principal(input.run.command.executionOwner)
          yield* deps.policy.runtimeAccess({ principal, sessionId: input.run.command.sessionId, action: "read" })

          if (
            runtime &&
            !owned({
              id: runtime.id,
              workerId: input.run.command.executionOwner.workerId,
              instanceId: input.run.command.executionOwner.instanceId,
            })
          )
            return yield* Effect.fail({
              code: "conflict" as const,
              message: "Runtime belongs to another worker instance",
            })

          runtime ??= {
            id: runtimeId,
            workerId: input.run.command.executionOwner.workerId,
            instanceId: input.run.command.executionOwner.instanceId,
          }
          if (state !== "ready") {
            state = "starting"
            reason = undefined
          }

          const ready = yield* Effect.exit(
            Effect.gen(function* () {
              const session = yield* deps.sessions.get(input.run.command.sessionId)
              if (
                session.id !== input.run.command.sessionId ||
                session.projectID !== input.run.projectId ||
                session.location.directory !== input.workspace.directory ||
                session.location.workspaceID !== input.workspace.id
              )
                return yield* Effect.fail({
                  code: "conflict" as const,
                  message: "Stored Session belongs to another workspace",
                })
              yield* deps.locationReady(session)
              yield* deps.execution.active
              return session
            }).pipe(Effect.timeoutOption(Duration.millis(Math.min(input.readinessTimeoutMs, 30_000)))),
          )
          if (Exit.isFailure(ready)) {
            const typed = Cause.findErrorOption(ready.cause)
            if (
              Option.isSome(typed) &&
              typeof typed.value === "object" &&
              typed.value !== null &&
              "code" in typed.value &&
              typed.value.code === "conflict"
            )
              return yield* Effect.fail({
                code: "conflict" as const,
                message: "Stored Session belongs to another workspace",
              })
            const failure = diagnostic(Cause.pretty(ready.cause))
            if (state !== "ready") {
              state = "failed"
              reason = failure
            }
            yield* reportFailure(input.run.command.runId, failure)
            return yield* Effect.fail({ code: "unavailable" as const, message: "Embedded runtime readiness failed" })
          }
          if (Option.isNone(ready.value)) {
            const failure = "Embedded runtime readiness timed out"
            if (state !== "ready") {
              state = "failed"
              reason = failure
            }
            yield* reportFailure(input.run.command.runId, failure)
            return yield* Effect.fail({ code: "unavailable" as const, message: failure })
          }

          state = "ready"
          return runtime
        }),
      health: (input) =>
        Effect.gen(function* () {
          if (!owned(input))
            return yield* Effect.fail({ code: "forbidden" as const, message: "Runtime is not owned by this runner" })
          return { runtime: input, state, checkedAt: Date.now(), reason: reason ?? deliveryReason }
        }),
      watch: (input) =>
        Effect.gen(function* () {
          if (!Number.isInteger(input.readinessTimeoutMs) || input.readinessTimeoutMs <= 0)
            return yield* Effect.fail({
              code: "invalid" as const,
              message: "Observer readiness timeout must be positive",
            })
          const owner = yield* requireExecution(input.execution)
          if (state !== "ready")
            return yield* Effect.fail({ code: "unavailable" as const, message: "Runtime is not ready" })
          if (
            input.session.id !== input.execution.run.command.sessionId ||
            input.session.projectID !== input.execution.run.projectId ||
            input.session.location.directory !== input.execution.workspace?.directory ||
            input.session.location.workspaceID !== input.execution.workspace.id
          )
            return yield* Effect.fail({ code: "conflict" as const, message: "Observer Session changed workspace" })
          yield* deps.policy.runtimeAccess({
            principal: owner.principal,
            sessionId: input.session.id,
            action: "read",
          })
          const existing = watches.get(input.execution.run.command.runId)
          if (existing) {
            if (existing.sessionId !== input.session.id || existing.workspaceId !== input.execution.workspace.id)
              return yield* Effect.fail({ code: "conflict" as const, message: "Run already observes another Session" })
            const registered = yield* Deferred.await(existing.ready).pipe(
              Effect.timeoutOption(Duration.millis(Math.min(input.readinessTimeoutMs, 30_000))),
            )
            if (Option.isNone(registered))
              return yield* Effect.fail({ code: "unavailable" as const, message: "Observer readiness timed out" })
            return
          }

          const runId = input.execution.run.command.runId
          const ready = yield* Deferred.make<void, RunnerHarnessContracts.Failure>()
          const watch = {
            sessionId: input.session.id,
            workspaceId: input.execution.workspace.id,
            registered: false,
            ready,
          }
          watches.set(runId, watch)
          const fiber = yield* input
            .observe(
              Effect.sync(() => {
                watch.registered = true
              }).pipe(Effect.andThen(Deferred.succeed(ready, undefined)), Effect.asVoid),
            )
            .pipe(
              Effect.onExit((exit) =>
                Effect.gen(function* () {
                  const stopped = { code: "unavailable" as const, message: "Run observer stopped" }
                  yield* Deferred.fail(ready, stopped)
                  if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) return
                  if (woken.has(runId)) markUncertain(input.execution)
                  else uncertainRuns.add(runId)
                  yield* reportFailure(runId, Exit.isFailure(exit) ? Cause.pretty(exit.cause) : stopped.message)
                }),
              ),
              Effect.ensuring(
                Effect.sync(() => {
                  if (watches.get(runId) === watch) watches.delete(runId)
                }),
              ),
              Effect.forkIn(scope),
            )
          const registered = yield* Effect.exit(
            Deferred.await(ready).pipe(
              Effect.timeoutOption(Duration.millis(Math.min(input.readinessTimeoutMs, 30_000))),
            ),
          )
          if (Exit.isFailure(registered) || Option.isNone(registered.value)) {
            if (watches.get(runId) === watch) watches.delete(runId)
            yield* Fiber.interrupt(fiber).pipe(Effect.timeoutOption(Duration.millis(5_000)))
            if (Exit.isFailure(registered))
              return yield* Effect.fail({
                code: "unavailable" as const,
                message: "Run observer failed before readiness",
              })
            yield* reportFailure(runId, "Observer readiness timed out")
            return yield* Effect.fail({ code: "unavailable" as const, message: "Observer readiness timed out" })
          }
          yield* Effect.yieldNow
          if (watches.get(runId) !== watch)
            return yield* Effect.fail({ code: "unavailable" as const, message: "Run observer stopped after readiness" })
        }),
      wake: (execution) =>
        Effect.gen(function* () {
          const owner = yield* requireExecution(execution)
          if (state !== "ready")
            return yield* Effect.fail({ code: "unavailable" as const, message: "Runtime is not ready" })
          yield* deps.policy.runtimeAccess({
            principal: owner.principal,
            sessionId: execution.run.command.sessionId,
            action: "prompt",
          })
          if (!watches.get(execution.run.command.runId)?.registered)
            return yield* Effect.fail({ code: "conflict" as const, message: "Run observer is not installed" })
          if (woken.has(execution.run.command.runId)) return
          woken.set(execution.run.command.runId, execution.run.command.sessionId)
          // A new wake starts a fresh owned drain; earlier interruption evidence does not describe it.
          uncertainRuns.delete(execution.run.command.runId)
          const started = yield* Effect.exit(deps.execution.wake(execution.run.command.sessionId))
          if (Exit.isSuccess(started)) {
            yield* monitorDrain(execution).pipe(
              Effect.catchCause((cause) =>
                Cause.hasInterruptsOnly(cause)
                  ? Effect.void
                  : Effect.sync(() => markUncertain(execution)).pipe(
                      Effect.andThen(reportFailure(execution.run.command.runId, Cause.pretty(cause))),
                    ),
              ),
              Effect.forkIn(scope),
            )
            return
          }
          woken.delete(execution.run.command.runId)
          markUncertain(execution)
          state = "failed"
          reason = diagnostic(Cause.pretty(started.cause))
          yield* reportFailure(execution.run.command.runId, reason)
          return yield* Effect.fail({ code: "unavailable" as const, message: "Could not wake Session execution" })
        }),
      inspect: inspectRun,
      awaitIdle: (execution, timeoutMs) =>
        Effect.gen(function* () {
          if (!Number.isInteger(timeoutMs) || timeoutMs <= 0)
            return yield* Effect.fail({ code: "invalid" as const, message: "Idle wait timeout must be positive" })
          const owner = yield* requireExecution(execution)
          const runId = execution.run.command.runId
          if (!woken.has(runId) || !watches.get(runId)?.registered)
            return yield* Effect.fail({ code: "conflict" as const, message: "Run has no owned observed drain" })
          const settled = yield* Effect.gen(function* () {
            while (true) {
              const inspection = yield* inspectRun(execution)
              if (inspection.state !== "active" || inspection.activeTools === 0) return inspection
              yield* Effect.sleep(Duration.millis(20))
            }
          }).pipe(Effect.timeoutOption(Duration.millis(Math.min(timeoutMs, 30_000))))
          if (Option.isSome(settled)) return settled.value
          return {
            runtime: owner.runtime,
            sessionId: execution.run.command.sessionId,
            state: "unknown" as const,
            activeTools: "unknown" as const,
            checkedAt: Date.now(),
          }
        }),
      interrupt: (execution) =>
        Effect.gen(function* () {
          const owner = yield* requireExecution(execution)
          yield* deps.policy.runtimeAccess({
            principal: owner.principal,
            sessionId: execution.run.command.sessionId,
            action: "interrupt",
          })
          const before = yield* Effect.exit(deps.execution.active)
          if (Exit.isFailure(before)) {
            markUncertain(execution)
            yield* reportFailure(execution.run.command.runId, "Session interruption was uncertain")
            return {
              runtime: owner.runtime,
              sessionId: execution.run.command.sessionId,
              abort: "unknown" as const,
              state: "uncertain" as const,
              checkedAt: Date.now(),
            }
          }
          if (!before.value.has(execution.run.command.sessionId))
            return {
              runtime: owner.runtime,
              sessionId: execution.run.command.sessionId,
              abort: "not_delivered" as const,
              state: "already_idle" as const,
              checkedAt: Date.now(),
            }
          if (!woken.has(execution.run.command.runId) || !watches.has(execution.run.command.runId)) {
            markUncertain(execution)
            yield* reportFailure(execution.run.command.runId, "Active Session is not owned by this Run")
            return {
              runtime: owner.runtime,
              sessionId: execution.run.command.sessionId,
              abort: "not_delivered" as const,
              state: "uncertain" as const,
              checkedAt: Date.now(),
            }
          }

          const stopped = yield* Effect.exit(
            deps.execution
              .interrupt(execution.run.command.sessionId)
              .pipe(Effect.timeoutOption(Duration.millis(10_000))),
          )
          if (Exit.isFailure(stopped) || Option.isNone(stopped.value)) {
            markUncertain(execution)
            yield* reportFailure(execution.run.command.runId, "Session interruption acknowledgment was lost")
            return {
              runtime: owner.runtime,
              sessionId: execution.run.command.sessionId,
              abort: "unknown" as const,
              state: "uncertain" as const,
              checkedAt: Date.now(),
            }
          }
          const after = yield* Effect.exit(deps.execution.active)
          if (Exit.isFailure(after) || after.value.has(execution.run.command.sessionId)) {
            markUncertain(execution)
            yield* reportFailure(execution.run.command.runId, "Session remained active after interruption")
            return {
              runtime: owner.runtime,
              sessionId: execution.run.command.sessionId,
              abort: "acknowledged" as const,
              state: "uncertain" as const,
              checkedAt: Date.now(),
            }
          }
          // The owner fiber has stopped, but a shell descendant may outlive an ignored group-kill failure.
          markUncertain(execution)
          return {
            runtime: owner.runtime,
            sessionId: execution.run.command.sessionId,
            abort: "acknowledged" as const,
            state: "stopped" as const,
            checkedAt: Date.now(),
          }
        }),
      startDelivery: (input) =>
        Effect.gen(function* () {
          if (state === "stopped")
            return yield* Effect.fail({ code: "unavailable" as const, message: "Runtime has stopped" })
          if (!Number.isInteger(input.batchSize) || input.batchSize < 1 || input.batchSize > 128)
            return yield* Effect.fail({
              code: "invalid" as const,
              message: "Delivery batch size must be within 1..128",
            })
          if (!Number.isInteger(input.intervalMs) || input.intervalMs < 10 || input.intervalMs > 60_000)
            return yield* Effect.fail({
              code: "invalid" as const,
              message: "Delivery interval must be within 10..60000 ms",
            })
          if (delivery) {
            if (
              delivery.drainDue === input.drainDue &&
              delivery.batchSize === input.batchSize &&
              delivery.intervalMs === input.intervalMs
            )
              return
            return yield* Effect.fail({
              code: "conflict" as const,
              message: "Callback delivery loop is already running",
            })
          }
          delivery = input
          yield* input.drainDue(input.batchSize).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                deliveryReason = undefined
              }),
            ),
            Effect.catchCause((cause) =>
              Effect.sync(() => {
                deliveryReason = diagnostic(Cause.pretty(cause))
              }),
            ),
            Effect.asVoid,
            Effect.repeat(Schedule.spaced(Duration.millis(input.intervalMs))),
            Effect.forkIn(scope),
          )
        }),
      shutdown: (input) =>
        Effect.gen(function* () {
          if (!owned(input))
            return yield* Effect.fail({ code: "forbidden" as const, message: "Runtime is not owned by this runner" })
          if (state === "stopped") return
          const sessions = [...new Set(woken.values())]
          const stopped = yield* Effect.exit(
            Effect.forEach(sessions, (sessionId) => deps.execution.interrupt(sessionId), { discard: true }).pipe(
              Effect.timeoutOption(Duration.millis(10_000)),
            ),
          )
          const closed = yield* Effect.exit(
            Scope.close(scope, Exit.void).pipe(Effect.timeoutOption(Duration.millis(10_000))),
          )
          if (
            Exit.isFailure(stopped) ||
            Option.isNone(stopped.value) ||
            Exit.isFailure(closed) ||
            Option.isNone(closed.value)
          ) {
            state = "failed"
            const failure = "Runtime shutdown was incomplete"
            reason = failure
            yield* Effect.forEach(watches.keys(), (runId) => reportFailure(runId, failure), { discard: true })
            return yield* Effect.fail({ code: "unavailable" as const, message: failure })
          }
          watches.clear()
          woken.clear()
          uncertainRuns.clear()
          uncertainSessions.clear()
          state = "stopped"
          reason = undefined
        }),
    } satisfies RunnerHarnessContracts.Runtimes
  })
