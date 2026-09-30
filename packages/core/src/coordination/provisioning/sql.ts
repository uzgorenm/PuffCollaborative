import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import type { Coordination } from "@opencode-ai/schema/coordination"
import type { Model } from "@opencode-ai/schema/model"

export const ProvisioningTable = sqliteTable(
  "coordination_session_provisioning",
  {
    id: text().primaryKey(),
    project_id: text().$type<Coordination.ProjectID>().notNull(),
    owner_id: text().$type<Coordination.UserID>().notNull(),
    request_id: text().notNull(),
    title: text().notNull(),
    worker_id: text().$type<Coordination.WorkerID>().notNull(),
    session_id: text().$type<Coordination.Thread["sessionId"]>().notNull(),
    workspace_id: text().notNull(),
    directory: text().notNull(),
    config_signature: text().notNull(),
    model: text({ mode: "json" }).$type<Model.Ref>().notNull(),
    phase: text().$type<"reserved" | "worktree" | "session" | "shared">().notNull(),
    thread: text({ mode: "json" }).$type<Coordination.Thread>(),
    created_at: integer().notNull(),
    updated_at: integer().notNull(),
  },
  (table) => [
    uniqueIndex("coordination_provisioning_request_idx").on(table.project_id, table.owner_id, table.request_id),
    uniqueIndex("coordination_provisioning_session_idx").on(table.session_id),
    uniqueIndex("coordination_provisioning_workspace_idx").on(table.workspace_id),
    uniqueIndex("coordination_provisioning_directory_idx").on(table.directory),
  ],
)
