import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import type { Coordination } from "@opencode-ai/schema/coordination"
import { SessionTable } from "../../session/sql"
import { SharedProjectTable } from "../projects/sql"

export const ThreadTable = sqliteTable(
  "coordination_thread",
  {
    id: text().$type<Coordination.ThreadID>().primaryKey(),
    project_id: text()
      .$type<Coordination.ProjectID>()
      .notNull()
      .references(() => SharedProjectTable.id, { onDelete: "cascade" }),
    session_id: text()
      .$type<Coordination.Thread["sessionId"]>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "restrict" }),
    worker_id: text().$type<Coordination.WorkerID>().notNull(),
    title: text().notNull(),
    created_by: text().$type<Coordination.UserID>().notNull(),
    created_at: integer().notNull(),
    activity_seq: integer().notNull(),
    request_id: text().notNull(),
  },
  (table) => [
    uniqueIndex("coordination_thread_session_idx").on(table.session_id),
    uniqueIndex("coordination_thread_actor_request_idx").on(table.project_id, table.created_by, table.request_id),
    index("coordination_thread_project_idx").on(table.project_id),
  ],
)
