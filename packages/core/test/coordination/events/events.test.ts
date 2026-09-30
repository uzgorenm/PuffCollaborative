import { describe, expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Stream } from "effect"
import { Coordination } from "@opencode-ai/schema/coordination"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CoordinationEvents } from "@opencode-ai/core/coordination/events/events"
import { SharedProjectTable } from "@opencode-ai/core/coordination/projects/sql"
import { ThreadTable } from "@opencode-ai/core/coordination/threads/sql"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionTable } from "@opencode-ai/core/session/sql"
import type { CoordinationContracts } from "@opencode-ai/core/coordination/contracts"
import { eq } from "drizzle-orm"
import { testEffect } from "../../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, CoordinationEvents.node]), [
    [CoordinationEvents.node, CoordinationEvents.layerWith({ subscriberCapacity: 4 })],
  ]),
)

const addThread = (projectId: Coordination.ProjectID, createdBy: Coordination.UserID) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const now = Date.now()
    const threadId = Coordination.ThreadID.make(`thr_${crypto.randomUUID()}`)
    const sessionId = Coordination.Thread.fields.sessionId.make(`ses_${crypto.randomUUID()}`)
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionId,
        project_id: projectId,
        slug: threadId,
        directory: "/tmp/coordination-events-test",
        title: "Event test thread",
        version: "test",
        time_created: now,
        time_updated: now,
      })
      .run()
    yield* db
      .insert(ThreadTable)
      .values({
        id: threadId,
        project_id: projectId,
        session_id: sessionId,
        worker_id: Coordination.WorkerID.make(`wrk_${crypto.randomUUID()}`),
        title: "Event test thread",
        created_by: createdBy,
        created_at: now,
        activity_seq: -1,
        request_id: threadId,
      })
      .run()
    return threadId
  })

const ids = () =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const projectId = Coordination.ProjectID.make(`prj_${crypto.randomUUID()}`)
    const createdBy = Coordination.UserID.make(`usr_${crypto.randomUUID()}`)
    const now = Date.now()
    yield* db
      .insert(ProjectTable)
      .values({
        id: projectId,
        worktree: AbsolutePath.make("/tmp/coordination-events-test"),
        sandboxes: [],
        time_created: now,
        time_updated: now,
      })
      .run()
    yield* db
      .insert(SharedProjectTable)
      .values({
        id: projectId,
        name: "Event test project",
        created_by: createdBy,
        created_at: now,
        request_id: projectId,
      })
      .run()
    const threadId = yield* addThread(projectId, createdBy)
    return { projectId, threadId, createdBy }
  })

const append = (
  journal: CoordinationContracts.Events,
  projectId: Coordination.ProjectID,
  threadId: Coordination.ThreadID,
  label: string,
  project: (seq: number) => Effect.Effect<void, CoordinationContracts.Failure> = () => Effect.void,
  id?: string,
) =>
  journal.append(
    {
      ...(id ? { id } : {}),
      projectId,
      threadId,
      kind: "run.tool",
      occurredAt: new Date().toISOString(),
      payload: { label },
    },
    project,
  )

