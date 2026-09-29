export * as ReportDelivery from "./report-delivery"

import { Effect } from "effect"
import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm"
import { isDeepStrictEqual } from "node:util"
import type { Coordination } from "@opencode-ai/schema/coordination"
import type { CoordinationContracts } from "../coordination/contracts"
import type { Database } from "../database/database"
import type { RunnerHarnessContracts } from "./contracts"
import { OutboxTable } from "./report-delivery.sql"
import { ExecutionTable } from "./sql"

const maxDrafts = 64
const maxRead = 128
const baseRetryMs = 250
const maxRetryMs = 30_000
const terminal = new Set<Coordination.RunState>(["completed", "failed", "cancelled"])
type Row = typeof OutboxTable.$inferSelect

export interface Dependencies {
  readonly db: Database.Interface["db"]
  readonly callbacks: RunnerHarnessContracts.CoordinatorCallbacks
  readonly credentials: RunnerHarnessContracts.Credentials
  readonly redact: (text: string) => string
  readonly now?: () => number
  readonly baseRetryMs?: number
  readonly maxRetryMs?: number
}

/** The receiver must deduplicate callbackId and reject changed payloads for the same ID. */
export function make(input: Dependencies): RunnerHarnessContracts.ReportDelivery {
  const now = input.now ?? Date.now
  const retryBase = input.baseRetryMs ?? baseRetryMs
  const retryMax = input.maxRetryMs ?? maxRetryMs
  if (!Number.isSafeInteger(retryBase) || retryBase < 1 || !Number.isSafeInteger(retryMax) || retryMax < retryBase)
    throw new Error("Invalid runner callback retry bounds")
  const db = input.db

  const append: RunnerHarnessContracts.ReportDelivery["append"] = (tx, drafts) =>
    Effect.gen(function* () {
      if (drafts.length === 0) return []
      if (drafts.length > maxDrafts) return yield* Effect.fail(fail("invalid", "Too many callback drafts"))
      const runId = drafts[0]!.runId
      if (drafts.some((draft) => draft.runId !== runId))
        return yield* Effect.fail(fail("invalid", "Callback drafts must belong to one Run"))

      const execution = yield* tx
        .select()
        .from(ExecutionTable)
        .where(eq(ExecutionTable.run_id, runId))
        .get()
        .pipe(Effect.mapError(storageFailure))
      if (!execution) return yield* Effect.fail(fail("not_found", "Local execution does not exist"))
      const last = yield* tx
        .select()
        .from(OutboxTable)
        .where(eq(OutboxTable.run_id, runId))
        .orderBy(desc(OutboxTable.ordinal))
        .get()
        .pipe(Effect.mapError(storageFailure))
      let ordinal = last?.ordinal ?? 0
      let terminalSeen = last?.terminal === 1

      return yield* Effect.forEach(
        drafts,
        (draft) =>
          Effect.gen(function* () {
            if (!draft.producerKey.trim() || draft.producerKey.length > 256)
              return yield* Effect.fail(fail("invalid", "Invalid callback producer key"))
            if (
              draft.sourceSessionSeq !== undefined &&
              (!Number.isSafeInteger(draft.sourceSessionSeq) || draft.sourceSessionSeq < 0)
            )
              return yield* Effect.fail(fail("invalid", "Invalid source Session sequence"))
            const callback = shape(draft.callback, input.redact)
            const prior = yield* tx
              .select()
              .from(OutboxTable)
              .where(and(eq(OutboxTable.run_id, runId), eq(OutboxTable.producer_key, draft.producerKey)))
              .get()
              .pipe(Effect.mapError(storageFailure))
            if (prior) {
              if (
                !isDeepStrictEqual(prior.callback, callback) ||
                prior.source_session_seq !== (draft.sourceSessionSeq ?? null)
              )
                return yield* Effect.fail(fail("conflict", "Callback producer key has different data"))
              if (prior.terminal === 1) terminalSeen = true
              return intent(prior)
            }
            if (terminalSeen) return yield* Effect.fail(fail("conflict", "A terminal callback is already recorded"))
            const isTerminal = callback.kind === "state" && terminal.has(callback.nextState)
            ordinal += 1
            const recorded = {
              callback_id: `runner_cb_${crypto.randomUUID()}`,
              run_id: runId,
              producer_key: draft.producerKey,
              worker_id: execution.worker_id,
              instance_id: execution.instance_id,
              ordinal,
              callback,
              source_session_seq: draft.sourceSessionSeq ?? null,
              terminal: isTerminal ? 1 : 0,
              created_at: now(),
              next_attempt_at: now(),
            }
            yield* tx.insert(OutboxTable).values(recorded).run().pipe(Effect.mapError(storageFailure))
            if (isTerminal) terminalSeen = true
            return intent({
              ...recorded,
              acknowledged_at: null,
              attempt_count: 0,
              permanent_failure_at: null,
              last_error: null,
            })
          }),
        { concurrency: 1 },
      )
    })

  const flush: RunnerHarnessContracts.ReportDelivery["flush"] = (runId) =>
    Effect.gen(function* () {
      // Each call has a fixed work bound. R3/R10 can call drainDue again later.
      for (let sent = 0; sent < maxRead; sent++) {
        const head = yield* db
          .select()
          .from(OutboxTable)
          .where(and(eq(OutboxTable.run_id, runId), isNull(OutboxTable.acknowledged_at)))
          .orderBy(asc(OutboxTable.ordinal))
          .get()
          .pipe(Effect.mapError(storageFailure))
        if (!head || head.permanent_failure_at !== null || head.next_attempt_at > now()) return

        const owner = { workerId: head.worker_id, instanceId: head.instance_id }
        const principal = yield* input.credentials.principal(owner).pipe(
          Effect.match({
            onFailure: (error) => ({ ok: false as const, error }),
            onSuccess: (value) => ({ ok: true as const, value }),
          }),
        )
        if (!principal.ok) {
          yield* recordFailure(head, principal.error)
          if (permanent(principal.error)) return yield* Effect.fail(principal.error)
          return
        }
        if (
          principal.value.kind !== "runner" ||
          principal.value.workerId !== owner.workerId ||
          principal.value.instanceId !== owner.instanceId
        ) {
          const error = fail("forbidden", "Runner credential does not match outbound owner")
          yield* recordFailure(head, error)
          return yield* Effect.fail(error)
        }

        const response = yield* Effect.match(
          input.callbacks.report({
            principal: principal.value,
            runId: head.run_id,
            callbackId: head.callback_id,
            callback: head.callback,
          }),
          {
            onFailure: (error) => ({ ok: false as const, error }),
            onSuccess: (value) => ({ ok: true as const, value }),
          },
        )
        if (!response.ok) {
          yield* recordFailure(head, response.error)
          if (permanent(response.error)) return yield* Effect.fail(response.error)
          return
        }
        if (response.value.id !== head.run_id) {
          const error = fail("conflict", "Coordinator acknowledged a different Run")
          yield* recordFailure(head, error)
          return yield* Effect.fail(error)
        }
        yield* db
          .update(OutboxTable)
          .set({ acknowledged_at: now(), last_error: null })
          .where(and(eq(OutboxTable.callback_id, head.callback_id), isNull(OutboxTable.acknowledged_at)))
          .run()
          .pipe(Effect.mapError(storageFailure))
      }
    })

  const recordFailure = (row: Row, error: RunnerHarnessContracts.Failure) =>
    db
      .update(OutboxTable)
      .set({
        attempt_count: row.attempt_count + 1,
        next_attempt_at: now() + Math.min(retryMax, retryBase * 2 ** Math.min(row.attempt_count, 30)),
        permanent_failure_at: permanent(error) ? now() : null,
        last_error: error.code,
      })
      .where(and(eq(OutboxTable.callback_id, row.callback_id), isNull(OutboxTable.acknowledged_at)))
      .run()
      .pipe(Effect.mapError(storageFailure))

  const pending: RunnerHarnessContracts.ReportDelivery["pending"] = (runId) =>
    db
      .select()
      .from(OutboxTable)
      .where(and(eq(OutboxTable.run_id, runId), isNull(OutboxTable.acknowledged_at)))
      .orderBy(asc(OutboxTable.ordinal))
      .limit(maxRead)
      .all()
      .pipe(
        Effect.map((rows) => rows.map(intent)),
        Effect.mapError(storageFailure),
      )

  const drainDue: RunnerHarnessContracts.ReportDelivery["drainDue"] = (limit) =>
    Effect.gen(function* () {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxRead)
        return yield* Effect.fail(fail("invalid", "Invalid outbox drain limit"))
      const heads = yield* db
        .all<{ run_id: Coordination.RunID }>(
          sql`
        SELECT next.run_id
        FROM runner_harness_outbox AS next
        WHERE next.acknowledged_at IS NULL
          AND next.permanent_failure_at IS NULL
          AND next.next_attempt_at <= ${now()}
          AND NOT EXISTS (
            SELECT 1 FROM runner_harness_outbox AS earlier
            WHERE earlier.run_id = next.run_id
              AND earlier.ordinal < next.ordinal
              AND earlier.acknowledged_at IS NULL
          )
        ORDER BY next.created_at, next.callback_id
        LIMIT ${limit}
      `,
        )
        .pipe(Effect.mapError(storageFailure))
      yield* Effect.forEach(heads, (head) => flush(head.run_id), { concurrency: 1 })
      return heads.length
    })

  const diagnostics: RunnerHarnessContracts.ReportDelivery["diagnostics"] = db
    .select({ count: sql<number>`count(*)` })
    .from(OutboxTable)
    .where(and(isNull(OutboxTable.acknowledged_at), isNull(OutboxTable.permanent_failure_at)))
    .get()
    .pipe(
      Effect.zipWith(
        db
          .select({ count: sql<number>`count(*)` })
          .from(OutboxTable)
          .where(and(isNull(OutboxTable.acknowledged_at), isNotNull(OutboxTable.permanent_failure_at)))
          .get(),
        (pending, failed) => ({ pending: pending?.count ?? 0, failed: failed?.count ?? 0 }),
      ),
      Effect.mapError(storageFailure),
    )

  return { append, flush, pending, drainDue, diagnostics }
}

