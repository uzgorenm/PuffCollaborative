import { expect, test } from "bun:test"
import path from "node:path"
import { and, eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Coordination } from "@opencode-ai/schema/coordination"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Database } from "@opencode-ai/core/database/database"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import { EventV2 } from "@opencode-ai/core/event"
import { CoordinationEvents } from "@opencode-ai/core/coordination/events/events"
import type { CoordinationContracts } from "@opencode-ai/core/coordination/contracts"
import accessMigration from "@opencode-ai/core/database/migration/20260929190010_coordination_access"
import contextMigration from "@opencode-ai/core/database/migration/20260929210000_coordination_project_context"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { CoordinationAccess } from "../../../src/coordination/access"
import { ProjectContext } from "../../../src/coordination/overview/context"
import { MembershipTable, SharedProjectTable } from "../../../src/coordination/projects/sql"
import { tmpdir } from "../../fixture/tmpdir"

const projectId = Coordination.ProjectID.make("prj_context")
const alice = Coordination.UserID.make("usr_context_alice")
const ben = Coordination.UserID.make("usr_context_ben")
const outsider = Coordination.UserID.make("usr_context_outsider")
const owner = { kind: "member" as const, userId: alice }
const member = { kind: "member" as const, userId: ben }
const stranger = { kind: "member" as const, userId: outsider }
const content: ProjectContext.BriefContent = {
  goal: "Build a project navigation flow",
  successCriteria: ["Two selected experiments stay distinct"],
  roles: [
    { userId: alice, label: "Frontend" },
    { userId: ben, label: "Review" },
  ],
  tools: ["OpenCode", "Git"],
  sharingDefault: "private",
  suggestedAwarenessMode: "review-each-note",
}

async function withContext<A>(
  filename: string,
  seed: boolean,
  body: (
    service: ProjectContext.Interface,
    events: CoordinationContracts.Events,
    db: Database.Interface["db"],
  ) => Effect.Effect<A, unknown>,
) {
  const databaseLayer = Database.layerFromPath(filename)
  const eventLayer = EventV2.layerWith().pipe(Layer.provide(databaseLayer))
  const journalLayer = CoordinationEvents.layerWith().pipe(Layer.provide(Layer.merge(databaseLayer, eventLayer)))
  return Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      yield* DatabaseMigration.apply(db)
      yield* DatabaseMigration.applyOnly(db, [accessMigration, contextMigration])
      if (seed) {
        const now = Date.now()
        yield* db
          .insert(ProjectTable)
          .values({
            id: projectId,
            worktree: AbsolutePath.make(path.dirname(filename)),
            sandboxes: [],
            time_created: now,
            time_updated: now,
          })
          .run()
        yield* db
          .insert(SharedProjectTable)
          .values({
            id: projectId,
            name: "Navigation",
            created_by: alice,
            created_at: now,
            request_id: "project",
          })
          .run()
        yield* db
          .insert(MembershipTable)
          .values([
            { project_id: projectId, user_id: alice, role: "owner", joined_at: now },
            { project_id: projectId, user_id: ben, role: "member", joined_at: now },
          ])
          .run()
      }
      const events = yield* CoordinationEvents.Service
      const service = ProjectContext.make({
        db,
        access: CoordinationAccess.make(db),
        events,
      })
      return yield* body(service, events, db)
    }).pipe(Effect.provide(Layer.mergeAll(databaseLayer, eventLayer, journalLayer)), Effect.scoped),
  )
}

