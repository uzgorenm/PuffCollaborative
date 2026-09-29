import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import type { Coordination } from "@opencode-ai/schema/coordination"

export const ApprovalTable = sqliteTable(
  "coordination_approval",
  {
    id: text().primaryKey(),
    project_id: text().$type<Coordination.ProjectID>().notNull(),
    thread_id: text().$type<Coordination.ThreadID>().notNull(),
    run_id: text().$type<Coordination.RunID>().notNull(),
    tool_call_id: text().notNull(),
    version: integer().notNull(),
    state: text().$type<Coordination.Approval["state"]>().notNull(),
    requested_at: integer().notNull(),
    requested_seq: integer().notNull(),
    claimed_by: text().$type<Coordination.UserID>(),
    claim_expires_at: integer(),
    decision_id: text(),
    decision: text().$type<"approve" | "reject">(),
    delivery_state: text().$type<Coordination.Approval["deliveryState"]>().notNull(),
    decided_by: text().$type<Coordination.UserID>(),
    decided_at: integer(),
  },
  (table) => [
    index("coordination_approval_thread_idx").on(table.thread_id, table.requested_at),
    index("coordination_approval_run_idx").on(table.run_id),
    index("coordination_approval_delivery_idx").on(table.delivery_state),
    uniqueIndex("coordination_approval_decision_id_idx").on(table.decision_id),
  ],
)
