import { CoordinationAccess } from "@opencode-ai/core/coordination/access/index"
import { load } from "@opencode-ai/core/coordination/access/identity"
import { CoordinationActivity } from "@opencode-ai/core/coordination/activity/activity"
import { CoordinationApproval } from "@opencode-ai/core/coordination/approval/store"
import { CoordinationComments } from "@opencode-ai/core/coordination/comments/index"
import type { CoordinationContracts } from "@opencode-ai/core/coordination/contracts"
import { CoordinationEvents } from "@opencode-ai/core/coordination/events/events"
import { CoordinationProjects } from "@opencode-ai/core/coordination/projects/index"
import { CoordinationQueue } from "@opencode-ai/core/coordination/queue/queue"
import { RunnerAdapter } from "@opencode-ai/core/coordination/runner/adapter"
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

export interface CoordinationPorts {
  readonly projectAdmission?: CoordinationContracts.ProjectAdmission
  readonly sessionBinding?: CoordinationContracts.SessionBinding
  readonly runnerPort?: CoordinationContracts.RunnerPort
}

export const coordinationLayer = (ports: CoordinationPorts = {}) =>
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
      const mockWorker =
        !ports.runnerPort && CoordinationConfig.mockRunner() ? CoordinationConfig.mockWorker() : undefined
      const workerId = mockWorker as Parameters<CoordinationContracts.Runner["claim"]>[2]["workerId"] | undefined
      const binding = ports.sessionBinding ?? (workerId ? mockSessionBinding(database.db, workerId) : undefined)
      const missing = [
        ...(!identity ? ["identity roster"] : []),
        ...(!admission ? ["trusted project admission"] : []),
        ...(!binding ? ["Session binding"] : []),
        ...(!ports.runnerPort && !workerId ? ["runner port"] : []),
      ]
      if (!identity || !admission || !binding || (!ports.runnerPort && !workerId))
        return CoordinationRuntime.of({ missing, authentication: identity })

      const access = CoordinationAccess.make(database.db)
      const queue = CoordinationQueue.make({ db: database.db, access, events })
      const projects = CoordinationProjects.make({
        db: database.db,
        access,
        events,
        queue,
        projectAdmission: admission,
        sessionBinding: binding,
        members: identity,
      })
      const comments = CoordinationComments.make({ db: database.db, access, events })
      const approvals = CoordinationApproval.make({ db: database.db, events, access, queue })
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
      runner = RunnerAdapter.make({ access, queue, port: ports.runnerPort ?? mock!.port, approvals })
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
      const snapshot = CoordinationSnapshot.make({ database, access, queue, runner, workCards, events })
      return CoordinationRuntime.of({
        missing: [],
        authentication: identity,
        services: { access, projects, comments, snapshot, events, queue, runner, workCards, activity },
      })
    }),
  )
