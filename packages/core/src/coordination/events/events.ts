export * as CoordinationEvents from "./events"

import { Cause, Context, Effect, Layer, Queue, Schema, Stream } from "effect"
import { and, asc, eq, gt, sql } from "drizzle-orm"
import { CoordinationEvent } from "@opencode-ai/schema/coordination-event"
import type { Coordination } from "@opencode-ai/schema/coordination"
import { Database } from "../../database/database"
import { EventV2 } from "../../event"
import { EventTable } from "../../event/sql"
import { makeGlobalNode } from "../../effect/app-node"
import { CoordinationContracts } from "../contracts"
import { ThreadTable } from "../threads/sql"

const maxPageSize = 256
const defaultSubscriberCapacity = 256
const contentRevisionKinds = new Set<Coordination.EventKind>([
  "instruction.submitted",
  "comment.created",
  "run.tool",
  "run.output",
  "run.workspace",
  "run.diff",
])
const storedType = EventV2.versionedType(CoordinationEvent.Changed.type, 1)
const decodeData = Schema.decodeUnknownSync(CoordinationEvent.Changed.data)

export interface LayerOptions {
  readonly subscriberCapacity?: number
  readonly resolveThreadProject?: (
    threadId: Coordination.ThreadID,
  ) => Effect.Effect<Coordination.ProjectID, CoordinationContracts.Failure>
}

export class Service extends Context.Service<Service, CoordinationContracts.Events>()("@opencode/CoordinationEvents") {}

export const authorizedReplayProject = (
  access: CoordinationContracts.Access,
  journal: CoordinationContracts.Events,
  auth: Coordination.AuthContext,
  projectId: Coordination.ProjectID,
  after: number,
  limit: number,
) =>
  access
    .authorize(auth, projectId, undefined, "read")
    .pipe(Effect.andThen(journal.replayProject(projectId, after, limit)))

export const authorizedReplayThread = (
  access: CoordinationContracts.Access,
  journal: CoordinationContracts.Events,
  auth: Coordination.AuthContext,
  threadId: Coordination.ThreadID,
  after: number,
  limit: number,
) => access.getThread(auth, threadId, "read").pipe(Effect.andThen(journal.replayThread(threadId, after, limit)))

export const authorizedSubscribeProject = (
  access: CoordinationContracts.Access,
  journal: CoordinationContracts.Events,
  auth: Coordination.AuthContext,
  projectId: Coordination.ProjectID,
  after: number,
) =>
  Effect.gen(function* () {
    yield* access.authorize(auth, projectId, undefined, "read")
    yield* journal.replayProject(projectId, after, 1)
    return journal
      .subscribeProject(projectId, after)
      .pipe(Stream.mapEffect((event) => access.authorize(auth, projectId, undefined, "read").pipe(Effect.as(event))))
  })

export const authorizedSubscribeThread = (
  access: CoordinationContracts.Access,
  journal: CoordinationContracts.Events,
  auth: Coordination.AuthContext,
  threadId: Coordination.ThreadID,
  after: number,
) =>
  Effect.gen(function* () {
    yield* access.getThread(auth, threadId, "read")
    yield* journal.replayThread(threadId, after, 1)
    return journal
      .subscribeThread(threadId, after)
      .pipe(Stream.mapEffect((event) => access.getThread(auth, threadId, "read").pipe(Effect.as(event))))
  })