describe("coordination event journal", () => {
  it.effect("advances the content revision for owner instructions while retaining the project cursor for run status", () =>
    Effect.gen(function* () {
      const journal = yield* CoordinationEvents.Service
      const { db } = yield* Database.Service
      const { projectId, threadId, createdBy } = yield* ids()
      const otherThread = yield* addThread(projectId, createdBy)
      yield* append(journal, projectId, otherThread, "other thread output")

      const instruction = yield* journal.append(
        {
          projectId,
          threadId,
          actorId: createdBy,
          kind: "instruction.submitted",
          occurredAt: new Date().toISOString(),
          payload: { text: "Use the existing shared parser", requestId: "first-instruction" },
        },
        () => Effect.void,
      )
      expect(instruction.seq).toBe(1)
      expect(
        (yield* db
          .select({ seq: ThreadTable.activity_seq })
          .from(ThreadTable)
          .where(eq(ThreadTable.id, threadId))
          .get())?.seq,
      ).toBe(1)

      for (const kind of ["run.reserved", "run.started"] as const)
        yield* journal.append(
          { projectId, threadId, kind, occurredAt: new Date().toISOString(), payload: {} },
          () => Effect.void,
        )
      expect(yield* journal.latestSequence(projectId)).toBe(3)
      expect(
        (yield* db
          .select({ seq: ThreadTable.activity_seq })
          .from(ThreadTable)
          .where(eq(ThreadTable.id, threadId))
          .get())?.seq,
      ).toBe(1)

      const correction = yield* journal.append(
        {
          projectId,
          threadId,
          actorId: createdBy,
          kind: "instruction.submitted",
          occurredAt: new Date().toISOString(),
          payload: { text: "The shared parser now handles this case", requestId: "corrected-instruction" },
        },
        () => Effect.void,
      )
      expect(correction.seq).toBe(4)
      expect(
        (yield* db
          .select({ seq: ThreadTable.activity_seq })
          .from(ThreadTable)
          .where(eq(ThreadTable.id, threadId))
          .get())?.seq,
      ).toBe(4)
      expect((yield* journal.replayThread(threadId, -1, 10)).events.map((event) => event.seq)).toEqual([1, 2, 3, 4])
      expect((yield* journal.replayProject(projectId, -1, 10)).events.map((event) => event.seq)).toEqual([0, 1, 2, 3, 4])
    }),
  )

  it.effect("delivers the same ordered durable events to two clients", () =>
    Effect.gen(function* () {
      const journal = yield* CoordinationEvents.Service
      const { projectId, threadId } = yield* ids()
      const first = yield* journal
        .subscribeProject(projectId, -1)
        .pipe(Stream.take(3), Stream.runCollect, Effect.forkScoped)
      const second = yield* journal
        .subscribeProject(projectId, -1)
        .pipe(Stream.take(3), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow

      const committed = []
      for (const label of ["one", "two", "three"]) committed.push(yield* append(journal, projectId, threadId, label))

      expect(Array.from(yield* Fiber.join(first))).toEqual(committed)
      expect(Array.from(yield* Fiber.join(second))).toEqual(committed)
      expect(committed.map((event) => event.seq)).toEqual([0, 1, 2])
      expect(new Set(committed.map((event) => event.id)).size).toBe(3)
    }),
  )

  it.effect("replays missed events by the exclusive durable cursor", () =>
    Effect.gen(function* () {
      const journal = yield* CoordinationEvents.Service
      const { projectId, threadId } = yield* ids()
      const first = yield* append(journal, projectId, threadId, "seen")
      const missed = yield* append(journal, projectId, threadId, "missed")

      const page = yield* journal.replayProject(projectId, first.seq, 1)
      expect(page).toMatchObject({ events: [missed], cursor: missed.seq, hasMore: false })
      const resumed = yield* journal.subscribeProject(projectId, first.seq).pipe(Stream.take(1), Stream.runCollect)
      expect(Array.from(resumed)).toEqual([missed])
    }),
  )

  it.live("uses commit order when event IDs were allocated in the opposite order", () =>
    Effect.gen(function* () {
      const journal = yield* CoordinationEvents.Service
      const { projectId, threadId } = yield* ids()
      const olderID = EventV2.ID.create()
      const newerID = EventV2.ID.create()
      const firstEntered = yield* Deferred.make<void>()
      const finishFirst = yield* Deferred.make<void>()

      const first = yield* append(
        journal,
        projectId,
        threadId,
        "newer id",
        () => Deferred.succeed(firstEntered, undefined).pipe(Effect.andThen(Deferred.await(finishFirst))),
        newerID,
      ).pipe(Effect.forkScoped)
      yield* Deferred.await(firstEntered)
      const second = yield* append(journal, projectId, threadId, "older id", undefined, olderID).pipe(Effect.forkScoped)
      yield* Effect.yieldNow
      yield* Deferred.succeed(finishFirst, undefined)
      yield* Fiber.join(first)
      yield* Fiber.join(second)

      const page = yield* journal.replayProject(projectId, -1, 2)
      expect(page.events.map((event) => [event.seq, event.id])).toEqual([
        [0, newerID],
        [1, olderID],
      ])
      expect((yield* journal.replayProject(projectId, 0, 2)).events.map((event) => event.id)).toEqual([olderID])
    }),
  )

  it.effect("rolls back state and the event together when projection fails", () =>
    Effect.gen(function* () {
      const journal = yield* CoordinationEvents.Service
      const { db } = yield* Database.Service
      const { projectId, threadId } = yield* ids()
      const marker = EventV2.ID.create()
      yield* db.run("CREATE TABLE IF NOT EXISTS coordination_event_probe (marker text PRIMARY KEY)")

      const exit = yield* append(
        journal,
        projectId,
        threadId,
        "rolled back",
        () =>
          db
            .run(`INSERT INTO coordination_event_probe (marker) VALUES ('${marker}')`)
            .pipe(Effect.orDie, Effect.andThen(Effect.die("projection failed"))),
        marker,
      ).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(yield* db.all(`SELECT marker FROM coordination_event_probe WHERE marker = '${marker}'`)).toEqual([])
      expect(yield* db.select().from(EventTable).where(eq(EventTable.id, marker)).all()).toEqual([])
      expect(
        (yield* db
          .select({ seq: ThreadTable.activity_seq })
          .from(ThreadTable)
          .where(eq(ThreadTable.id, threadId))
          .get())?.seq,
      ).toBe(-1)
    }),
  )

  it.effect("returns a typed projection conflict after rolling back both writes", () =>
    Effect.gen(function* () {
      const journal = yield* CoordinationEvents.Service
      const { db } = yield* Database.Service
      const { projectId, threadId } = yield* ids()
      const marker = EventV2.ID.create()
      const conflict = { code: "conflict" as const, message: "Approval version changed" }
      yield* db.run("CREATE TABLE IF NOT EXISTS coordination_event_probe (marker text PRIMARY KEY)")

      const failure = yield* append(
        journal,
        projectId,
        threadId,
        "conflicted approval",
        () =>
          db
            .run(`INSERT INTO coordination_event_probe (marker) VALUES ('${marker}')`)
            .pipe(Effect.orDie, Effect.andThen(Effect.fail(conflict))),
        marker,
      ).pipe(Effect.flip)

      expect(failure).toEqual(conflict)
      expect(yield* db.all(`SELECT marker FROM coordination_event_probe WHERE marker = '${marker}'`)).toEqual([])
      expect(yield* db.select().from(EventTable).where(eq(EventTable.id, marker)).all()).toEqual([])
      expect(
        (yield* db
          .select({ seq: ThreadTable.activity_seq })
          .from(ThreadTable)
          .where(eq(ThreadTable.id, threadId))
          .get())?.seq,
      ).toBe(-1)
    }),
  )

  it.effect("catches a commit between the snapshot cursor and subscription", () =>
    Effect.gen(function* () {
      const journal = yield* CoordinationEvents.Service
      const { db } = yield* Database.Service
      const { projectId, threadId } = yield* ids()
      yield* append(journal, projectId, threadId, "snapshot state")
      const cursor = yield* db.transaction(() => journal.latestSequence(projectId))
      const afterSnapshot = yield* append(journal, projectId, threadId, "during handoff")

      const observed = yield* journal.subscribeProject(projectId, cursor).pipe(Stream.take(1), Stream.runCollect)
      expect(Array.from(observed)).toEqual([afterSnapshot])
    }),
  )

  it.effect("filters thread replay while retaining the project cursor", () =>
    Effect.gen(function* () {
      const journal = yield* CoordinationEvents.Service
      const { projectId, threadId, createdBy } = yield* ids()
      const otherThread = yield* addThread(projectId, createdBy)
      yield* append(journal, projectId, otherThread, "other")
      const expected = yield* append(journal, projectId, threadId, "selected")

      const page = yield* journal.replayThread(threadId, -1, 10)
      expect(page.events).toEqual([expected])
      expect(page.cursor).toBe(expected.seq)
      expect(page.hasMore).toBe(false)

      const live = yield* journal
        .subscribeThread(threadId, page.cursor)
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      yield* append(journal, projectId, otherThread, "not selected")
      const selected = yield* append(journal, projectId, threadId, "next selected")
      expect(Array.from(yield* Fiber.join(live))).toEqual([selected])
    }),
  )

  it.effect("rejects invalid cursors and a missing thread", () =>
    Effect.gen(function* () {
      const journal = yield* CoordinationEvents.Service
      const { projectId } = yield* ids()
      const invalid = yield* journal.replayProject(projectId, 1, 10).pipe(Effect.flip)
      expect(invalid.code).toBe("invalid")
      expect((yield* journal.replayProject(projectId, -2, 10).pipe(Effect.flip)).code).toBe("invalid")
      expect((yield* journal.replayProject(projectId, -1, 0).pipe(Effect.flip)).code).toBe("invalid")
      const denied = Coordination.ThreadID.make(`thr_${crypto.randomUUID()}`)
      const access = yield* journal.replayThread(denied, -1, 10).pipe(Effect.flip)
      expect(access.code).toBe("not_found")
      const other = yield* ids()
      const mismatch = yield* append(journal, projectId, other.threadId, "wrong project").pipe(Effect.flip)
      expect(mismatch.code).toBe("not_found")
      expect(yield* journal.latestSequence(projectId)).toBe(-1)

      const auth = { kind: "member" as const, userId: Coordination.UserID.make(`usr_${crypto.randomUUID()}`) }
      const deniedAccess: CoordinationContracts.Access = {
        authorize: () => Effect.fail({ code: "forbidden", message: "Not a member" }),
        getThread: () => Effect.fail({ code: "forbidden", message: "Not a member" }),
      }
      const streamDenied = yield* CoordinationEvents.authorizedSubscribeProject(
        deniedAccess,
        journal,
        auth,
        projectId,
        -1,
      ).pipe(Effect.flip)
      expect(streamDenied.code).toBe("forbidden")
      const threadStreamDenied = yield* CoordinationEvents.authorizedSubscribeThread(
        deniedAccess,
        journal,
        auth,
        denied,
        -1,
      ).pipe(Effect.flip)
      expect(threadStreamDenied.code).toBe("forbidden")

      const allowedAccess: CoordinationContracts.Access = { ...deniedAccess, authorize: () => Effect.void }
      const streamInvalid = yield* CoordinationEvents.authorizedSubscribeProject(
        allowedAccess,
        journal,
        auth,
        projectId,
        1,
      ).pipe(Effect.flip)
      expect(streamInvalid.code).toBe("invalid")
    }),
  )

  it.live("disconnects a slow client without blocking event commits", () =>
    Effect.gen(function* () {
      const journal = yield* CoordinationEvents.Service
      const { projectId, threadId } = yield* ids()
      const firstSeen = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      yield* append(journal, projectId, threadId, "seed")
      const slow = yield* journal.subscribeProject(projectId, -1).pipe(
        Stream.runForEach(() => Deferred.succeed(firstSeen, undefined).pipe(Effect.andThen(Deferred.await(release)))),
        Effect.exit,
        Effect.forkScoped,
      )
      yield* Deferred.await(firstSeen)

      for (let index = 0; index < 12; index++) yield* append(journal, projectId, threadId, `live ${index}`)
      yield* Deferred.succeed(release, undefined)

      expect(Exit.isFailure(yield* Fiber.join(slow))).toBe(true)
      expect((yield* journal.replayProject(projectId, -1, 20)).events).toHaveLength(13)
    }),
  )
})
