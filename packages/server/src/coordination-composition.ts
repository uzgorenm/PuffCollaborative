import { CoordinationAccess } from "@opencode-ai/core/coordination/access/index"
import { load } from "@opencode-ai/core/coordination/access/identity"
import { loadDevSessionSelection } from "@opencode-ai/core/coordination/access/selection"
import type { SessionSelection } from "@opencode-ai/core/coordination/access/selection"
import { CoordinationActivity } from "@opencode-ai/core/coordination/activity/activity"
import { CoordinationApproval } from "@opencode-ai/core/coordination/approval/store"
import { CoordinationComments } from "@opencode-ai/core/coordination/comments/index"
import type { CoordinationContracts } from "@opencode-ai/core/coordination/contracts"
import { CoordinationEvents } from "@opencode-ai/core/coordination/events/events"
import { CoordinationProjects } from "@opencode-ai/core/coordination/projects/index"
import { CoordinationProvisioning } from "@opencode-ai/core/coordination/provisioning/index"
import { CoordinationCooperation } from "@opencode-ai/core/coordination/cooperation/index"
import { CoordinationAnalysisResults } from "@opencode-ai/core/coordination/analysis/results"
import { CoordinationQueue } from "@opencode-ai/core/coordination/queue/queue"
import { ProjectContext } from "@opencode-ai/core/coordination/overview/context"
import { RunnerAdapter } from "@opencode-ai/core/coordination/runner/adapter"
import type { ApprovalStore } from "@opencode-ai/core/coordination/runner/adapter"
import { MockRunner } from "@opencode-ai/core/coordination/runner/mock"
import { CoordinationSnapshot } from "@opencode-ai/core/coordination/snapshot"
import { WorkCard } from "@opencode-ai/core/coordination/work-card/work-card"
import { Database } from "@opencode-ai/core/database/database"
import { MembershipTable } from "@opencode-ai/core/coordination/projects/sql"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { CoordinationConfig } from "./coordination-config"
import { loadProjectAdmission, mockSessionBinding } from "./coordination-dev-adapters"
import { CoordinationRuntime } from "./coordination-runtime"
import { loadProvisioningConfig } from "./coordination-provisioning-config"
import { ProjectV2 } from "@opencode-ai/core/project"
import { SessionV2 } from "@opencode-ai/core/session"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { Catalog } from "@opencode-ai/core/catalog"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { makeModelReadiness } from "./coordination-model-readiness"

export interface CoordinationRunnerFactoryInput {
  readonly db: Database.Interface["db"]
  readonly authentication: CoordinationContracts.Authentication
  readonly access: CoordinationContracts.Access
  readonly queue: CoordinationContracts.Queue
  readonly approvals: ApprovalStore
  readonly events: CoordinationContracts.Events
}

export interface CoordinationRunnerFactoryResult {
  readonly owner?: Parameters<CoordinationContracts.Runner["claim"]>[2]
  readonly sessionBinding: CoordinationContracts.SessionBinding
  readonly runnerPort: CoordinationContracts.RunnerPort
  readonly approvalReview?: import("@opencode-ai/core/runner-harness/contracts").RunnerHarnessContracts.Approvals["review"]
  /** Bind callbacks and finish recovery before coordination routes become ready. */
  readonly ready: (runner: CoordinationContracts.Runner) => Effect.Effect<void, CoordinationContracts.Failure>
}

export interface CoordinationPorts<R = never> {
  readonly projectAdmission?: CoordinationContracts.ProjectAdmission
  readonly sessionBinding?: CoordinationContracts.SessionBinding
  readonly sessionSelection?: SessionSelection
  readonly runnerPort?: CoordinationContracts.RunnerPort
  readonly runnerFactory?: (
    input: CoordinationRunnerFactoryInput,
  ) => Effect.Effect<CoordinationRunnerFactoryResult, CoordinationContracts.Failure, R>
}