function intent(row: Row): RunnerHarnessContracts.CallbackIntent {
  return {
    runId: row.run_id,
    producerKey: row.producer_key,
    callbackId: row.callback_id,
    ordinal: row.ordinal,
    callback: row.callback,
    ...(row.source_session_seq === null ? {} : { sourceSessionSeq: row.source_session_seq }),
    ...(row.acknowledged_at === null ? {} : { acknowledgedAt: row.acknowledged_at }),
  }
}

function shape(callback: CoordinationContracts.RunnerCallback, redact: (text: string) => string) {
  if (callback.kind === "state") return callback
  const activity = callback.activity
  const trimmed = (value: string) => redact(value.slice(0, 16_000)).slice(0, 8_000)
  if (activity.kind === "run.output")
    return { ...callback, activity: { kind: activity.kind, text: trimmed(activity.text) } } as const
  if (activity.kind === "run.tool")
    return {
      ...callback,
      activity: {
        kind: activity.kind,
        toolName: trimmed(activity.toolName),
        status: activity.status,
        ...(activity.summary === undefined ? {} : { summary: trimmed(activity.summary) }),
      },
    } as const
  if (activity.kind === "run.workspace")
    return {
      ...callback,
      activity: { kind: activity.kind, workspaceId: trimmed(activity.workspaceId), ref: trimmed(activity.ref) },
    } as const
  return {
    ...callback,
    activity: {
      kind: activity.kind,
      ref: trimmed(activity.ref),
      ...(activity.summary === undefined ? {} : { summary: trimmed(activity.summary) }),
    },
  } as const
}

function permanent(error: RunnerHarnessContracts.Failure) {
  return error.code !== "unavailable"
}

function fail(code: CoordinationContracts.ErrorCode, message: string): RunnerHarnessContracts.Failure {
  return { code, message }
}

function storageFailure(error: unknown): RunnerHarnessContracts.Failure {
  const cause = error instanceof Error ? error.cause : undefined
  const nested = cause instanceof Error ? cause.cause : undefined
  const text = [error, cause, nested].map(String).join(" ")
  return fail(
    "unavailable",
    /SQLITE_FULL|database or disk is full/i.test(text)
      ? "Runner outbox storage exhausted"
      : "Runner outbox storage unavailable",
  )
}