test("brief and self-authored focus survive restart with exact retries and stale-write rejection", async () => {
  await using tmp = await tmpdir()
  const filename = path.join(tmp.path, "context.sqlite")
  await withContext(filename, true, (service, events) =>
    Effect.gen(function* () {
      const first = yield* service.putBrief({
        principal: owner,
        projectId,
        requestId: "brief-1",
        expectedVersion: 0,
        content,
      })
      expect(first).toMatchObject({ projectId, version: 1, updatedBy: alice, ...content })
      expect(
        yield* service.putBrief({ principal: owner, projectId, requestId: "brief-1", expectedVersion: 0, content }),
      ).toEqual(first)
      expect((yield* events.replayProject(projectId, -1, 10)).events.map((event) => [event.kind, event.seq])).toEqual([
        ["project.brief.updated", 0],
      ])
      expect(
        (yield* service
          .putBrief({
            principal: owner,
            projectId,
            requestId: "brief-1",
            expectedVersion: 0,
            content: { ...content, goal: "Changed" },
          })
          .pipe(Effect.flip)).code,
      ).toBe("conflict")
      expect(
        (yield* service
          .putBrief({
            principal: owner,
            projectId,
            requestId: "stale",
            expectedVersion: 0,
            content: { ...content, goal: "Changed" },
          })
          .pipe(Effect.flip)).code,
      ).toBe("conflict")
      expect(
        (yield* service
          .putBrief({ principal: member, projectId, requestId: "member-write", expectedVersion: 1, content })
          .pipe(Effect.flip)).code,
      ).toBe("forbidden")
      expect((yield* service.readBrief(stranger, projectId).pipe(Effect.flip)).code).toBe("forbidden")
      expect(
        (yield* service
          .putBrief({
            principal: owner,
            projectId,
            requestId: "invalid-role",
            expectedVersion: 1,
            content: { ...content, roles: [{ userId: outsider, label: "Uninvited" }] },
          })
          .pipe(Effect.flip)).code,
      ).toBe("invalid")
      const second = yield* service.putBrief({
        principal: owner,
        projectId,
        requestId: "brief-2",
        expectedVersion: 1,
        content: { ...content, goal: "Ship navigation" },
      })
      expect(second).toMatchObject({ version: 2, goal: "Ship navigation" })
      expect(
        yield* service.putBrief({ principal: owner, projectId, requestId: "brief-1", expectedVersion: 0, content }),
      ).toEqual(first)
      expect((yield* events.replayProject(projectId, -1, 10)).events.map((event) => [event.kind, event.seq])).toEqual([
        ["project.brief.updated", 0],
        ["project.brief.updated", 1],
      ])

      const focus = yield* service.putFocus({
        principal: member,
        projectId,
        requestId: "focus-1",
        expectedVersion: 0,
        text: "Reviewing keyboard support",
      })
      expect(focus).toMatchObject({ userId: ben, version: 1, text: "Reviewing keyboard support" })
      expect(
        (yield* service
          .putFocus({ principal: member, projectId, requestId: "focus-1", expectedVersion: 0, text: "Different" })
          .pipe(Effect.flip)).code,
      ).toBe("conflict")
      expect(
        (yield* service
          .putFocus({ principal: member, projectId, requestId: "focus-stale", expectedVersion: 0, text: null })
          .pipe(Effect.flip)).code,
      ).toBe("conflict")
      expect((yield* service.listFocus(owner, projectId)).map((item) => [item.userId, item.text])).toEqual([
        [ben, "Reviewing keyboard support"],
      ])
      const cleared = yield* service.putFocus({
        principal: member,
        projectId,
        requestId: "focus-clear",
        expectedVersion: 1,
        text: null,
      })
      expect(cleared).toMatchObject({ userId: ben, version: 2, text: null })
      expect((yield* service.listFocus(stranger, projectId).pipe(Effect.flip)).code).toBe("forbidden")
      expect((yield* events.replayProject(projectId, -1, 10)).events.map((event) => event.kind)).toEqual([
        "project.brief.updated",
        "project.brief.updated",
        "person.focus.updated",
        "person.focus.updated",
      ])
    }),
  )
  await withContext(filename, false, (service, events, db) =>
    Effect.gen(function* () {
      expect((yield* service.readBrief(owner, projectId))?.goal).toBe("Ship navigation")
      expect(yield* service.listFocus(owner, projectId)).toMatchObject([{ userId: ben, version: 2, text: null }])
      expect((yield* events.replayProject(projectId, -1, 10)).events).toHaveLength(4)
      expect((yield* service.readBrief(stranger, projectId).pipe(Effect.flip)).code).toBe("forbidden")
      yield* db
        .delete(MembershipTable)
        .where(and(eq(MembershipTable.project_id, projectId), eq(MembershipTable.user_id, ben)))
        .run()
      expect(
        yield* service.putBrief({ principal: owner, projectId, requestId: "brief-1", expectedVersion: 0, content }),
      ).toMatchObject({ version: 1, goal: content.goal })
      expect(
        (yield* service
          .putBrief({ principal: owner, projectId, requestId: "brief-3", expectedVersion: 2, content })
          .pipe(Effect.flip)).code,
      ).toBe("invalid")
    }),
  )
})

test("a rejected brief projection leaves no revision or durable event", async () => {
  await using tmp = await tmpdir()
  await withContext(path.join(tmp.path, "rollback.sqlite"), true, (service, events, db) =>
    Effect.gen(function* () {
      yield* db.run(`CREATE TRIGGER context_fixture_abort BEFORE INSERT ON coordination_project_brief_revision
        BEGIN SELECT RAISE(ABORT, 'fixture write rejected'); END`)
      const failure = yield* service
        .putBrief({
          principal: owner,
          projectId,
          requestId: "brief-abort",
          expectedVersion: 0,
          content,
        })
        .pipe(Effect.flip)
      expect(failure.code).toBe("unavailable")
      expect(yield* service.readBrief(owner, projectId)).toBeUndefined()
      expect((yield* events.replayProject(projectId, -1, 10)).events).toEqual([])
    }),
  )
})
