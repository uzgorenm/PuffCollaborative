export * as RunnerLifecycle from "./lifecycle"

import { and, eq } from "drizzle-orm"
import { Cause, Effect, Exit, Option } from "effect"
import { isDeepStrictEqual } from "node:util"
import type { Coordination } from "@opencode-ai/schema/coordination"
import { SessionMessage } from "../session/message"
import { SessionV2 } from "../session"
import type { Database } from "../database/database"
import { KeyedMutex } from "../effect/keyed-mutex"
import { Hash } from "../util/hash"
import { ExecutionTable } from "./sql"
import type {
  Artifacts,
  AuthorizedRun,
  CallbackDraft,
  Credentials,
  EventIngestion,
  Failure,
  Lifecycle,
  LocalExecution,
  LocalPhase,
  Observation,
  Recovery,
  ReportDelivery,
  Runtimes,
  SecurityPolicy,
  SessionBinding,
  Workspaces,
} from "./contracts"

export interface Dependencies {
  readonly db: Database.Interface["db"]
  readonly sessions: Pick<SessionV2.Interface, "get" | "prompt">
  readonly binding: SessionBinding
  readonly credentials: Credentials
  readonly policy: SecurityPolicy
  readonly workspaces: Workspaces
  readonly runtimes: Runtimes
  readonly ingestion: EventIngestion
  readonly delivery: ReportDelivery
  readonly artifacts: Artifacts
  readonly approvals: Pick<import("./contracts").Approvals, "requested" | "invalidate">
  readonly recovery: Recovery
  readonly now?: () => number
  readonly readinessTimeoutMs?: number
  readonly settlementTimeoutMs?: number
}

const terminal = new Set<LocalPhase>(["completed", "failed", "cancelled"])
const terminalRun = new Set<Coordination.RunState>(["completed", "failed", "cancelled"])
const allowed: Record<LocalPhase, ReadonlySet<LocalPhase>> = {
  accepted: new Set(["prepared", "cancelling", "recovery_required", "failed"]),
  prepared: new Set(["admitted", "cancelling", "recovery_required", "failed"]),
  admitted: new Set(["running", "cancelling", "recovery_required", "failed"]),
  running: new Set(["waiting_approval", "cancelling", "recovery_required", "completed", "failed"]),
  waiting_approval: new Set(["running", "cancelling", "recovery_required", "failed"]),
  cancelling: new Set(["cancelled", "failed", "recovery_required"]),
  recovery_required: new Set(["running", "cancelled", "failed"]),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
}

const failure = (code: Failure["code"], message: string): Failure => ({ code, message })
type Row = typeof ExecutionTable.$inferSelect

