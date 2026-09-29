import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { WorkCard } from "./work-card"

export const WorkCardTable = sqliteTable(
  "coordination_work_card",
  {
    thread_id: text().primaryKey(),
    project_id: text().notNull(),
    version: integer().notNull(),
    source_activity_seq: integer().notNull(),
    data: text({ mode: "json" }).$type<WorkCard.Detail>().notNull(),
    time_updated: integer().notNull(),
  },
  (table) => [index("coordination_work_card_project_idx").on(table.project_id)],
)
