import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import type { Coordination } from "@opencode-ai/schema/coordination"

export const CooperationRevisionTable = sqliteTable(
  "coordination_cooperation_revision",
  {
    thread_id: text().$type<Coordination.ThreadID>().notNull(),
    version: integer().notNull(),
    owner_id: text().$type<Coordination.UserID>().notNull(),
    request_id: text().notNull(),
    content: text({ mode: "json" }).$type<Coordination.CooperationContent>().notNull(),
    updated_at: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.thread_id, table.version] }),
    uniqueIndex("coordination_cooperation_request_idx").on(table.thread_id, table.request_id),
  ],
)
