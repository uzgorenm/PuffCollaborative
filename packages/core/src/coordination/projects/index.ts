export * as CoordinationProjects from "./index"

import { and, asc, eq } from "drizzle-orm"
import { randomUUID } from "node:crypto"
import { Effect } from "effect"
import { Coordination } from "@opencode-ai/schema/coordination"
import type { Database } from "../../database/database"
import { ProjectTable } from "../../project/sql"
import { SessionTable } from "../../session/sql"
import type { CoordinationContracts } from "../contracts"
import { CommentTable } from "../comments/sql"
import { ThreadTable } from "../threads/sql"
import { threadFromRow } from "../threads/row"
import { MembershipTable, SharedProjectTable } from "./sql"

const forbidden: CoordinationContracts.Failure = { code: "forbidden", message: "Access denied" }
const conflict: CoordinationContracts.Failure = {
  code: "conflict",
  message: "Request conflicts with an existing resource",
}
const invalid: CoordinationContracts.Failure = { code: "invalid", message: "Invalid project or thread input" }
const notFound: CoordinationContracts.Failure = { code: "not_found", message: "OpenCode project or session not found" }

export type Dependencies = {
  readonly db: Database.Interface["db"]
  readonly access: CoordinationContracts.Access
  readonly events: Pick<CoordinationContracts.Events, "append">
  readonly queue: Pick<CoordinationContracts.Queue, "instructions">
  readonly projectAdmission: CoordinationContracts.ProjectAdmission
  readonly sessionBinding: CoordinationContracts.SessionBinding
  readonly members: { readonly hasMember: (userId: Coordination.UserID) => boolean }
}

function projectFromRow(row: typeof SharedProjectTable.$inferSelect): Coordination.SharedProject {
  return {
    id: row.id,
    name: row.name,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at).toISOString(),
  }
}

function membershipFromRow(row: typeof MembershipTable.$inferSelect): Coordination.Membership {
  return {
    projectId: row.project_id,
    userId: row.user_id,
    role: row.role,
    joinedAt: new Date(row.joined_at).toISOString(),
  }
}

