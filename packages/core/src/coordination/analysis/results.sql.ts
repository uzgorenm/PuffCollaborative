import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import type { Coordination } from "@opencode-ai/schema/coordination"

export const AnalysisResultTable = sqliteTable(
  "coordination_analysis_result",
  {
    report_id: text().primaryKey(),
    project_id: text().$type<Coordination.ProjectID>().notNull(),
    request_id: text().notNull(),
    service_id: text().notNull(),
    content: text({ mode: "json" }).$type<Coordination.AnalysisResultContent>().notNull(),
    created_at: integer().notNull(),
  },
  (table) => [uniqueIndex("coordination_analysis_result_request_idx").on(table.project_id, table.request_id)],
)

export const AnalysisDeliveryTable = sqliteTable(
  "coordination_analysis_delivery",
  {
    report_id: text().notNull(),
    note_id: text().notNull(),
    message_id: text().notNull(),
    owner_id: text().$type<Coordination.UserID>().notNull(),
    created_at: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.report_id, table.note_id] }),
    uniqueIndex("coordination_analysis_delivery_message_idx").on(table.message_id),
  ],
)