export const layerWith = (options?: LayerOptions) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const subscriberCapacity = options?.subscriberCapacity ?? defaultSubscriberCapacity

      const aggregateID = (projectId: Coordination.ProjectID) => `coordination:project:${projectId}`
      const failure = (code: CoordinationContracts.ErrorCode, message: string): CoordinationContracts.Failure => ({
        code,
        message,
      })
      const resolveThreadProject =
        options?.resolveThreadProject ??
        ((threadId: Coordination.ThreadID) =>
          db
            .select({ projectId: ThreadTable.project_id })
            .from(ThreadTable)
            .where(eq(ThreadTable.id, threadId))
            .get()
            .pipe(
              Effect.orDie,
              Effect.flatMap((row) =>
                row ? Effect.succeed(row.projectId) : Effect.fail(failure("not_found", "Thread not found")),
              ),
            ))

      const latestSequence = (projectId: Coordination.ProjectID) => EventV2.latestSequence(db, aggregateID(projectId))

      const validate = (after: number, limit: number, latest: number) => {
        if (!Number.isSafeInteger(after) || after < -1 || after > latest)
          return failure("invalid", `Invalid event cursor ${after}`)
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxPageSize)
          return failure("invalid", `Event page limit must be between 1 and ${maxPageSize}`)
        return undefined
      }

      const read = (
        projectId: Coordination.ProjectID,
        threadId: Coordination.ThreadID | undefined,
        after: number,
        limit: number,
      ) =>
        Effect.gen(function* () {
          const latest = yield* latestSequence(projectId)
          const invalid = validate(after, limit, latest)
          if (invalid) return yield* Effect.fail(invalid)

          const rows = yield* db
            .select({ id: EventTable.id, seq: EventTable.seq, data: EventTable.data })
            .from(EventTable)
            .where(
              and(
                eq(EventTable.aggregate_id, aggregateID(projectId)),
                eq(EventTable.type, storedType),
                gt(EventTable.seq, after),
                threadId ? eq(sql<string>`json_extract(${EventTable.data}, '$.threadId')`, threadId) : undefined,
              ),
            )
            .orderBy(asc(EventTable.seq))
            .limit(limit + 1)
            .all()
            .pipe(Effect.orDie)
          const page = rows.slice(0, limit)
          return {
            events: page.map((row) => {
              const data = decodeData(row.data)
              return {
                id: row.id,
                projectId: data.projectId,
                threadId: data.threadId,
                seq: row.seq,
                kind: data.kind,
                occurredAt: data.occurredAt,
                ...(data.actorId ? { actorId: data.actorId } : {}),
                ...(data.runId ? { runId: data.runId } : {}),
                ...(data.instructionId ? { instructionId: data.instructionId } : {}),
                payload: data.payload,
              }
            }),
            cursor: page.at(-1)?.seq ?? after,
            hasMore: rows.length > limit,
          } satisfies CoordinationContracts.ReplayPage
        })

      const subscribe = (
        projectId: Coordination.ProjectID,
        threadId: Coordination.ThreadID | undefined,
        after: number,
      ) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const latest = yield* latestSequence(projectId)
            const invalid = validate(after, maxPageSize, latest)
            if (invalid) return yield* Effect.fail(invalid)

            // Notifications only wake this reader. SQLite remains the source of every delivered event.
            const wake = yield* Queue.dropping<void, CoordinationContracts.Failure>(subscriberCapacity)
            const output = yield* Queue.bounded<Coordination.Event, CoordinationContracts.Failure>(subscriberCapacity)
            let overflowed = false
            const unsubscribe = yield* events.listen((event) => {
              if (overflowed) return Effect.void
              if (event.type !== CoordinationEvent.Changed.type) return Effect.void
              const data = event.data as { readonly aggregateID: string; readonly threadId: Coordination.ThreadID }
              if (data.aggregateID !== aggregateID(projectId)) return Effect.void
              if (threadId && data.threadId !== threadId) return Effect.void
              return Queue.offer(wake, undefined).pipe(
                Effect.flatMap((accepted) =>
                  accepted
                    ? Effect.void
                    : Effect.sync(() => {
                        overflowed = true
                      }).pipe(
                        Effect.andThen(
                          Queue.fail(
                            output,
                            failure(
                              "unavailable",
                              "Event subscriber fell behind; reconnect using the last delivered cursor",
                            ),
                          ),
                        ),
                        Effect.asVoid,
                      ),
                ),
              )
            })
            yield* Effect.addFinalizer(() =>
              unsubscribe.pipe(
                Effect.andThen(Queue.shutdown(wake)),
                Effect.andThen(Queue.shutdown(output)),
                Effect.asVoid,
              ),
            )

            yield* Effect.gen(function* () {
              let cursor = after
              while (true) {
                const page = yield* read(projectId, threadId, cursor, maxPageSize)
                cursor = page.cursor
                for (const event of page.events) yield* Queue.offer(output, event)
                if (page.hasMore) continue
                yield* Queue.take(wake)
              }
            }).pipe(
              Effect.catch((error) => Queue.fail(output, error)),
              Effect.forkScoped,
            )

            return Stream.fromQueue(output)
          }),
        )

      const service: CoordinationContracts.Events = {
        append: (input, project) =>
          Effect.gen(function* () {
            if (input.id && !input.id.startsWith("evt_"))
              return yield* Effect.fail(failure("invalid", "Event ID must start with evt_"))
            const event = yield* events
              .publish(
                CoordinationEvent.Changed,
                { ...input, aggregateID: aggregateID(input.projectId) },
                {
                  ...(input.id ? { id: input.id as EventV2.ID } : {}),
                  commit: (seq) =>
                    Effect.gen(function* () {
                      yield* project(seq)
                      if (!input.threadId) return
                      if (contentRevisionKinds.has(input.kind)) {
                        const thread = yield* db
                          .update(ThreadTable)
                          .set({ activity_seq: seq })
                          .where(and(eq(ThreadTable.id, input.threadId), eq(ThreadTable.project_id, input.projectId)))
                          .returning({ id: ThreadTable.id })
                          .get()
                          .pipe(Effect.orDie)
                        if (thread) return
                      }
                      const otherProject = yield* db
                        .select({ projectId: ThreadTable.project_id })
                        .from(ThreadTable)
                        .where(eq(ThreadTable.id, input.threadId))
                        .get()
                        .pipe(Effect.orDie)
                      if (otherProject && otherProject.projectId !== input.projectId)
                        return yield* Effect.fail(failure("not_found", "Thread not found in project"))
                    }).pipe(Effect.catch((error) => Effect.die(new CoordinationContracts.ProjectionFailure(error)))),
                },
              )
              .pipe(
                Effect.catchCause((cause) => {
                  const defect = Cause.squash(cause)
                  return defect instanceof CoordinationContracts.ProjectionFailure
                    ? Effect.fail(defect.failure)
                    : Effect.failCause(cause)
                }),
              )
            return {
              id: event.id,
              projectId: input.projectId,
              threadId: input.threadId,
              seq: event.durable!.seq,
              kind: input.kind,
              occurredAt: input.occurredAt,
              ...(input.actorId ? { actorId: input.actorId } : {}),
              ...(input.runId ? { runId: input.runId } : {}),
              ...(input.instructionId ? { instructionId: input.instructionId } : {}),
              payload: input.payload,
            }
          }),
        latestSequence,
        replayProject: (projectId, after, limit) => read(projectId, undefined, after, limit),
        replayThread: (threadId, after, limit) =>
          Effect.flatMap(resolveThreadProject(threadId), (projectId) => read(projectId, threadId, after, limit)),
        subscribeProject: (projectId, after) => subscribe(projectId, undefined, after),
        subscribeThread: (threadId, after) =>
          Stream.unwrap(
            Effect.map(resolveThreadProject(threadId), (projectId) => subscribe(projectId, threadId, after)),
          ),
      }
      return Service.of(service)
    }),
  )

export const layer = layerWith()
export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node, EventV2.node] })
