export * as RunnerHarnessRuntime from "./runtime"

import { Cause, Duration, Effect, Exit, Option, Schedule, Scope } from "effect"
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
  readonly runtimeFailed: RunnerHarnessContracts.Lifecycle["runtimeFailed"]
}

type Watch = {
  readonly sessionId: RunnerHarnessContracts.AuthorizedRun["command"]["sessionId"]
  readonly workspaceId: string
}
type RunID = RunnerHarnessContracts.AuthorizedRun["command"]["runId"]

/** One embedded OpenCode runtime belongs to one configured worker instance and one process scope. */
export const make = (deps: Dependencies): Effect.Effect<RunnerHarnessContracts.Runtimes, never, Scope.Scope> =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))

    const runtimeId = `runtime_${crypto.randomUUID()}`
    const watches = new Map<RunID, Watch>()
    const woken = new Set<RunID>()
    const stoppedRuns = new Set<RunID>()
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
            if (existing.sessionId === input.session.id && existing.workspaceId === input.execution.workspace.id) return
            return yield* Effect.fail({ code: "conflict" as const, message: "Run already observes another Session" })
          }

          const runId = input.execution.run.command.runId
          watches.set(runId, { sessionId: input.session.id, workspaceId: input.execution.workspace.id })
          yield* input.observe.pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause) ? Effect.void : reportFailure(runId, Cause.pretty(cause)),
            ),
            Effect.ensuring(Effect.sync(() => watches.delete(runId))),
            Effect.forkIn(scope),
          )
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
          if (!watches.has(execution.run.command.runId))
            return yield* Effect.fail({ code: "conflict" as const, message: "Run observer is not installed" })
          if (woken.has(execution.run.command.runId)) return
          woken.add(execution.run.command.runId)
          stoppedRuns.delete(execution.run.command.runId)
          const started = yield* Effect.exit(deps.execution.wake(execution.run.command.sessionId))
          if (Exit.isSuccess(started)) return
          state = "failed"
          reason = diagnostic(Cause.pretty(started.cause))
          yield* reportFailure(execution.run.command.runId, reason)
          return yield* Effect.fail({ code: "unavailable" as const, message: "Could not wake Session execution" })
        }),
      inspect: (execution) =>
        Effect.gen(function* () {
          const owner = yield* requireExecution(execution)
          yield* deps.policy.runtimeAccess({
            principal: owner.principal,
            sessionId: execution.run.command.sessionId,
            action: "read",
          })
          const active = yield* Effect.exit(deps.execution.active)
          const isActive = Exit.isSuccess(active) && active.value.has(execution.run.command.sessionId)
          const isOwnedRun = watches.has(execution.run.command.runId) && woken.has(execution.run.command.runId)
          return {
            runtime: owner.runtime,
            sessionId: execution.run.command.sessionId,
            state:
              Exit.isFailure(active) || (isActive && !isOwnedRun)
                ? ("unknown" as const)
                : isActive
                  ? ("active" as const)
                  : ("idle" as const),
            // SessionExecution only exposes drains. Tool cleanup is known only after its interrupt waits for the owner fiber.
            activeTools:
              !isActive && Exit.isSuccess(active) && stoppedRuns.has(execution.run.command.runId)
                ? 0
                : ("unknown" as const),
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
            yield* reportFailure(execution.run.command.runId, "Session remained active after interruption")
            return {
              runtime: owner.runtime,
              sessionId: execution.run.command.sessionId,
              abort: "acknowledged" as const,
              state: "uncertain" as const,
              checkedAt: Date.now(),
            }
          }
          stoppedRuns.add(execution.run.command.runId)
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
          const sessions = [
            ...new Set(
              [...watches.entries()].filter(([runId]) => woken.has(runId)).map(([, watch]) => watch.sessionId),
            ),
          ]
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
          stoppedRuns.clear()
          state = "stopped"
          reason = undefined
        }),
    } satisfies RunnerHarnessContracts.Runtimes
  })