export function make(input: Dependencies): CoordinationContracts.Projects {
  const db = input.db

  const list: CoordinationContracts.Projects["list"] = (auth) =>
    Effect.gen(function* () {
      if (auth.kind !== "member") return yield* Effect.fail(forbidden)
      const rows = yield* db
        .select({ project: SharedProjectTable })
        .from(SharedProjectTable)
        .innerJoin(MembershipTable, eq(MembershipTable.project_id, SharedProjectTable.id))
        .where(eq(MembershipTable.user_id, auth.userId))
        .orderBy(asc(SharedProjectTable.created_at), asc(SharedProjectTable.id))
        .all()
        .pipe(Effect.orDie)
      return rows.map((row) => projectFromRow(row.project))
    })

  const get: CoordinationContracts.Projects["get"] = (auth, projectId) =>
    Effect.gen(function* () {
      yield* input.access.authorize(auth, projectId, undefined, "read")
      const project = yield* db
        .select()
        .from(SharedProjectTable)
        .where(eq(SharedProjectTable.id, projectId))
        .get()
        .pipe(Effect.orDie)
      if (!project) return yield* Effect.fail(forbidden)
      const members = yield* db
        .select()
        .from(MembershipTable)
        .where(eq(MembershipTable.project_id, projectId))
        .orderBy(asc(MembershipTable.joined_at), asc(MembershipTable.user_id))
        .all()
        .pipe(Effect.orDie)
      return { project: projectFromRow(project), members: members.map(membershipFromRow) }
    })

  const create: CoordinationContracts.Projects["create"] = (request) =>
    Effect.gen(function* () {
      if (request.auth.kind !== "member") return yield* Effect.fail(forbidden)
      if (!request.requestId || !request.name.trim() || request.name.length > 8000) return yield* Effect.fail(invalid)
      const prior = yield* db
        .select()
        .from(SharedProjectTable)
        .where(
          and(
            eq(SharedProjectTable.created_by, request.auth.userId),
            eq(SharedProjectTable.request_id, request.requestId),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      if (prior)
        return prior.id === request.projectId && prior.name === request.name
          ? projectFromRow(prior)
          : yield* Effect.fail(conflict)
      const admitted = yield* input.projectAdmission
        .canShareExistingProject(request.auth.userId, request.projectId)
        .pipe(Effect.mapError((error) => (error.code === "unavailable" ? error : forbidden)))
      if (!admitted) return yield* Effect.fail(forbidden)
      const existing = yield* db
        .select({ id: SharedProjectTable.id })
        .from(SharedProjectTable)
        .where(eq(SharedProjectTable.id, request.projectId))
        .get()
        .pipe(Effect.orDie)
      if (existing) {
        yield* input.access.authorize(request.auth, request.projectId, undefined, "read")
        return yield* Effect.fail(conflict)
      }
      const opencode = yield* db
        .select({ id: ProjectTable.id })
        .from(ProjectTable)
        .where(eq(ProjectTable.id, request.projectId))
        .get()
        .pipe(Effect.orDie)
      if (!opencode) return yield* Effect.fail(notFound)
      const now = Date.now()
      const project = {
        id: request.projectId,
        name: request.name,
        createdBy: request.auth.userId,
        createdAt: new Date(now).toISOString(),
      } satisfies Coordination.SharedProject
      yield* input.events.append(
        {
          projectId: request.projectId,
          kind: "project.created",
          occurredAt: project.createdAt,
          actorId: request.auth.userId,
          payload: { name: request.name },
        },
        () =>
          Effect.gen(function* () {
            yield* db
              .insert(SharedProjectTable)
              .values({
                id: project.id,
                name: project.name,
                created_by: project.createdBy,
                created_at: now,
                request_id: request.requestId,
              })
              .run()
            yield* db
              .insert(MembershipTable)
              .values({ project_id: project.id, user_id: project.createdBy, role: "owner", joined_at: now })
              .run()
          }).pipe(Effect.orDie),
      )
      return project
    })

  const listThreads: CoordinationContracts.Projects["listThreads"] = (auth, projectId) =>
    Effect.gen(function* () {
      yield* input.access.authorize(auth, projectId, undefined, "read")
      const rows = yield* db
        .select()
        .from(ThreadTable)
        .where(eq(ThreadTable.project_id, projectId))
        .orderBy(asc(ThreadTable.created_at), asc(ThreadTable.id))
        .all()
        .pipe(Effect.orDie)
      return rows.map(threadFromRow)
    })

  const createThread: CoordinationContracts.Projects["createThread"] = (request) =>
    Effect.gen(function* () {
      if (request.auth.kind !== "member") return yield* Effect.fail(forbidden)
      if (!request.requestId || !request.title.trim() || request.title.length > 8000) return yield* Effect.fail(invalid)
      yield* input.access.authorize(request.auth, request.projectId, undefined, "submit")
      const prior = yield* db
        .select()
        .from(ThreadTable)
        .where(
          and(
            eq(ThreadTable.project_id, request.projectId),
            eq(ThreadTable.created_by, request.auth.userId),
            eq(ThreadTable.request_id, request.requestId),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      if (prior)
        return prior.session_id === request.sessionId && prior.title === request.title
          ? threadFromRow(prior)
          : yield* Effect.fail(conflict)
      const session = yield* db
        .select({ project_id: SessionTable.project_id })
        .from(SessionTable)
        .where(eq(SessionTable.id, request.sessionId))
        .get()
        .pipe(Effect.orDie)
      if (!session || session.project_id !== request.projectId) return yield* Effect.fail(notFound)
      const binding = yield* input.sessionBinding.resolve(request.sessionId)
      if (binding.projectId !== request.projectId) return yield* Effect.fail(notFound)
      const shared = yield* db
        .select({ id: ThreadTable.id })
        .from(ThreadTable)
        .where(eq(ThreadTable.session_id, request.sessionId))
        .get()
        .pipe(Effect.orDie)
      if (shared) return yield* Effect.fail(conflict)
      const id = Coordination.ThreadID.make(`thr_${randomUUID()}`)
      const now = Date.now()
      const createdAt = new Date(now).toISOString()
      const createdBy = request.auth.userId
      const event = yield* input.events.append(
        {
          projectId: request.projectId,
          threadId: id,
          kind: "thread.created",
          occurredAt: createdAt,
          actorId: createdBy,
          payload: { sessionId: request.sessionId, workerId: binding.workerId, title: request.title },
        },
        (seq) =>
          db
            .insert(ThreadTable)
            .values({
              id,
              project_id: request.projectId,
              session_id: request.sessionId,
              worker_id: binding.workerId,
              title: request.title,
              created_by: createdBy,
              created_at: now,
              activity_seq: seq,
              request_id: request.requestId,
            })
            .run()
            .pipe(Effect.asVoid, Effect.orDie),
      )
      return {
        id,
        projectId: request.projectId,
        sessionId: request.sessionId,
        workerId: binding.workerId,
        title: request.title,
        createdBy,
        createdAt,
        activitySeq: event.seq,
      }
    })

  const contributions: CoordinationContracts.Projects["contributions"] = (auth, projectId, userId) =>
    Effect.gen(function* () {
      yield* input.access.authorize(auth, projectId, undefined, "read")
      const rows = yield* db
        .select({ comment: CommentTable, project_id: ThreadTable.project_id })
        .from(CommentTable)
        .innerJoin(ThreadTable, eq(CommentTable.thread_id, ThreadTable.id))
        .where(
          userId
            ? and(eq(ThreadTable.project_id, projectId), eq(CommentTable.author_id, userId))
            : eq(ThreadTable.project_id, projectId),
        )
        .all()
        .pipe(Effect.orDie)
      const comments: Coordination.Contribution[] = rows.map((row) => ({
        projectId: row.project_id,
        threadId: row.comment.thread_id,
        userId: row.comment.author_id,
        sourceKind: "comment",
        sourceId: row.comment.id,
        occurredAt: new Date(row.comment.created_at).toISOString(),
      }))
      const threads = yield* db
        .select({ id: ThreadTable.id })
        .from(ThreadTable)
        .where(eq(ThreadTable.project_id, projectId))
        .all()
        .pipe(Effect.orDie)
      const instructionLists = yield* Effect.forEach(threads, (thread) => input.queue.instructions(thread.id))
      const instructions = instructionLists.flat().filter((item) => !userId || item.actorId === userId)
      return [
        ...comments,
        ...instructions.map((item) => ({
          projectId,
          threadId: item.threadId,
          userId: item.actorId,
          sourceKind: "instruction" as const,
          sourceId: item.id,
          occurredAt: item.submittedAt,
        })),
      ].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.sourceId.localeCompare(b.sourceId))
    })

  const grantMember: CoordinationContracts.Projects["grantMember"] = (request) =>
    Effect.gen(function* () {
      if (request.auth.kind !== "member") return yield* Effect.fail(forbidden)
      if (!request.requestId) return yield* Effect.fail(invalid)
      const owner = yield* db
        .select({ role: MembershipTable.role })
        .from(MembershipTable)
        .where(and(eq(MembershipTable.project_id, request.projectId), eq(MembershipTable.user_id, request.auth.userId)))
        .get()
        .pipe(Effect.orDie)
      if (owner?.role !== "owner") return yield* Effect.fail(forbidden)
      const prior = yield* db
        .select()
        .from(MembershipTable)
        .where(
          and(
            eq(MembershipTable.project_id, request.projectId),
            eq(MembershipTable.added_by, request.auth.userId),
            eq(MembershipTable.request_id, request.requestId),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      if (prior) return prior.user_id === request.targetUserId ? membershipFromRow(prior) : yield* Effect.fail(conflict)
      if (!input.members.hasMember(request.targetUserId)) return yield* Effect.fail(notFound)
      const current = yield* db
        .select()
        .from(MembershipTable)
        .where(
          and(eq(MembershipTable.project_id, request.projectId), eq(MembershipTable.user_id, request.targetUserId)),
        )
        .get()
        .pipe(Effect.orDie)
      if (current) return membershipFromRow(current)
      const now = Date.now()
      const addedBy = request.auth.userId
      yield* input.events.append(
        {
          projectId: request.projectId,
          kind: "membership.changed",
          occurredAt: new Date(now).toISOString(),
          actorId: addedBy,
          payload: { userId: request.targetUserId, role: "member" },
        },
        () =>
          db
            .insert(MembershipTable)
            .values({
              project_id: request.projectId,
              user_id: request.targetUserId,
              role: "member",
              joined_at: now,
              added_by: addedBy,
              request_id: request.requestId,
            })
            .run()
            .pipe(Effect.asVoid, Effect.orDie),
      )
      return {
        projectId: request.projectId,
        userId: request.targetUserId,
        role: "member",
        joinedAt: new Date(now).toISOString(),
      }
    })

  return { list, get, create, grantMember, listThreads, createThread, contributions }
}
