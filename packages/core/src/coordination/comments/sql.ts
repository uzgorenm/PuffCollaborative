import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import type { Coordination } from "@opencode-ai/schema/coordination"
import { ThreadTable } from "../threads/sql"

export const CommentTable = sqliteTable(
  "coordination_comment",
  {
    id: text().primaryKey(),
    thread_id: text()
      .$type<Coordination.ThreadID>()
      .notNull()
      .references(() => ThreadTable.id, { onDelete: "cascade" }),
    author_id: text().$type<Coordination.UserID>().notNull(),
    body: text().notNull(),
    created_at: integer().notNull(),
    event_seq: integer().notNull(),
    request_id: text().notNull(),
  },
  (table) => [
    uniqueIndex("coordination_comment_actor_request_idx").on(table.thread_id, table.author_id, table.request_id),
    index("coordination_comment_thread_event_idx").on(table.thread_id, table.event_seq),
  ],
)
