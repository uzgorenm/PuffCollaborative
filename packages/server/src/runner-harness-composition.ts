import { Effect, Deferred, Redacted } from "effect"
import { eq, inArray } from "drizzle-orm"
import { EventV2 } from "@opencode-ai/core/event"
import { Git } from "@opencode-ai/core/git"
import { AppProcess } from "@opencode-ai/core/process"
import { ProjectV2 } from "@opencode-ai/core/project"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionRunner } from "@opencode-ai/core/session/runner"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { RunnerWorkspaces } from "@opencode-ai/core/runner-harness/workspace"
import { RunnerHarnessSession } from "@opencode-ai/core/runner-harness/session"
import { RunnerHarnessRuntime } from "@opencode-ai/core/runner-harness/runtime"
import { make } from "@opencode-ai/core/runner-harness/event-ingest"
import { ReportDelivery } from "@opencode-ai/core/runner-harness/report-delivery"
import { RunnerHarnessApproval } from "@opencode-ai/core/runner-harness/approval"
import { RunnerCancellation } from "@opencode-ai/core/runner-harness/cancellation"
import { RunnerRecovery } from "@opencode-ai/core/runner-harness/recovery"
import { RunnerLifecycle } from "@opencode-ai/core/runner-harness/lifecycle"
import { RunnerArtifacts } from "@opencode-ai/core/runner-harness/artifacts"
import { RunnerCredentials } from "@opencode-ai/core/runner-harness/security/credentials"
import { RunnerSecurityPolicy } from "@opencode-ai/core/runner-harness/security/policy"
import { ApprovalMappingTable } from "@opencode-ai/core/runner-harness/approval.sql"
import { ExecutionTable, ThreadBindingTable } from "@opencode-ai/core/runner-harness/sql"
import type { RunnerHarnessContracts } from "@opencode-ai/core/runner-harness/contracts"
import type { CoordinationContracts } from "@opencode-ai/core/coordination/contracts"
import type { CoordinationRunnerFactoryInput, CoordinationRunnerFactoryResult } from "./coordination-composition"
import { RunnerHarnessConfig } from "./runner-harness-config"

export interface Config {
  readonly owner: Parameters<CoordinationContracts.Runner["claim"]>[2]
  readonly username: string
  readonly password: Redacted.Redacted
  readonly runtimePassword: Redacted.Redacted
  readonly providerPasswords?: ReadonlyArray<Redacted.Redacted>
  readonly workspaceRoot: string
  readonly projects: ReadonlyArray<{
    readonly projectId: RunnerHarnessContracts.AuthorizedRun["projectId"]
    readonly repositoryRoot: string
    readonly baseRevision: string
  }>
  readonly toolPath: string
  readonly destinations?: Readonly<Record<string, string>>
  readonly allowedDestinationHosts?: ReadonlyArray<string>
  readonly allowLoopbackDestination?: boolean
  readonly dataDirectory: string
  readonly deliveryBatchSize?: number
  readonly deliveryIntervalMs?: number
}

const unavailable = (message: string): RunnerHarnessContracts.Failure => ({ code: "unavailable", message })

