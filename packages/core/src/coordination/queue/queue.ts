export * as CoordinationQueue from "./queue"

import { Context, Effect, Layer } from "effect"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { isDeepStrictEqual } from "node:util"
import { Coordination } from "@opencode-ai/schema/coordination"
import { Database } from "../../database/database"
import { SessionMessage } from "../../session/message"
import type { CoordinationContracts } from "../contracts"
import { InstructionTable, RunCallbackTable, RunTable } from "./sql"

type Queue = CoordinationContracts.Queue
type Principal = Parameters<Queue["submit"]>[0]["principal"]
type InstructionRow = typeof InstructionTable.$inferSelect
type RunRow = typeof RunTable.$inferSelect

const occupied = ["reserved", "running", "waiting_approval", "cancelling", "recovery_required"] as const
const transitions: Record<Coordination.RunState, ReadonlyArray<Coordination.RunState>> = {
  queued: ["reserved", "cancelled"],
  reserved: ["running", "cancelling", "failed", "recovery_required"],
  running: ["waiting_approval", "cancelling", "completed", "failed", "recovery_required"],
  waiting_approval: ["running", "cancelling", "failed", "recovery_required"],
  cancelling: ["cancelled", "failed", "recovery_required"],
  recovery_required: ["running", "cancelled", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
}

class Aborted extends Error {
  readonly reason: "retry" | "race"
  constructor(reason: "retry" | "race") {
    super(reason)
    this.reason = reason
  }
}

const isTerminal = (state: Coordination.RunState) =>
  state === "completed" || state === "failed" || state === "cancelled"

export interface Dependencies {
  readonly db: Database.Interface["db"]
  readonly access: CoordinationContracts.Access
  readonly events: CoordinationContracts.Events
  readonly now?: () => number
}

export class Service extends Context.Service<Service, Queue>()("@opencode/CoordinationQueue") {}

export const layerWith = (input: Omit<Dependencies, "db">) =>
  Layer.effect(
    Service,
    Effect.map(Database.Service, ({ db }) => Service.of(make({ ...input, db }))),
  )

/** The idempotency scope is the authenticated member and Thread, not the HTTP connection. */
export function make(input: Dependencies): Queue {
  const db = input.db
  const now = input.now ?? Date.now
  const fail = (code: CoordinationContracts.ErrorCode, message: string): CoordinationContracts.Failure => ({
    code,
    message,
  })

  const instruction = (row: InstructionRow): Coordination.InstructionRequest => ({
    id: row.id,
    requestId: row.request_id,
    threadId: row.thread_id,
    actorId: row.actor_id,
    text: row.text,
    queueSeq: row.queue_seq,
    submittedAt: new Date(row.submitted_at).toISOString(),
    runId: row.run_id,
  })
  const run = (row: RunRow): Coordination.Run => ({
    id: row.id,
    threadId: row.thread_id,
    instructionId: row.instruction_id,
    state: row.state,
    attempt: row.attempt,
    runnerMessageId: row.runner_message_id,
    ...(row.execution_owner_worker_id && row.execution_owner_instance_id
      ? {
          executionOwner: {
            workerId: row.execution_owner_worker_id,
            instanceId: row.execution_owner_instance_id,
          },
        }
      : {}),
    ...(row.lease_until === null ? {} : { leaseUntil: new Date(row.lease_until).toISOString() }),
    createdAt: new Date(row.created_at).toISOString(),
    ...(row.started_at === null ? {} : { startedAt: new Date(row.started_at).toISOString() }),
    ...(row.ended_at === null ? {} : { endedAt: new Date(row.ended_at).toISOString() }),
  })

  const readRun = (runId: Coordination.RunID) =>
    db.select().from(RunTable).where(eq(RunTable.id, runId)).get().pipe(Effect.orDie)
  const readInstruction = (instructionId: Coordination.InstructionID) =>
    db.select().from(InstructionTable).where(eq(InstructionTable.id, instructionId)).get().pipe(Effect.orDie)
  const readRequest = (threadId: Coordination.ThreadID, actorId: Coordination.UserID, requestId: string) =>
    db
      .select()
      .from(InstructionTable)
      .where(
        and(
          eq(InstructionTable.thread_id, threadId),
          eq(InstructionTable.actor_id, actorId),
          eq(InstructionTable.request_id, requestId),
        ),
      )
      .get()
      .pipe(Effect.orDie)
  const readActive = (threadId: Coordination.ThreadID) =>
    db
      .select()
      .from(RunTable)
      .where(and(eq(RunTable.thread_id, threadId), inArray(RunTable.state, occupied)))
      .get()
      .pipe(Effect.orDie)
  const readNext = (threadId: Coordination.ThreadID) =>
    db
      .select({ instruction: InstructionTable, run: RunTable })
      .from(InstructionTable)
      .innerJoin(RunTable, eq(RunTable.instruction_id, InstructionTable.id))
      .where(and(eq(InstructionTable.thread_id, threadId), eq(RunTable.state, "queued")))
      .orderBy(asc(InstructionTable.queue_seq))
      .get()
      .pipe(Effect.orDie)
  const pair = (row: InstructionRow) =>
    Effect.gen(function* () {
      const stored = yield* readRun(row.run_id)
      if (!stored) return yield* Effect.fail(fail("unavailable", "Instruction has no Run"))
      return { instruction: instruction(row), run: run(stored) }
    })
  const sameOwner = (row: RunRow, owner: Coordination.ExecutionOwner) =>
    row.execution_owner_worker_id === owner.workerId && row.execution_owner_instance_id === owner.instanceId
  const actorId = (principal: Principal) => {
    if (principal.kind !== "member") return undefined
    return principal.userId
  }
  const owner = (principal: Principal): Coordination.ExecutionOwner | undefined =>
    principal.kind === "runner" ? { workerId: principal.workerId, instanceId: principal.instanceId } : undefined
  const authorizedThread = (
    principal: Principal,
    threadId: Coordination.ThreadID,
    action: CoordinationContracts.Action,
  ) => input.access.getThread(principal, threadId, action)

  const submit: Queue["submit"] = ({ principal, threadId, requestId, text }) =>
    Effect.gen(function* () {
      const member = actorId(principal)
      if (!member) return yield* Effect.fail(fail("forbidden", "A member credential is required"))
      if (!requestId.trim() || requestId.length > 256) return yield* Effect.fail(fail("invalid", "Invalid requestId"))
      if (!text.trim() || text.length > 8_000)
        return yield* Effect.fail(fail("invalid", "Instruction text must contain 1 to 8,000 characters"))
      const thread = yield* authorizedThread(principal, threadId, "submit")
      const prior = yield* readRequest(threadId, member, requestId)
      if (prior) {
        if (prior.text !== text || prior.project_id !== thread.projectId)
          return yield* Effect.fail(fail("conflict", "requestId already has different instruction data"))
        return yield* pair(prior)
      }

      const id = Coordination.InstructionID.make(`ins_${crypto.randomUUID()}`)
      const runId = Coordination.RunID.make(`run_${crypto.randomUUID()}`)
      const messageId = SessionMessage.ID.create()
      const timestamp = now()
      yield* input.events
        .append(
          {
            projectId: thread.projectId,
            threadId,
            kind: "instruction.submitted",
            occurredAt: new Date(timestamp).toISOString(),
            actorId: member,
            runId,
            instructionId: id,
            payload: { requestId, text },
          },
          () =>
            Effect.gen(function* () {
              const currentThread = yield* authorizedThread(principal, threadId, "submit")
              if (currentThread.projectId !== thread.projectId) return yield* Effect.die(new Aborted("race"))
              const existing = yield* readRequest(threadId, member, requestId)
              if (existing) return yield* Effect.die(new Aborted("retry"))
              const highest = yield* db
                .select({ value: sql<number>`coalesce(max(${InstructionTable.queue_seq}), 0)` })
                .from(InstructionTable)
                .where(eq(InstructionTable.thread_id, threadId))
                .get()
                .pipe(Effect.orDie)
              yield* db
                .insert(InstructionTable)
                .values({
                  id,
                  request_id: requestId,
                  project_id: thread.projectId,
                  thread_id: threadId,
                  actor_id: member,
                  text,
                  queue_seq: (highest?.value ?? 0) + 1,
                  submitted_at: timestamp,
                  run_id: runId,
                })
                .run()
                .pipe(Effect.orDie)
              yield* db
                .insert(RunTable)
                .values({
                  id: runId,
                  thread_id: threadId,
                  instruction_id: id,
                  state: "queued",
                  attempt: 0,
                  runner_message_id: messageId,
                  created_at: timestamp,
                })
                .run()
                .pipe(Effect.orDie)
              return undefined
            }),
        )
        .pipe(
          Effect.catchDefect((defect) =>
            defect instanceof Aborted && defect.reason === "retry" ? Effect.void : Effect.die(defect),
          ),
        )
      const stored = yield* readRequest(threadId, member, requestId)
      if (!stored) return yield* Effect.fail(fail("unavailable", "Instruction was not committed"))
      if (stored.text !== text || stored.project_id !== thread.projectId)
        return yield* Effect.fail(fail("conflict", "requestId already has different instruction data"))
      return yield* pair(stored)
    })

  const reserveNext: Queue["reserveNext"] = ({ principal, threadId, executionOwner, leaseUntil }) =>
    Effect.gen(function* () {
      const caller = owner(principal)
      if (!caller || caller.workerId !== executionOwner.workerId || caller.instanceId !== executionOwner.instanceId)
        return yield* Effect.fail(fail("forbidden", "Runner credential does not match execution owner"))
      const lease = Date.parse(leaseUntil)
      if (!Number.isFinite(lease) || new Date(lease).toISOString() !== leaseUntil || lease <= now())
        return yield* Effect.fail(fail("invalid", "leaseUntil must be a future UTC time"))
      const thread = yield* authorizedThread(principal, threadId, "runner")
      if (thread.workerId !== executionOwner.workerId)
        return yield* Effect.fail(fail("forbidden", "Thread belongs to another worker"))

      const active = yield* readActive(threadId)
      if (active) {
        if (active.state === "reserved" && active.lease_until !== null && active.lease_until <= now()) {
          const timestamp = now()
          yield* input.events
            .append(
              {
                projectId: thread.projectId,
                threadId,
                kind: "run.recovery.required",
                occurredAt: new Date(timestamp).toISOString(),
                runId: active.id,
                instructionId: active.instruction_id,
                payload: { reason: "lease_expired", previousState: active.state },
              },
              () =>
                Effect.gen(function* () {
                  const stored = yield* readRun(active.id)
                  if (
                    !stored ||
                    stored.state !== active.state ||
                    stored.lease_until === null ||
                    stored.lease_until > now()
                  )
                    return yield* Effect.die(new Aborted("race"))
                  yield* db
                    .update(RunTable)
                    .set({ state: "recovery_required" })
                    .where(eq(RunTable.id, active.id))
                    .run()
                    .pipe(Effect.orDie)
                  return undefined
                }),
            )
            .pipe(Effect.catchDefect((defect) => (defect instanceof Aborted ? Effect.void : Effect.die(defect))))
        }
        return undefined
      }

      const next = yield* readNext(threadId)
      if (!next) return undefined
      const timestamp = now()
      const committed = yield* input.events
        .append(
          {
            projectId: thread.projectId,
            threadId,
            kind: "run.reserved",
            occurredAt: new Date(timestamp).toISOString(),
            runId: next.run.id,
            instructionId: next.instruction.id,
            payload: { queueSeq: next.instruction.queue_seq, executionOwner },
          },
          () =>
            Effect.gen(function* () {
              const currentThread = yield* authorizedThread(principal, threadId, "runner")
              if (currentThread.projectId !== thread.projectId || currentThread.workerId !== executionOwner.workerId)
                return yield* Effect.die(new Aborted("race"))
              if (yield* readActive(threadId)) return yield* Effect.die(new Aborted("race"))
              const first = yield* readNext(threadId)
              if (!first || first.run.id !== next.run.id) return yield* Effect.die(new Aborted("race"))
              yield* db
                .update(RunTable)
                .set({
                  state: "reserved",
                  attempt: first.run.attempt + 1,
                  execution_owner_worker_id: executionOwner.workerId,
                  execution_owner_instance_id: executionOwner.instanceId,
                  lease_until: lease,
                })
                .where(and(eq(RunTable.id, first.run.id), eq(RunTable.state, "queued")))
                .run()
                .pipe(Effect.orDie)
              return undefined
            }),
        )
        .pipe(Effect.catchDefect((defect) => (defect instanceof Aborted ? Effect.void : Effect.die(defect))))
      if (!committed) return undefined
      const stored = yield* readRun(next.run.id)
      if (!stored || stored.state !== "reserved" || !sameOwner(stored, executionOwner)) return undefined
      return { instruction: instruction(next.instruction), run: run(stored) }
    })

  const cancel: Queue["cancel"] = ({ principal, threadId, instructionId }) =>
    Effect.gen(function* () {
      const member = actorId(principal)
      if (!member) return yield* Effect.fail(fail("forbidden", "A member credential is required"))
      const thread = yield* authorizedThread(principal, threadId, "cancel")
      const submitted = yield* readInstruction(instructionId)
      if (!submitted || submitted.thread_id !== threadId || submitted.project_id !== thread.projectId)
        return yield* Effect.fail(fail("not_found", "Instruction not found in Thread"))
      const current = yield* readRun(submitted.run_id)
      if (!current) return yield* Effect.fail(fail("unavailable", "Instruction has no Run"))
      if (current.state === "cancelled" || current.state === "cancelling") return run(current)
      if (isTerminal(current.state)) return yield* Effect.fail(fail("conflict", "Run already ended"))
      if (current.state === "recovery_required")
        return yield* Effect.fail(fail("conflict", "Run requires reconciliation before cancellation is confirmed"))
      const queued = current.state === "queued"
      const timestamp = now()
      yield* input.events
        .append(
          {
            projectId: thread.projectId,
            threadId,
            kind: queued ? "instruction.cancelled" : "run.cancel.requested",
            occurredAt: new Date(timestamp).toISOString(),
            actorId: member,
            runId: current.id,
            instructionId,
            payload: { from: current.state, to: queued ? "cancelled" : "cancelling" },
          },
          () =>
            Effect.gen(function* () {
              const currentThread = yield* authorizedThread(principal, threadId, "cancel")
              if (currentThread.projectId !== thread.projectId) return yield* Effect.die(new Aborted("race"))
              const stored = yield* readRun(current.id)
              if (!stored || stored.state !== current.state) return yield* Effect.die(new Aborted("race"))
              yield* db
                .update(RunTable)
                .set({
                  state: queued ? "cancelled" : "cancelling",
                  lease_until: null,
                  ...(queued ? { ended_at: timestamp } : {}),
                })
                .where(eq(RunTable.id, current.id))
                .run()
                .pipe(Effect.orDie)
              return undefined
            }),
        )
        .pipe(Effect.catchDefect((defect) => (defect instanceof Aborted ? Effect.void : Effect.die(defect))))
      const stored = yield* readRun(current.id)
      if (!stored) return yield* Effect.fail(fail("unavailable", "Run was not committed"))
      return run(stored)
    })

  const transition: Queue["transition"] = ({ principal, runId, callbackId, callback, commitApproval }) =>
    Effect.gen(function* () {
      const caller = owner(principal)
      if (!caller) return yield* Effect.fail(fail("forbidden", "A runner credential is required"))
      if (!callbackId.trim() || callbackId.length > 256)
        return yield* Effect.fail(fail("invalid", "Invalid callbackId"))
      const current = yield* readRun(runId)
      if (!current) return yield* Effect.fail(fail("not_found", "Run not found"))
      if (!sameOwner(current, caller)) return yield* Effect.fail(fail("forbidden", "Runner does not own this Run"))
      const thread = yield* authorizedThread(principal, current.thread_id, "runner")
      if (thread.workerId !== caller.workerId)
        return yield* Effect.fail(fail("forbidden", "Thread belongs to another worker"))
      const prior = yield* db
        .select()
        .from(RunCallbackTable)
        .where(eq(RunCallbackTable.callback_id, callbackId))
        .get()
        .pipe(Effect.orDie)
      if (prior) {
        if (prior.run_id !== runId || !isDeepStrictEqual(prior.callback, callback))
          return yield* Effect.fail(fail("conflict", "callbackId was reused with different data"))
        return run(current)
      }
      if (callback.kind === "state") {
        // A start confirmation can arrive after an expired reservation became uncertain.
        // It confirms the same Run; it never opens the lane for another Run.
        const lateStart =
          current.state === "recovery_required" &&
          callback.expectedState === "reserved" &&
          callback.nextState === "running"
        if (
          (!lateStart && current.state !== callback.expectedState) ||
          !transitions[current.state].includes(callback.nextState)
        )
          return yield* Effect.fail(fail("conflict", "Invalid Run state transition"))
        if (callback.nextState === "waiting_approval" && !callback.approvalId)
          return yield* Effect.fail(fail("invalid", "approvalId is required for an approval wait"))
        if (callback.nextState === "waiting_approval") {
          if (!commitApproval) return yield* Effect.fail(fail("unavailable", "Approval projection is not configured"))
          if (!callback.toolCallId)
            return yield* Effect.fail(fail("invalid", "toolCallId is required for an approval wait"))
        }
      } else {
        if (current.state !== callback.state)
          return yield* Effect.fail(fail("conflict", "Activity does not match current Run state"))
        const values = Object.values(callback.activity)
        if (values.some((value) => typeof value === "string" && value.length > 8_000))
          return yield* Effect.fail(fail("invalid", "Runner activity text exceeds 8,000 characters"))
      }

      const timestamp = now()
      const kind = callback.kind === "activity" ? callback.activity.kind : eventKind(current.state, callback.nextState)
      yield* input.events
        .append(
          {
            projectId: thread.projectId,
            threadId: current.thread_id,
            kind,
            occurredAt: new Date(timestamp).toISOString(),
            runId,
            instructionId: current.instruction_id,
            payload:
              callback.kind === "activity"
                ? { ...callback.activity, callbackId }
                : {
                    from: current.state,
                    to: callback.nextState,
                    callbackId,
                    ...(callback.expectedState !== current.state ? { reportedFrom: callback.expectedState } : {}),
                    ...(callback.approvalId ? { approvalId: callback.approvalId } : {}),
                  },
          },
          (seq) =>
            Effect.gen(function* () {
              const currentThread = yield* authorizedThread(principal, current.thread_id, "runner")
              if (currentThread.projectId !== thread.projectId || currentThread.workerId !== caller.workerId)
                return yield* Effect.die(new Aborted("race"))
              const already = yield* db
                .select()
                .from(RunCallbackTable)
                .where(eq(RunCallbackTable.callback_id, callbackId))
                .get()
                .pipe(Effect.orDie)
              if (already) return yield* Effect.die(new Aborted("retry"))
              const stored = yield* readRun(runId)
              if (!stored || !sameOwner(stored, caller) || stored.state !== current.state)
                return yield* Effect.die(new Aborted("race"))
              yield* db
                .insert(RunCallbackTable)
                .values({ callback_id: callbackId, run_id: runId, callback, recorded_at: timestamp })
                .run()
                .pipe(Effect.orDie)
              if (callback.kind !== "state") return undefined
              if (callback.nextState === "waiting_approval") yield* commitApproval!(seq)
              yield* db
                .update(RunTable)
                .set({
                  state: callback.nextState,
                  ...(callback.nextState === "running" && stored.started_at === null ? { started_at: timestamp } : {}),
                  ...(callback.nextState === "running" || callback.nextState === "cancelling"
                    ? { lease_until: null }
                    : {}),
                  ...(isTerminal(callback.nextState) ? { ended_at: timestamp, lease_until: null } : {}),
                })
                .where(eq(RunTable.id, runId))
                .run()
                .pipe(Effect.orDie)
              return undefined
            }),
        )
        .pipe(Effect.catchDefect((defect) => (defect instanceof Aborted ? Effect.void : Effect.die(defect))))
      const stored = yield* readRun(runId)
      if (!stored) return yield* Effect.fail(fail("unavailable", "Run was not committed"))
      const recorded = yield* db
        .select()
        .from(RunCallbackTable)
        .where(eq(RunCallbackTable.callback_id, callbackId))
        .get()
        .pipe(Effect.orDie)
      if (!recorded || recorded.run_id !== runId || !isDeepStrictEqual(recorded.callback, callback))
        return yield* Effect.fail(fail("conflict", "callbackId was reused with different data"))
      return run(stored)
    })

  const pending: Queue["pending"] = (executionOwner) =>
    Effect.gen(function* () {
      const rows = yield* db
        .select({ instruction: InstructionTable, run: RunTable })
        .from(RunTable)
        .innerJoin(InstructionTable, eq(InstructionTable.id, RunTable.instruction_id))
        .where(
          and(
            eq(RunTable.execution_owner_worker_id, executionOwner.workerId),
            eq(RunTable.execution_owner_instance_id, executionOwner.instanceId),
            inArray(RunTable.state, occupied),
          ),
        )
        .orderBy(asc(InstructionTable.submitted_at))
        .all()
        .pipe(Effect.orDie)
      return yield* Effect.forEach(rows, (row) =>
        Effect.map(
          authorizedThread(
            {
              kind: "runner",
              workerId: executionOwner.workerId,
              instanceId: executionOwner.instanceId,
            },
            row.instruction.thread_id,
            "runner",
          ),
          (thread) => ({ thread, instruction: instruction(row.instruction), run: run(row.run) }),
        ),
      )
    })

  const getRun: Queue["getRun"] = (runId) => Effect.map(readRun(runId), (row) => (row ? run(row) : undefined))
  const instructions: Queue["instructions"] = (threadId) =>
    Effect.map(
      db
        .select()
        .from(InstructionTable)
        .where(eq(InstructionTable.thread_id, threadId))
        .orderBy(asc(InstructionTable.queue_seq))
        .all()
        .pipe(Effect.orDie),
      (rows) => rows.map(instruction),
    )
  const runs: Queue["runs"] = (threadId) =>
    Effect.map(
      db
        .select({ run: RunTable })
        .from(InstructionTable)
        .innerJoin(RunTable, eq(RunTable.instruction_id, InstructionTable.id))
        .where(eq(InstructionTable.thread_id, threadId))
        .orderBy(asc(InstructionTable.queue_seq))
        .all()
        .pipe(Effect.orDie),
      (rows) => rows.map((row) => run(row.run)),
    )
  return { instructions, runs, submit, cancel, reserveNext, transition, pending, getRun }
}

function eventKind(from: Coordination.RunState, to: Coordination.RunState): Coordination.EventKind {
  if (to === "running") return from === "waiting_approval" ? "run.approval.resolved" : "run.started"
  if (to === "waiting_approval") return "run.approval.requested"
  if (to === "cancelling") return "run.cancel.requested"
  if (to === "recovery_required") return "run.recovery.required"
  if (to === "completed") return "run.completed"
  if (to === "failed") return "run.failed"
  if (to === "cancelled") return "run.cancelled"
  throw new Error(`No event kind for ${from} -> ${to}`)
}
