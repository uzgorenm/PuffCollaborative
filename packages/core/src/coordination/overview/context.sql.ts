import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import type { Coordination } from "@opencode-ai/schema/coordination"
import { SharedProjectTable } from "../projects/sql"
import type { ProjectContext } from "./context"

export const ProjectBriefRevisionTable = sqliteTable(
  "coordination_project_brief_revision",
  {
    project_id: text()
      .$type<Coordination.ProjectID>()
      .notNull()
      .references(() => SharedProjectTable.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    content: text({ mode: "json" }).$type<ProjectContext.BriefContent>().notNull(),
    updated_by: text().$type<Coordination.UserID>().notNull(),
    updated_at: integer().notNull(),
    request_id: text().notNull(),
    event_seq: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.project_id, table.version] }),
    uniqueIndex("coordination_project_brief_request_idx").on(table.project_id, table.updated_by, table.request_id),
  ],
)

export const PersonFocusRevisionTable = sqliteTable(
  "coordination_person_focus_revision",
  {
    project_id: text()
      .$type<Coordination.ProjectID>()
      .notNull()
      .references(() => SharedProjectTable.id, { onDelete: "cascade" }),
    user_id: text().$type<Coordination.UserID>().notNull(),
    version: integer().notNull(),
    focus_text: text(),
    updated_at: integer().notNull(),
    request_id: text().notNull(),
    event_seq: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.project_id, table.user_id, table.version] }),
    uniqueIndex("coordination_person_focus_request_idx").on(table.project_id, table.user_id, table.request_id),
  ],
)