export const coordinationLayer = <R = never>(ports: CoordinationPorts<R> = {}) =>
  Layer.effect(
    CoordinationRuntime,
    Effect.gen(function* () {
      const database = yield* Database.Service
      const events = yield* CoordinationEvents.Service
      const identityPath = CoordinationConfig.identitiesPath()
      const admissionsPath = CoordinationConfig.admissionsPath()
      const identity = identityPath
        ? yield* load(identityPath).pipe(Effect.match({ onFailure: () => undefined, onSuccess: (value) => value }))
        : undefined
      const admission =
        ports.projectAdmission ??
        (admissionsPath
          ? yield* loadProjectAdmission(admissionsPath).pipe(
              Effect.match({ onFailure: () => undefined, onSuccess: (value) => value }),
            )
          : undefined)
      if (ports.runnerFactory && (ports.sessionBinding || ports.runnerPort || CoordinationConfig.mockRunner()))
        return CoordinationRuntime.of({
          missing: ["conflicting runner configuration"],
          authentication: identity,
        })
      if (!identity || !admission)
        return CoordinationRuntime.of({
          missing: [...(!identity ? ["identity roster"] : []), ...(!admission ? ["trusted project admission"] : [])],
          authentication: identity,
        })
      const access = CoordinationAccess.make(database.db)
      const queue = CoordinationQueue.make({ db: database.db, access, events })
      const approvals = CoordinationApproval.make({ db: database.db, events, access, queue })
      const assembled = ports.runnerFactory
        ? yield* ports
            .runnerFactory({ db: database.db, authentication: identity, access, queue, approvals, events })
            .pipe(Effect.match({ onFailure: () => undefined, onSuccess: (value) => value }))
        : undefined
      const mockWorker =
        !ports.runnerFactory && !ports.runnerPort && CoordinationConfig.mockRunner()
          ? CoordinationConfig.mockWorker()
          : undefined
      const workerId = mockWorker as Parameters<CoordinationContracts.Runner["claim"]>[2]["workerId"] | undefined
      const binding =
        ports.sessionBinding ??
        assembled?.sessionBinding ??
        (workerId ? mockSessionBinding(database.db, workerId) : undefined)
      const port = ports.runnerPort ?? assembled?.runnerPort
      const selectionPath = process.env.OPENCODE_COORDINATION_DEV_SESSION_SELECTIONS_PATH
      const configuredSelection =
        ports.sessionSelection ??
        (selectionPath
          ? yield* loadDevSessionSelection(selectionPath).pipe(
              Effect.match({ onFailure: () => undefined, onSuccess: (value) => value }),
            )
          : undefined)
      const selection = CoordinationProvisioning.selection(database.db, configuredSelection)
      const missing = [
        ...(!binding ? ["Session binding"] : []),
        ...(!port && !workerId ? [ports.runnerFactory ? "runner factory" : "runner port"] : []),
      ]
      if (!binding || (!port && !workerId)) return CoordinationRuntime.of({ missing, authentication: identity })

      const projects = CoordinationProjects.make({
        db: database.db,
        access,
        events,
        queue,
        projectAdmission: admission,
        sessionBinding: binding,
        sessionSelection: selection,
        members: identity,
      })
      const comments = CoordinationComments.make({ db: database.db, access, events })
      let runner: CoordinationContracts.Runner
      const mock = workerId
        ? MockRunner.createMockRunner({
            report: (callback) =>
              Effect.runPromise(
                runner
                  .report({
                    ...callback,
                    principal: { kind: "runner", workerId, instanceId: CoordinationConfig.mockInstance() },
                  })
                  .pipe(Effect.asVoid),
              ),
            plan: (command) => [
              {
                kind: "activity",
                activity: { kind: "run.tool", toolName: "mock", status: "completed", summary: "Mock turn started" },
              },
              {
                kind: "activity",
                activity: { kind: "run.output", text: `Mock response: ${command.text.slice(0, 7900)}` },
              },
              ...(command.text.includes("[approval]")
                ? [
                    {
                      kind: "approval" as const,
                      approvalId: `approval_${command.runId}`,
                      toolCallId: `tool_${command.runId}`,
                    },
                  ]
                : []),
              { kind: "complete" },
            ],
          })
        : undefined
      runner = RunnerAdapter.make({ access, queue, port: port ?? mock!.port, approvals })
      if (assembled) {
        const ready = yield* assembled
          .ready(runner)
          .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }))
        if (!ready) return CoordinationRuntime.of({ missing: ["runner startup"], authentication: identity })
      }
      const workCards = yield* WorkCard.make({
        access,
        events,
        projectMembers: (projectId) =>
          database.db
            .select({ userId: MembershipTable.user_id })
            .from(MembershipTable)
            .where(eq(MembershipTable.project_id, projectId))
            .all()
            .pipe(
              Effect.map((rows) => rows.map((row) => row.userId)),
              Effect.orDie,
            ),
      })
      const activity = CoordinationActivity.make({ access, projects, queue, runner, events, cards: workCards })
      const projectContext = ProjectContext.make({ db: database.db, access, events })
      const snapshot = CoordinationSnapshot.make({ database, access, queue, runner, workCards, events })
      const cooperation = CoordinationCooperation.make({ db: database.db, access })
      const sharedSessions = yield* SessionV2.Service
      const analysisResults = CoordinationAnalysisResults.make({
        database,
        sessions: sharedSessions,
        access,
        events,
        binding,
        cooperation,
      })
      const provisioningPath = CoordinationConfig.provisioningPath()
      const provisioningConfig = provisioningPath ? yield* loadProvisioningConfig(provisioningPath) : undefined
      const executionOwner =
        assembled?.owner ?? (workerId ? { workerId, instanceId: CoordinationConfig.mockInstance() } : undefined)
      const provisioning =
        provisioningConfig &&
        executionOwner &&
        provisioningConfig.worker.workerId === executionOwner.workerId &&
        provisioningConfig.worker.instanceId === executionOwner.instanceId
          ? yield* Effect.gen(function* () {
              const project = yield* ProjectV2.Service
              const sessions = yield* SessionV2.Service
              const locations = yield* LocationServiceMap.Service
              const flock = yield* EffectFlock.Service
              const modelReadiness = yield* makeModelReadiness()
              return CoordinationProvisioning.make({
                db: database.db,
                project,
                sessions,
                flock,
                projects,
                access,
                admission,
                config: provisioningConfig,
                ready: (directory, model) =>
                  modelReadiness(
                    `${directory}\u0000${model.providerID}\u0000${model.id}`,
                    Effect.gen(function* () {
                      const plugin = yield* PluginV2.Service
                      yield* plugin.wait(PluginV2.ID.make("config-provider"))
                      const catalog = yield* Catalog.Service
                      return (yield* catalog.model.available()).some(
                        (item) =>
                          item.id === model.id &&
                          item.providerID === model.providerID &&
                          SessionRunnerModel.supported(item),
                      )
                    }).pipe(
                      Effect.provide(locations.get({ directory: AbsolutePath.make(directory) })),
                      Effect.catch(() => Effect.succeed(false)),
                    ),
                  ),
              })
            })
          : undefined
      return CoordinationRuntime.of({
        missing: [],
        authentication: identity,
        services: {
          access,
          projects,
          comments,
          snapshot,
          events,
          queue,
          runner,
          approvalReview: assembled?.approvalReview,
          workCards,
          activity,
          projectContext,
          provisioning,
          cooperation,
          sessionBinding: binding,
          analysisResults,
        },
      })
    }),
  )