export function make(input: Dependencies): Lifecycle {
  const now = input.now ?? Date.now
  const starts = KeyedMutex.makeUnsafe<Coordination.RunID>()
  const observations = KeyedMutex.makeUnsafe<Coordination.RunID>()

  const load = (row: Row) =>
    Effect.gen(function* () {
      const session = yield* input.sessions
        .get(row.session_id)
        .pipe(Effect.mapError(() => failure("unavailable", "Bound OpenCode Session is missing")))
      if (session.id !== row.session_id || session.projectID !== row.project_id)
        return yield* Effect.fail(failure("conflict", "Stored Run and Session binding differ"))
      if ((row.workspace_id === null) !== (row.workspace_directory === null))
        return yield* Effect.fail(failure("unavailable", "Stored workspace binding is incomplete"))
      return {
        run: {
          command: row.command,
          projectId: row.project_id,
          attempt: row.attempt,
          session,
        },
        phase: row.phase,
        ...(row.workspace_id && row.workspace_directory
          ? {
              workspace: {
                id: row.workspace_id,
                threadId: row.thread_id,
                projectId: row.project_id,
                directory: row.workspace_directory,
              },
            }
          : {}),
        ...(row.runtime_id
          ? { runtime: { id: row.runtime_id, workerId: row.worker_id, instanceId: row.instance_id } }
          : {}),
        ...(row.admitted_message_id ? { admittedMessageId: row.admitted_message_id } : {}),
        ...(row.artifact_baseline ? { artifactBaseline: row.artifact_baseline } : {}),
        ...(row.artifact_report ? { artifactReport: row.artifact_report } : {}),
      } satisfies LocalExecution
    })

  const get: Lifecycle["get"] = (runId) =>
    Effect.gen(function* () {
      const row = yield* input.db
        .select()
        .from(ExecutionTable)
        .where(eq(ExecutionTable.run_id, runId))
        .get()
        .pipe(Effect.orDie)
      return row ? yield* load(row) : undefined
    })

  const byMessageId: Lifecycle["byMessageId"] = (messageId) =>
    Effect.gen(function* () {
      const row = yield* input.db
        .select()
        .from(ExecutionTable)
        .where(eq(ExecutionTable.runner_message_id, messageId))
        .get()
        .pipe(Effect.orDie)
      return row ? yield* load(row) : undefined
    })

  const requireReservation = (run: AuthorizedRun) =>
    Effect.gen(function* () {
      const current = yield* input.binding.currentRun(run.command)
      const lease = Date.parse(current.leaseUntil ?? "")
      if (
        current.id !== run.command.runId ||
        current.threadId !== run.command.threadId ||
        current.runnerMessageId !== run.command.runnerMessageId ||
        current.attempt !== run.attempt ||
        current.executionOwner?.workerId !== run.command.executionOwner.workerId ||
        current.executionOwner?.instanceId !== run.command.executionOwner.instanceId ||
        current.state !== "reserved" ||
        !Number.isFinite(lease) ||
        lease <= now()
      )
        return yield* Effect.fail(failure("conflict", "Coordinator no longer reserves this Run for execution"))
      return undefined
    })

  const accept: Lifecycle["accept"] = (run) =>
    Effect.gen(function* () {
      yield* input.credentials.verify(run.command.executionOwner)
      const principal = yield* input.credentials.principal(run.command.executionOwner)
      if (
        principal.workerId !== run.command.executionOwner.workerId ||
        principal.instanceId !== run.command.executionOwner.instanceId
      )
        return yield* Effect.fail(failure("forbidden", "Runner identity does not match execution owner"))
      yield* input.policy.runtimeAccess({ principal, sessionId: run.command.sessionId, action: "prompt" })
      const trusted = yield* input.binding.authorize(run.command)
      if (
        !sameCommand(trusted.command, run.command) ||
        trusted.projectId !== run.projectId ||
        trusted.session.id !== run.session.id
      )
        return yield* Effect.fail(failure("conflict", "Run differs from trusted coordinator binding"))
      if (trusted.session.id !== run.command.sessionId || trusted.session.projectID !== trusted.projectId)
        return yield* Effect.fail(failure("conflict", "Authorized Run and Session differ"))
      if (!run.command.runnerMessageId.startsWith("msg_") || !run.command.text.trim())
        return yield* Effect.fail(failure("invalid", "Run command has an invalid message ID or empty text"))
      const existing = yield* input.db
        .select()
        .from(ExecutionTable)
        .where(eq(ExecutionTable.run_id, run.command.runId))
        .get()
        .pipe(Effect.orDie)
      if (existing) {
        if (!sameCommand(existing.command, run.command) || existing.project_id !== trusted.projectId)
          return yield* Effect.fail(failure("conflict", "Run ID was reused with a different command"))
        return yield* load(existing)
      }
      yield* requireReservation(trusted)
      const row = yield* input.db
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* tx
              .insert(ExecutionTable)
              .values({
                run_id: run.command.runId,
                thread_id: run.command.threadId,
                project_id: trusted.projectId,
                session_id: run.command.sessionId,
                worker_id: run.command.executionOwner.workerId,
                instance_id: run.command.executionOwner.instanceId,
                attempt: trusted.attempt,
                runner_message_id: run.command.runnerMessageId,
                command: run.command,
                phase: "accepted",
                created_at: now(),
                updated_at: now(),
              })
              .onConflictDoNothing()
              .run()
              .pipe(Effect.orDie)
            return yield* tx
              .select()
              .from(ExecutionTable)
              .where(eq(ExecutionTable.run_id, run.command.runId))
              .get()
              .pipe(Effect.orDie)
          }),
        )
        .pipe(
          Effect.catchTag("SqlError", () =>
            Effect.fail(failure("unavailable", "Local execution database unavailable")),
          ),
        )
      if (!row) return yield* Effect.fail(failure("conflict", "Thread already has an active local execution"))
      if (!sameCommand(row.command, run.command) || row.project_id !== trusted.projectId)
        return yield* Effect.fail(failure("conflict", "Run ID was reused with a different command"))
      return yield* load(row)
    })

  const prepared: Lifecycle["prepared"] = ({ runId, workspace, runtime, sessionId, artifactBaseline }) =>
    Effect.gen(function* () {
      if (
        artifactBaseline.runId !== runId ||
        artifactBaseline.threadId !== workspace.threadId ||
        artifactBaseline.projectId !== workspace.projectId ||
        artifactBaseline.workspaceId !== workspace.id ||
        artifactBaseline.directoryHash !== Hash.sha256(workspace.directory)
      )
        return yield* Effect.fail(failure("conflict", "Artifact baseline belongs to another Run or workspace"))
      const row = yield* input.db
        .transaction((tx) =>
          Effect.gen(function* () {
            const current = yield* tx
              .select()
              .from(ExecutionTable)
              .where(eq(ExecutionTable.run_id, runId))
              .get()
              .pipe(Effect.orDie)
            if (!current) return yield* Effect.fail(failure("not_found", "Local Run is missing"))
            if (
              current.thread_id !== workspace.threadId ||
              current.project_id !== workspace.projectId ||
              current.session_id !== sessionId ||
              current.worker_id !== runtime.workerId ||
              current.instance_id !== runtime.instanceId
            )
              return yield* Effect.fail(failure("conflict", "Prepared workspace, runtime, or Session differs"))
            if (current.phase === "prepared") {
              if (
                current.workspace_id !== workspace.id ||
                current.workspace_directory !== workspace.directory ||
                current.runtime_id !== runtime.id ||
                !isDeepStrictEqual(current.artifact_baseline, artifactBaseline)
              )
                return yield* Effect.fail(failure("conflict", "Prepared Run identity changed"))
              return current
            }
            if (current.phase !== "accepted")
              return yield* Effect.fail(failure("conflict", "Run is not awaiting preparation"))
            const updated = yield* tx
              .update(ExecutionTable)
              .set({
                phase: "prepared",
                workspace_id: workspace.id,
                workspace_directory: workspace.directory,
                runtime_id: runtime.id,
                artifact_baseline: artifactBaseline,
                updated_at: now(),
              })
              .where(and(eq(ExecutionTable.run_id, runId), eq(ExecutionTable.phase, "accepted")))
              .returning()
              .get()
              .pipe(Effect.orDie)
            if (!updated)
              return yield* Effect.fail(failure("conflict", "Run preparation raced with another transition"))
            return updated
          }),
        )
        .pipe(
          Effect.catchTag("SqlError", () =>
            Effect.fail(failure("unavailable", "Local execution database unavailable")),
          ),
        )
      return yield* load(row)
    })

  const admitted: Lifecycle["admitted"] = ({ runId, messageId }) =>
    Effect.gen(function* () {
      const row = yield* input.db
        .transaction((tx) =>
          Effect.gen(function* () {
            const current = yield* tx
              .select()
              .from(ExecutionTable)
              .where(eq(ExecutionTable.run_id, runId))
              .get()
              .pipe(Effect.orDie)
            if (!current) return yield* Effect.fail(failure("not_found", "Local Run is missing"))
            if (current.runner_message_id !== messageId)
              return yield* Effect.fail(failure("conflict", "OpenCode admitted another message ID"))
            if (current.admitted_message_id === messageId) return current
            if (current.phase !== "prepared")
              return yield* Effect.fail(failure("conflict", "Run is not awaiting prompt admission"))
            const updated = yield* tx
              .update(ExecutionTable)
              .set({ phase: "admitted", admitted_message_id: messageId, updated_at: now() })
              .where(and(eq(ExecutionTable.run_id, runId), eq(ExecutionTable.phase, "prepared")))
              .returning()
              .get()
              .pipe(Effect.orDie)
            if (!updated)
              return yield* Effect.fail(failure("conflict", "Prompt admission raced with another transition"))
            return updated
          }),
        )
        .pipe(
          Effect.catchTag("SqlError", () =>
            Effect.fail(failure("unavailable", "Local execution database unavailable")),
          ),
        )
      return yield* load(row)
    })

  const transition: Lifecycle["transition"] = ({ runId, expected, next, callbacks, artifactReport }) =>
    Effect.gen(function* () {
      if (terminal.has(expected) || (expected !== next && !allowed[expected].has(next)))
        return yield* Effect.fail(failure("conflict", `Invalid local transition: ${expected} to ${next}`))
      if (artifactReport && !terminal.has(next))
        return yield* Effect.fail(failure("invalid", "Artifact report requires a terminal transition"))
      if (callbacks.some((draft) => draft.runId !== runId))
        return yield* Effect.fail(failure("conflict", "Callback belongs to another Run"))
      if (
        callbacks.some(
          (draft, index) =>
            draft.callback.kind === "state" &&
            terminalRun.has(draft.callback.nextState) &&
            (!terminal.has(next) || index !== callbacks.length - 1 || draft.callback.nextState !== next),
        )
      )
        return yield* Effect.fail(failure("invalid", "Terminal callback must match the final local phase"))
      if (terminal.has(next)) {
        const last = callbacks.at(-1)
        if (last?.callback.kind !== "state" || last.callback.nextState !== next)
          return yield* Effect.fail(failure("invalid", "Terminal transition requires a final state callback"))
      }
      const row = yield* input.db
        .transaction((tx) =>
          Effect.gen(function* () {
            const current = yield* tx
              .select()
              .from(ExecutionTable)
              .where(eq(ExecutionTable.run_id, runId))
              .get()
              .pipe(Effect.orDie)
            if (!current) return yield* Effect.fail(failure("not_found", "Local Run is missing"))
            if (current.phase !== expected)
              return yield* Effect.fail(failure("conflict", "Stale local Run observation"))
            if (
              artifactReport &&
              (artifactReport.runId !== runId ||
                artifactReport.threadId !== current.thread_id ||
                artifactReport.projectId !== current.project_id ||
                artifactReport.sessionId !== current.session_id ||
                artifactReport.workspaceId !== current.workspace_id ||
                artifactReport.baseline !== current.artifact_baseline?.revision)
            )
              return yield* Effect.fail(failure("conflict", "Artifact report belongs to another execution"))
            if (
              callbacks.some(
                (draft) =>
                  draft.sourceSessionSeq !== undefined &&
                  current.last_session_seq !== null &&
                  draft.sourceSessionSeq < current.last_session_seq,
              )
            )
              return yield* Effect.fail(failure("conflict", "Stale Session observation"))
            const sourceSeq = callbacks.reduce(
              (latest, draft) => Math.max(latest, draft.sourceSessionSeq ?? latest),
              current.last_session_seq ?? -1,
            )
            const updated = yield* tx
              .update(ExecutionTable)
              .set({
                phase: next,
                updated_at: now(),
                ...(sourceSeq >= 0 ? { last_session_seq: sourceSeq } : {}),
                ...(terminal.has(next) ? { terminal_at: now() } : {}),
                ...(artifactReport ? { artifact_report: artifactReport } : {}),
              })
              .where(and(eq(ExecutionTable.run_id, runId), eq(ExecutionTable.phase, expected)))
              .returning()
              .get()
              .pipe(Effect.orDie)
            if (!updated) return yield* Effect.fail(failure("conflict", "Local Run phase changed"))
            if (callbacks.length > 0) yield* input.delivery.append(tx, callbacks)
            return updated
          }),
        )
        .pipe(
          Effect.catchTag("SqlError", () =>
            Effect.fail(failure("unavailable", "Local execution database unavailable")),
          ),
        )
      return yield* load(row)
    })

  const approvalRequested: Lifecycle["approvalRequested"] = (mapping) =>
    Effect.gen(function* () {
      const current = yield* get(mapping.runId)
      if (!current) return yield* Effect.fail(failure("not_found", "Local Run is missing"))
      if (current.run.session.id !== mapping.sessionId)
        return yield* Effect.fail(failure("conflict", "Approval belongs to another Session"))
      if (!mapping.approvalId || !mapping.toolCallId)
        return yield* Effect.fail(failure("invalid", "Approval mapping is incomplete"))
      if (current.phase === "waiting_approval") return current
      return yield* transition({
        runId: mapping.runId,
        expected: "running",
        next: "waiting_approval",
        callbacks: [
          {
            runId: mapping.runId,
            producerKey: `approval:${mapping.approvalId}:tool`,
            callback: {
              kind: "activity",
              state: "running",
              activity: {
                kind: "run.tool",
                toolName: mapping.toolName,
                status: "started",
                summary: mapping.summary,
              },
            },
          },
          {
            runId: mapping.runId,
            producerKey: `approval:${mapping.approvalId}:requested`,
            callback: {
              kind: "state",
              expectedState: "running",
              nextState: "waiting_approval",
              approvalId: mapping.approvalId,
              toolCallId: mapping.toolCallId,
            },
          },
        ],
      })
    })

  const approvalResolved: Lifecycle["approvalResolved"] = (result) =>
    Effect.gen(function* () {
      const current = yield* get(result.mapping.runId)
      if (!current) return yield* Effect.fail(failure("not_found", "Local Run is missing"))
      if (current.run.session.id !== result.mapping.sessionId)
        return yield* Effect.fail(failure("conflict", "Approval belongs to another Session"))
      if (terminal.has(current.phase)) return current
      if (result.delivery === "unknown")
        return yield* transition({
          runId: result.mapping.runId,
          expected: current.phase,
          next: "recovery_required",
          callbacks: [recoveryDraft(current, `approval:${result.decisionId}:unknown`)],
        })
      if (current.phase === "running") return current
      return yield* transition({
        runId: result.mapping.runId,
        expected: "waiting_approval",
        next: "running",
        callbacks: [
          {
            runId: result.mapping.runId,
            producerKey: `approval:${result.decisionId}:resolved`,
            callback: { kind: "state", expectedState: "waiting_approval", nextState: "running" },
          },
        ],
      })
    })

  const cancellationRequested: Lifecycle["cancellationRequested"] = (runId) =>
    starts.withLock(runId)(
      Effect.gen(function* () {
        const current = yield* get(runId)
        if (!current) return yield* Effect.fail(failure("not_found", "Local Run is missing"))
        if (current.phase === "cancelling" || current.phase === "recovery_required" || terminal.has(current.phase))
          return current
        return yield* transition({ runId, expected: current.phase, next: "cancelling", callbacks: [] })
      }),
    )

  const cancellationObserved: Lifecycle["cancellationObserved"] = ({ runId, result }) =>
    Effect.gen(function* () {
      const current = yield* get(runId)
      if (!current) return yield* Effect.fail(failure("not_found", "Local Run is missing"))
      if (terminal.has(current.phase)) return current
      if (
        current.phase !== "cancelling" ||
        current.run.session.id !== result.sessionId ||
        current.runtime?.id !== result.runtime.id ||
        current.runtime.workerId !== result.runtime.workerId ||
        current.runtime.instanceId !== result.runtime.instanceId
      )
        return yield* Effect.fail(failure("conflict", "Cancellation observation belongs to another execution"))
      if (!Number.isSafeInteger(result.checkedAt) || result.checkedAt < 0)
        return yield* Effect.fail(failure("invalid", "Cancellation observation has an invalid timestamp"))
      const row = yield* input.db
        .transaction((tx) =>
          Effect.gen(function* () {
            const stored = yield* tx
              .select()
              .from(ExecutionTable)
              .where(eq(ExecutionTable.run_id, runId))
              .get()
              .pipe(Effect.orDie)
            if (!stored || stored.phase !== "cancelling" || stored.runtime_id !== result.runtime.id)
              return yield* Effect.fail(failure("conflict", "Cancellation observation is stale"))
            if (stored.interrupt_checked_at !== null) {
              if (result.checkedAt < stored.interrupt_checked_at)
                return yield* Effect.fail(
                  failure("conflict", "Older cancellation observation cannot replace newer evidence"),
                )
              if (result.checkedAt === stored.interrupt_checked_at) {
                if (stored.interrupt_abort === result.abort && stored.interrupt_state === result.state) return stored
                return yield* Effect.fail(failure("conflict", "Cancellation evidence changed at the same timestamp"))
              }
            }
            const updated = yield* tx
              .update(ExecutionTable)
              .set({
                interrupt_abort: result.abort,
                interrupt_state: result.state,
                interrupt_checked_at: result.checkedAt,
                updated_at: now(),
              })
              .where(and(eq(ExecutionTable.run_id, runId), eq(ExecutionTable.phase, "cancelling")))
              .returning()
              .get()
              .pipe(Effect.orDie)
            if (!updated)
              return yield* Effect.fail(failure("conflict", "Cancellation observation raced with terminal state"))
            return updated
          }),
        )
        .pipe(
          Effect.catchTag("SqlError", () =>
            Effect.fail(failure("unavailable", "Local execution database unavailable")),
          ),
        )
      return yield* load(row)
    })

  const runtimeFailed: Lifecycle["runtimeFailed"] = ({ runId, runtime }) =>
    Effect.gen(function* () {
      const current = yield* get(runId)
      if (!current) return yield* Effect.fail(failure("not_found", "Local Run is missing"))
      if (terminal.has(current.phase) || current.phase === "recovery_required") return current
      if (
        current.run.command.executionOwner.workerId !== runtime.workerId ||
        current.run.command.executionOwner.instanceId !== runtime.instanceId ||
        (current.runtime && current.runtime.id !== runtime.id)
      )
        return yield* Effect.fail(failure("conflict", "Runtime failure belongs to another Run"))
      if (current.phase === "accepted" && !current.runtime) {
        const row = yield* input.db
          .transaction((tx) =>
            Effect.gen(function* () {
              const updated = yield* tx
                .update(ExecutionTable)
                .set({ phase: "recovery_required", runtime_id: runtime.id, updated_at: now() })
                .where(and(eq(ExecutionTable.run_id, runId), eq(ExecutionTable.phase, "accepted")))
                .returning()
                .get()
                .pipe(Effect.orDie)
              if (!updated)
                return yield* Effect.fail(failure("conflict", "Runtime failure raced with another transition"))
              yield* input.delivery.append(tx, [recoveryDraft(current, `runtime:${runtime.id}:failed`)])
              return updated
            }),
          )
          .pipe(
            Effect.catchTag("SqlError", () =>
              Effect.fail(failure("unavailable", "Local execution database unavailable")),
            ),
          )
        return yield* load(row)
      }
      return yield* transition({
        runId,
        expected: current.phase,
        next: "recovery_required",
        callbacks: [recoveryDraft(current, `runtime:${runtime.id}:failed`)],
      })
    })

  const reattach: Lifecycle["reattach"] = (runId) =>
    starts.withLock(runId)(
      Effect.gen(function* () {
        const current = yield* get(runId)
        if (!current) return yield* Effect.fail(failure("not_found", "Local Run is missing"))
        if (terminal.has(current.phase) || !current.workspace || !current.runtime)
          return yield* Effect.fail(failure("conflict", "Run has no active runtime binding to reattach"))
        yield* input.credentials.verify(current.run.command.executionOwner)
        const principal = yield* input.credentials.principal(current.run.command.executionOwner)
        if (
          principal.workerId !== current.run.command.executionOwner.workerId ||
          principal.instanceId !== current.run.command.executionOwner.instanceId
        )
          return yield* Effect.fail(failure("forbidden", "Runner identity does not match execution owner"))
        const authorized = yield* input.binding.authorize(current.run.command)
        if (
          !sameCommand(authorized.command, current.run.command) ||
          authorized.attempt !== current.run.attempt ||
          authorized.projectId !== current.run.projectId ||
          authorized.session.id !== current.run.session.id ||
          authorized.session.projectID !== current.run.projectId
        )
          return yield* Effect.fail(failure("conflict", "Coordinator Run changed before runtime reattachment"))
        yield* input.policy.workspace({ run: authorized, workspace: current.workspace })
        const runtime = yield* input.runtimes.ensure({
          run: authorized,
          workspace: current.workspace,
          readinessTimeoutMs: input.readinessTimeoutMs ?? 30_000,
        })
        if (
          runtime.workerId !== current.run.command.executionOwner.workerId ||
          runtime.instanceId !== current.run.command.executionOwner.instanceId
        )
          return yield* Effect.fail(failure("conflict", "Current runtime belongs to another execution owner"))
        const session = yield* input.binding.attach({ run: authorized, workspace: current.workspace, runtime })
        if (
          session.id !== current.run.session.id ||
          session.projectID !== current.run.projectId ||
          session.location.directory !== current.workspace.directory ||
          session.location.workspaceID !== current.workspace.id
        )
          return yield* Effect.fail(failure("conflict", "Session binding changed before runtime reattachment"))
        const row = yield* input.db
          .update(ExecutionTable)
          .set({ runtime_id: runtime.id })
          .where(
            and(
              eq(ExecutionTable.run_id, runId),
              eq(ExecutionTable.phase, current.phase),
              eq(ExecutionTable.runtime_id, current.runtime.id),
            ),
          )
          .returning()
          .get()
          .pipe(Effect.mapError(() => failure("unavailable", "Local execution database unavailable")))
        if (!row) return yield* Effect.fail(failure("conflict", "Runtime reattachment raced with a Run transition"))
        return yield* load(row)
      }),
    )

  const holdObservation = (execution: LocalExecution, sourceKey: string) =>
    transition({
      runId: execution.run.command.runId,
      expected: execution.phase,
      next: "recovery_required",
      callbacks: [recoveryDraft(execution, sourceKey)],
    }).pipe(Effect.andThen(input.delivery.flush(execution.run.command.runId)))

  const onObservation = (observed: Observation) =>
    observations.withLock(observed.runId)(
      Effect.gen(function* () {
        if (observed.kind !== "permission" && observed.sourceSessionSeq !== undefined) {
          const row = yield* input.db
            .select()
            .from(ExecutionTable)
            .where(eq(ExecutionTable.run_id, observed.runId))
            .get()
            .pipe(Effect.orDie)
          if (
            row?.last_session_seq !== null &&
            row?.last_session_seq !== undefined &&
            observed.sourceSessionSeq < row.last_session_seq
          )
            return
        }
        const current = yield* get(observed.runId)
        if (!current || terminal.has(current.phase)) return
        if (current.phase === "recovery_required" && observed.kind !== "promoted") return
        if (observed.kind !== "activity" && observed.kind !== "permission") {
          if (observed.messageId !== current.run.command.runnerMessageId) return
        }
        if (observed.kind === "activity") {
          if (current.phase !== "running" && current.phase !== "waiting_approval") return
          yield* transition({
            runId: observed.runId,
            expected: current.phase,
            next: current.phase,
            callbacks: [
              {
                runId: observed.runId,
                producerKey: observed.sourceKey,
                sourceSessionSeq: observed.sourceSessionSeq,
                callback: { kind: "activity", state: current.phase, activity: observed.activity },
              },
            ],
          })
          yield* input.delivery.flush(observed.runId)
          return
        }
        if (observed.kind === "permission") {
          if (current.phase !== "running") return
          const mapping = yield* input.approvals.requested({ execution: current, request: observed.request })
          yield* approvalRequested(mapping)
          yield* input.delivery.flush(observed.runId)
          return
        }
        if (observed.kind === "promoted") {
          if (current.phase !== "admitted" && current.phase !== "recovery_required") return
          yield* transition({
            runId: observed.runId,
            expected: current.phase,
            next: "running",
            callbacks: [
              {
                runId: observed.runId,
                producerKey: observed.sourceKey,
                sourceSessionSeq: observed.sourceSessionSeq,
                callback: {
                  kind: "state",
                  expectedState: current.phase === "recovery_required" ? "recovery_required" : "reserved",
                  nextState: "running",
                },
              },
            ],
          })
          yield* input.delivery.flush(observed.runId)
          return
        }
        if (current.phase !== "running" && !(observed.kind === "failed" && current.phase === "admitted")) return
        if (!current.runtime) return
        const inspected = yield* input.runtimes
          .awaitIdle(current, input.settlementTimeoutMs ?? 30_000)
          .pipe(Effect.exit)
        const settled = yield* get(observed.runId)
        if (!settled || settled.phase !== current.phase) return
        if (!settled.runtime) {
          yield* holdObservation(settled, `observation:${observed.sourceKey}:missing-runtime`)
          return
        }
        if (
          Exit.isFailure(inspected) ||
          inspected.value.sessionId !== settled.run.session.id ||
          inspected.value.runtime.id !== settled.runtime.id ||
          inspected.value.runtime.workerId !== settled.runtime.workerId ||
          inspected.value.runtime.instanceId !== settled.runtime.instanceId ||
          inspected.value.state !== "idle" ||
          inspected.value.activeTools !== 0
        ) {
          yield* holdObservation(settled, `observation:${observed.sourceKey}:unsettled`)
          return
        }
        if (!settled.artifactBaseline) {
          yield* holdObservation(settled, `observation:${observed.sourceKey}:missing-baseline`)
          return
        }
        const collected = yield* input.artifacts
          .collect({ execution: settled, baseline: settled.artifactBaseline })
          .pipe(Effect.exit)
        const verified = yield* get(observed.runId)
        if (!verified || verified.phase !== settled.phase) return
        if (Exit.isFailure(collected)) {
          yield* holdObservation(verified, `observation:${observed.sourceKey}:artifact-error`)
          return
        }
        const activities =
          verified.phase === "running"
            ? collected.value.activity.map(
                (activity, index): CallbackDraft => ({
                  runId: observed.runId,
                  producerKey: `artifact:${observed.sourceKey}:${index}`,
                  callback: { kind: "activity", state: "running", activity },
                }),
              )
            : []
        for (let offset = 0; offset < activities.length; offset += 64)
          yield* transition({
            runId: observed.runId,
            expected: verified.phase,
            next: verified.phase,
            callbacks: activities.slice(offset, offset + 64),
          })
        const next = observed.kind === "settled" ? "completed" : "failed"
        yield* transition({
          runId: observed.runId,
          expected: verified.phase,
          next,
          artifactReport: collected.value,
          callbacks: [
            {
              runId: observed.runId,
              producerKey: observed.sourceKey,
              sourceSessionSeq: observed.sourceSessionSeq,
              callback: {
                kind: "state",
                expectedState: verified.phase === "admitted" ? "reserved" : "running",
                nextState: next,
              },
            },
          ],
        })
        yield* input.delivery.flush(observed.runId)
        yield* input.approvals.invalidate({ runId: observed.runId, reason: "terminal" })
      }),
    )

  const start: Lifecycle["start"] = (command) =>
    starts.withLock(command.runId)(
      Effect.gen(function* () {
        yield* input.credentials.verify(command.executionOwner)
        const run = yield* input.binding.authorize(command)
        if (!sameCommand(run.command, command))
          return yield* Effect.fail(failure("conflict", "Trusted Run command differs from delivered command"))
        const accepted = yield* accept(run)
        if (terminal.has(accepted.phase)) return { messageId: command.runnerMessageId }
        if (accepted.phase === "recovery_required") {
          if (accepted.workspace && accepted.runtime) {
            yield* watch(accepted)
            yield* input.recovery.reconcile(command.runnerMessageId).pipe(Effect.catch(() => Effect.void))
            const observed = yield* get(command.runId)
            if (observed && (observed.phase === "running" || terminal.has(observed.phase)))
              return { messageId: command.runnerMessageId }
          }
          return yield* Effect.fail(failure("unavailable", "Run requires reconciliation"))
        }
        if (accepted.phase === "cancelling")
          return yield* Effect.fail(failure("unavailable", "Run requires cancellation or reconciliation"))
        if (accepted.phase === "admitted" || accepted.phase === "running" || accepted.phase === "waiting_approval") {
          if (accepted.runtime) yield* watch(accepted)
          return { messageId: command.runnerMessageId }
        }
        const setup = yield* Effect.gen(function* () {
          const workspace = yield* input.workspaces.ensure(run)
          yield* input.policy.workspace({ run, workspace })
          const runtime = yield* input.runtimes.ensure({
            run,
            workspace,
            readinessTimeoutMs: input.readinessTimeoutMs ?? 30_000,
          })
          const session = yield* input.binding.attach({ run, workspace, runtime })
          if (session.id !== command.sessionId || session.projectID !== run.projectId)
            return yield* Effect.fail(failure("conflict", "Attached Session differs from authorized Run"))
          if (
            accepted.phase === "prepared" &&
            (accepted.workspace?.id !== workspace.id ||
              accepted.workspace.directory !== workspace.directory ||
              accepted.runtime?.id !== runtime.id)
          )
            return yield* Effect.fail(failure("conflict", "Prepared Run binding changed before retry"))
          const ready = { ...accepted, workspace, runtime }
          if (accepted.phase === "accepted") {
            const inspection = yield* input.runtimes.inspect(ready)
            if (
              inspection.sessionId !== session.id ||
              inspection.runtime.id !== runtime.id ||
              inspection.state !== "idle" ||
              inspection.activeTools !== 0
            )
              return yield* Effect.fail(failure("unavailable", "OpenCode Session is already active or uncertain"))
          }
          const artifactBaseline =
            accepted.phase === "accepted" ? yield* input.artifacts.baseline(ready) : accepted.artifactBaseline
          if (!artifactBaseline)
            return yield* Effect.fail(failure("unavailable", "Prepared Run has no durable artifact baseline"))
          yield* watch(ready)
          return { workspace, runtime, session, ready, artifactBaseline }
        }).pipe(Effect.exit)
        if (Exit.isFailure(setup)) {
          const error = Cause.findErrorOption(setup.cause)
          const code = Option.isSome(error) && isFailure(error.value) ? error.value.code : "unavailable"
          const current = yield* get(command.runId)
          if (current && (current.phase === "accepted" || current.phase === "prepared")) {
            const next =
              current.phase === "accepted" && ["conflict", "forbidden", "invalid"].includes(code)
                ? ("failed" as const)
                : ("recovery_required" as const)
            yield* transition({
              runId: command.runId,
              expected: current.phase,
              next,
              callbacks: [
                {
                  runId: command.runId,
                  producerKey: `preparation:${command.runId}:${next}`,
                  callback: { kind: "state", expectedState: "reserved", nextState: next },
                },
              ],
            })
          }
          return yield* Effect.fail(failure(code, "Runner preparation failed"))
        }
        if (accepted.phase === "prepared") {
          const status = yield* input.recovery
            .reconcile(command.runnerMessageId)
            .pipe(Effect.catch(() => Effect.succeed("unknown" as const)))
          const reconciled = yield* get(command.runId)
          if (reconciled?.phase !== "prepared")
            return yield* Effect.fail(failure("unavailable", "Prepared Run changed during reconciliation"))
          if (status !== "missing") {
            yield* transition({
              runId: command.runId,
              expected: "prepared",
              next: "recovery_required",
              callbacks: [recoveryDraft(setup.value.ready, `submission:${command.runnerMessageId}:unknown`)],
            })
            return yield* Effect.fail(failure("unavailable", "Prompt submission is uncertain"))
          }
        }
        yield* prepared({
          runId: command.runId,
          workspace: setup.value.workspace,
          runtime: setup.value.runtime,
          sessionId: setup.value.session.id,
          artifactBaseline: setup.value.artifactBaseline,
        })
        yield* requireReservation(run)
        const admission = yield* input.sessions
          .prompt({
            id: SessionMessage.ID.make(command.runnerMessageId),
            sessionID: setup.value.session.id,
            prompt: { text: command.text },
            delivery: "queue",
            resume: false,
          })
          .pipe(Effect.exit)
        if (Exit.isFailure(admission)) {
          const typed = Cause.findErrorOption(admission.cause)
          yield* transition({
            runId: command.runId,
            expected: "prepared",
            next: "recovery_required",
            callbacks: [recoveryDraft(setup.value.ready, `submission:${command.runnerMessageId}:uncertain`)],
          })
          if (Option.isSome(typed) && typed.value instanceof SessionV2.PromptConflictError)
            return yield* Effect.fail(failure("conflict", "OpenCode message ID was reused with different input"))
          return yield* Effect.fail(failure("unavailable", "Prompt submission may have been accepted; reconcile it"))
        }
        if (
          admission.value.id !== command.runnerMessageId ||
          admission.value.sessionID !== setup.value.session.id ||
          admission.value.delivery !== "queue" ||
          admission.value.prompt.text !== command.text
        ) {
          yield* transition({
            runId: command.runId,
            expected: "prepared",
            next: "recovery_required",
            callbacks: [recoveryDraft(setup.value.ready, `submission:${command.runnerMessageId}:mismatched`)],
          })
          return yield* Effect.fail(failure("unavailable", "OpenCode returned a mismatched admission"))
        }
        const recorded = yield* admitted({ runId: command.runId, messageId: admission.value.id })
        const wake = yield* input.runtimes.wake(recorded).pipe(Effect.exit)
        if (Exit.isFailure(wake)) {
          yield* runtimeFailed({ runId: command.runId, runtime: setup.value.runtime, reason: "wake_failed" })
          return yield* Effect.fail(failure("unavailable", "OpenCode wake is uncertain; reconcile it"))
        }
        return { messageId: admission.value.id }
      }),
    )

  const watch = (execution: LocalExecution) =>
    Effect.gen(function* () {
      if (!execution.workspace || !execution.runtime)
        return yield* Effect.fail(failure("unavailable", "Run has no prepared workspace or runtime"))
      return yield* input.runtimes.watch({
        execution,
        session: execution.run.session,
        readinessTimeoutMs: input.readinessTimeoutMs ?? 30_000,
        observe: (onReady) =>
          input.ingestion.observe({ execution, session: execution.run.session, onObservation, onReady }),
      })
    })

  return {
    start,
    accept,
    prepared,
    admitted,
    transition,
    approvalRequested,
    approvalResolved,
    cancellationRequested,
    cancellationObserved,
    runtimeFailed,
    reattach,
    get,
    byMessageId,
  }
}

function sameCommand(left: AuthorizedRun["command"], right: AuthorizedRun["command"]) {
  return (
    left.runId === right.runId &&
    left.threadId === right.threadId &&
    left.sessionId === right.sessionId &&
    left.runnerMessageId === right.runnerMessageId &&
    left.text === right.text &&
    left.executionOwner.workerId === right.executionOwner.workerId &&
    left.executionOwner.instanceId === right.executionOwner.instanceId
  )
}

function isFailure(value: unknown): value is Failure {
  if (typeof value !== "object" || value === null || !("code" in value)) return false
  return ["invalid", "unauthorized", "forbidden", "not_found", "conflict", "unavailable"].includes(String(value.code))
}

function recoveryDraft(execution: LocalExecution, producerKey: string): CallbackDraft {
  return {
    runId: execution.run.command.runId,
    producerKey,
    callback: {
      kind: "state",
      expectedState:
        execution.phase === "running" || execution.phase === "waiting_approval" || execution.phase === "cancelling"
          ? execution.phase
          : "reserved",
      nextState: "recovery_required",
    },
  }
}
