import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../../project/sql"
import type { Coordination } from "@opencode-ai/schema/coordination"

export const SharedProjectTable = sqliteTable(
  "coordination_project",
  {
    id: text()
      .$type<Coordination.ProjectID>()
      .primaryKey()
      .references(() => ProjectTable.id, { onDelete: "restrict" }),
    name: text().notNull(),
    created_by: text().$type<Coordination.UserID>().notNull(),
    created_at: integer().notNull(),
    request_id: text().notNull(),
  },
  (table) => [uniqueIndex("coordination_project_actor_request_idx").on(table.created_by, table.request_id)],
)

export const MembershipTable = sqliteTable(
  "coordination_membership",
  {
    project_id: text()
      .$type<Coordination.ProjectID>()
      .notNull()
      .references(() => SharedProjectTable.id, { onDelete: "cascade" }),
    user_id: text().$type<Coordination.UserID>().notNull(),
    role: text().$type<Coordination.Membership["role"]>().notNull(),
    joined_at: integer().notNull(),
    added_by: text().$type<Coordination.UserID>(),
    request_id: text(),
  },
  (table) => [
    primaryKey({ columns: [table.project_id, table.user_id] }),
    index("coordination_membership_user_idx").on(table.user_id, table.project_id),
    uniqueIndex("coordination_membership_actor_request_idx").on(table.project_id, table.added_by, table.request_id),
  ],
)