/** Builds only the authorized runner ports; the coordinator keeps reservation and Run state ownership. */
export function makeRunnerFactory(config: Config) {
  return (input: CoordinationRunnerFactoryInput) =>
    Effect.gen(function* () {
      if (!config.projects.length || !config.workspaceRoot || !config.dataDirectory)
        return yield* Effect.fail(unavailable("Runner workspace configuration is missing"))
      const sessions = yield* SessionV2.Service
      const execution = yield* SessionExecution.Service
      const locations = yield* LocationServiceMap.Service
      const project = yield* ProjectV2.Service
      const flock = yield* EffectFlock.Service
      const git = yield* Git.Service
      const process = yield* AppProcess.Service
      const events = yield* EventV2.Service
      const credentials = yield* RunnerCredentials.make({
        authentication: input.authentication,
        username: config.username,
        password: config.password,
        runtimePassword: config.runtimePassword,
        providerPasswords: config.providerPasswords,
        owner: config.owner,
      })
      const policy = yield* RunnerSecurityPolicy.make({
        credentials,
        projects: config.projects.map((item) => ({
          projectId: item.projectId,
          repositoryRoot: item.repositoryRoot,
          workspaceRoot: config.workspaceRoot,
        })),
        sessionScope: (sessionId) =>
          sessions.get(sessionId).pipe(
            Effect.map((session) => ({
              owner: config.owner,
              projectId: session.projectID,
              directory: session.location.directory,
            })),
            Effect.catch(() => Effect.succeed(undefined)),
          ),
        destinations: config.destinations ?? {},
        allowedDestinationHosts: config.allowedDestinationHosts ?? [],
        allowLoopbackDestination: config.allowLoopbackDestination,
        toolPath: config.toolPath,
        secrets: [config.password, config.runtimePassword, ...(config.providerPasswords ?? [])],
      })

      const permissionFor = (sessionId: RunnerHarnessContracts.StartCommand["sessionId"]) =>
        Effect.gen(function* () {
          const session = yield* sessions.get(sessionId).pipe(Effect.orDie)
          return yield* PermissionV2.Service.pipe(Effect.provide(locations.get(session.location)), Effect.orDie)
        })
      const permission: Pick<PermissionV2.Interface, "get" | "forSession" | "reply"> = {
        get: (requestId) =>
          Effect.gen(function* () {
            const rows = yield* input.db
              .select({ sessionId: ExecutionTable.session_id })
              .from(ExecutionTable)
              .where(
                inArray(ExecutionTable.phase, [
                  "accepted",
                  "prepared",
                  "admitted",
                  "running",
                  "waiting_approval",
                  "cancelling",
                  "recovery_required",
                ]),
              )
              .all()
              .pipe(Effect.orDie)
            const found = yield* Effect.forEach(rows, (row) =>
              permissionFor(row.sessionId).pipe(Effect.flatMap((native) => native.get(requestId))),
            )
            const matches = found.filter((item) => item !== undefined)
            return matches.length === 1 ? matches[0] : undefined
          }),
        forSession: (sessionId) =>
          permissionFor(sessionId).pipe(Effect.flatMap((native) => native.forSession(sessionId))),
        reply: (reply) =>
          Effect.gen(function* () {
            const row = yield* input.db
              .select({ sessionId: ApprovalMappingTable.session_id })
              .from(ApprovalMappingTable)
              .where(eq(ApprovalMappingTable.permission_request_id, reply.requestID))
              .get()
              .pipe(Effect.orDie)
            if (!row) return yield* new PermissionV2.NotFoundError({ requestID: reply.requestID })
            const native = yield* permissionFor(row.sessionId)
            yield* native.reply(reply)
          }),
      }

      const binding = RunnerHarnessSession.make({
        db: input.db,
        access: input.access,
        queue: input.queue,
        session: sessions,
        workerId: config.owner.workerId,
      })
      const workspaces = RunnerWorkspaces.make({
        db: input.db,
        project,
        flock,
        root: config.workspaceRoot,
        sources: Object.fromEntries(
          config.projects.map((item) => [
            item.projectId,
            { repository: item.repositoryRoot, baseRevision: item.baseRevision },
          ]),
        ),
        activity: (workspace) =>
          Effect.gen(function* () {
            const rows = yield* input.db
              .select({ phase: ExecutionTable.phase })
              .from(ExecutionTable)
              .where(eq(ExecutionTable.workspace_id, workspace.id))
              .all()
              .pipe(Effect.orDie)
            if (
              rows.some((row) =>
                [
                  "accepted",
                  "prepared",
                  "admitted",
                  "running",
                  "waiting_approval",
                  "cancelling",
                  "recovery_required",
                ].includes(row.phase),
              )
            )
              return "active" as const
            const binding = yield* input.db
              .select({ sessionId: ThreadBindingTable.session_id })
              .from(ThreadBindingTable)
              .where(eq(ThreadBindingTable.workspace_id, workspace.id))
              .get()
              .pipe(Effect.orDie)
            const active = yield* execution.active
            if (binding && active.has(binding.sessionId)) return "active" as const
            // The pinned spawner cannot prove an earlier Run left no detached child.
            return rows.length > 0 ? ("unknown" as const) : ("idle" as const)
          }),
      })

      const lifecycleReady = yield* Deferred.make<RunnerHarnessContracts.Lifecycle>()
      const coordinatorReady = yield* Deferred.make<CoordinationContracts.Runner>()
      const useLifecycle = <A>(
        method: (lifecycle: RunnerHarnessContracts.Lifecycle) => Effect.Effect<A, RunnerHarnessContracts.Failure>,
      ) => Deferred.await(lifecycleReady).pipe(Effect.flatMap(method))
      const lifecycle: RunnerHarnessContracts.Lifecycle = {
        start: (value) => useLifecycle((service) => service.start(value)),
        accept: (value) => useLifecycle((service) => service.accept(value)),
        prepared: (value) => useLifecycle((service) => service.prepared(value)),
        admitted: (value) => useLifecycle((service) => service.admitted(value)),
        transition: (value) => useLifecycle((service) => service.transition(value)),
        approvalRequested: (value) => useLifecycle((service) => service.approvalRequested(value)),
        approvalResolved: (value) => useLifecycle((service) => service.approvalResolved(value)),
        cancellationRequested: (value) => useLifecycle((service) => service.cancellationRequested(value)),
        cancellationObserved: (value) => useLifecycle((service) => service.cancellationObserved(value)),
        reattach: (value) => useLifecycle((service) => service.reattach(value)),
        runtimeFailed: (value) => useLifecycle((service) => service.runtimeFailed(value)),
        get: (value) => useLifecycle((service) => service.get(value)),
        byMessageId: (value) => useLifecycle((service) => service.byMessageId(value)),
      }
      const runtimes = yield* RunnerHarnessRuntime.make({
        sessions,
        execution,
        locationReady: (session) =>
          Effect.gen(function* () {
            const plugin = yield* PluginV2.Service
            yield* plugin.wait(PluginV2.ID.make("config-provider"))
            const models = yield* SessionRunnerModel.Service
            yield* models.resolve(session)
            yield* PermissionV2.Service
            yield* SessionRunner.Service
          }).pipe(
            Effect.provide(locations.get(session.location)),
            Effect.mapError(() => unavailable("OpenCode location services are unavailable")),
          ),
        credentials,
        policy,
        runtimeFailed: lifecycle.runtimeFailed,
      })
      const ingestion = make({ sessions, events, permissions: permission })
      const delivery = ReportDelivery.make({
        db: input.db,
        callbacks: {
          report: (request) =>
            Deferred.await(coordinatorReady).pipe(Effect.flatMap((runner) => runner.report(request))),
        },
        credentials,
        redact: policy.redact,
      })
      const authority: RunnerHarnessContracts.ApprovalAuthority = {
        verifyDecision: (command) =>
          Effect.gen(function* () {
            const run = yield* input.queue.getRun(command.runId)
            if (!run) return yield* Effect.fail({ code: "not_found" as const, message: "Coordinator Run missing" })
            const runner = yield* Deferred.await(coordinatorReady)
            const approval = (yield* runner.approvals(run.threadId)).find((item) => item.id === command.approvalId)
            if (!approval)
              return yield* Effect.fail({ code: "not_found" as const, message: "Coordinator approval missing" })
            return approval
          }),
      }
      const approvals = RunnerHarnessApproval.make({
        db: input.db,
        lifecycle,
        authority,
        permission,
        redact: policy.redact,
      })
      const cancellations = RunnerCancellation.make({
        sessions: binding,
        credentials,
        lifecycle,
        runtimes,
        approvals,
        reports: delivery,
      })
      const recovery = RunnerRecovery.make({
        db: input.db,
        lifecycle,
        binding,
        runtimes,
        reports: delivery,
        cancellations,
      })
      const artifacts = RunnerArtifacts.make({ git, process, policy, dataDirectory: config.dataDirectory })
      const local = RunnerLifecycle.make({
        db: input.db,
        sessions,
        binding,
        credentials,
        policy,
        workspaces,
        runtimes,
        ingestion,
        delivery,
        approvals,
        recovery,
        artifacts,
      })
      yield* Deferred.succeed(lifecycleReady, local)
      return {
        sessionBinding: binding.coordinator,
        runnerPort: {
          start: local.start,
          interrupt: cancellations.interrupt,
          resolveApproval: approvals.resolve,
          reconcile: recovery.reconcile,
        },
        ready: (runner) =>
          Effect.gen(function* () {
            yield* Deferred.succeed(coordinatorReady, runner)
            yield* recovery.recover
            yield* runtimes.startDelivery({
              drainDue: delivery.drainDue,
              batchSize: config.deliveryBatchSize ?? 32,
              intervalMs: config.deliveryIntervalMs ?? 1_000,
            })
          }),
      } satisfies CoordinationRunnerFactoryResult
    })
}

export function configuredRunnerFactory() {
  if (!RunnerHarnessConfig.path()) return undefined
  return (input: CoordinationRunnerFactoryInput) =>
    RunnerHarnessConfig.load().pipe(Effect.flatMap((config) => makeRunnerFactory(config)(input)))
}
