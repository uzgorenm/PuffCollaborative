export * as CoordinationComments from "./index"

import { and, asc, eq } from "drizzle-orm"
import { randomUUID } from "node:crypto"
import { Effect } from "effect"
import type { Coordination } from "@opencode-ai/schema/coordination"
import type { Database } from "../../database/database"
import type { CoordinationContracts } from "../contracts"
import { ThreadTable } from "../threads/sql"
import { CommentTable } from "./sql"

const forbidden: CoordinationContracts.Failure = { code: "forbidden", message: "Access denied" }
const conflict: CoordinationContracts.Failure = {
  code: "conflict",
  message: "Request conflicts with an existing comment",
}
const invalid: CoordinationContracts.Failure = { code: "invalid", message: "Comment must contain 1 to 8000 characters" }
const unavailable: CoordinationContracts.Failure = { code: "unavailable", message: "Comment was not committed" }

class ExactRetry extends Error {}

function fromRow(row: typeof CommentTable.$inferSelect): Coordination.Comment {
  return {
    id: row.id,
    threadId: row.thread_id,
    authorId: row.author_id,
    body: row.body,
    createdAt: new Date(row.created_at).toISOString(),
  }
}

export function make(input: {
  readonly db: Database.Interface["db"]
  readonly access: CoordinationContracts.Access
  readonly events: Pick<CoordinationContracts.Events, "append">
}): CoordinationContracts.Comments {
  const list: CoordinationContracts.Comments["list"] = (auth, threadId) =>
    Effect.gen(function* () {
      yield* input.access.getThread(auth, threadId, "read")
      const rows = yield* input.db
        .select()
        .from(CommentTable)
        .where(eq(CommentTable.thread_id, threadId))
        .orderBy(asc(CommentTable.event_seq), asc(CommentTable.id))
        .all()
        .pipe(Effect.orDie)
      return rows.map(fromRow)
    })

  const create: CoordinationContracts.Comments["create"] = (request) =>
    Effect.gen(function* () {
      if (request.auth.kind !== "member") return yield* Effect.fail(forbidden)
      if (!request.requestId || !request.body.trim() || request.body.length > 8000) return yield* Effect.fail(invalid)
      const authorId = request.auth.userId
      const thread = yield* input.access.getThread(request.auth, request.threadId, "submit")
      const prior = yield* input.db
        .select()
        .from(CommentTable)
        .where(
          and(
            eq(CommentTable.thread_id, request.threadId),
            eq(CommentTable.author_id, authorId),
            eq(CommentTable.request_id, request.requestId),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      if (prior) return prior.body === request.body ? fromRow(prior) : yield* Effect.fail(conflict)
      const id = `comment_${randomUUID()}`
      const now = Date.now()
      const comment = {
        id,
        threadId: request.threadId,
        authorId,
        body: request.body,
        createdAt: new Date(now).toISOString(),
      } satisfies Coordination.Comment
      yield* input.events.append(
        {
          projectId: thread.projectId,
          threadId: request.threadId,
          kind: "comment.created",
          occurredAt: comment.createdAt,
          actorId: comment.authorId,
          payload: { commentId: id, body: request.body },
        },
        (seq) =>
          Effect.gen(function* () {
            const accepted = yield* input.db
              .select()
              .from(CommentTable)
              .where(
                and(
                  eq(CommentTable.thread_id, request.threadId),
                  eq(CommentTable.author_id, authorId),
                  eq(CommentTable.request_id, request.requestId),
                ),
              )
              .get()
            if (accepted) return yield* Effect.die(new ExactRetry())
            yield* input.db
              .insert(CommentTable)
              .values({
                id,
                thread_id: request.threadId,
                author_id: comment.authorId,
                body: comment.body,
                created_at: now,
                event_seq: seq,
                request_id: request.requestId,
              })
              .run()
            yield* input.db
              .update(ThreadTable)
              .set({ activity_seq: seq })
              .where(eq(ThreadTable.id, request.threadId))
              .run()
          }).pipe(Effect.orDie),
      ).pipe(Effect.catchDefect((defect) => defect instanceof ExactRetry ? Effect.void : Effect.die(defect)))
      const stored = yield* input.db
        .select()
        .from(CommentTable)
        .where(
          and(
            eq(CommentTable.thread_id, request.threadId),
            eq(CommentTable.author_id, authorId),
            eq(CommentTable.request_id, request.requestId),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      if (!stored) return yield* Effect.fail(unavailable)
      return stored.body === request.body ? fromRow(stored) : yield* Effect.fail(conflict)
    })

  return { list, create }
}
