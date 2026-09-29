export * as RunnerHarnessApprovalSql from "./approval.sql"

import type { Coordination } from "@opencode-ai/schema/coordination"
import type { Permission } from "@opencode-ai/schema/permission"
import type { Session } from "@opencode-ai/schema/session"
import { sql } from "drizzle-orm"
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import type { ApprovalMapping } from "./contracts"

export const ApprovalMappingTable = sqliteTable(
  "runner_harness_approval",
  {
    approval_id: text().primaryKey(),
    run_id: text().$type<Coordination.RunID>().notNull(),
    thread_id: text().$type<Coordination.ThreadID>().notNull(),
    session_id: text().$type<Session.ID>().notNull(),
    permission_request_id: text().$type<Permission.ID>().notNull(),
    tool_call_id: text().notNull(),
    source_message_id: text().notNull(),
    scope_hash: text().notNull(),
    tool_name: text().notNull(),
    summary: text().notNull(),
    decision_id: text(),
    decision: text().$type<"approve" | "reject">(),
    delivery: text().$type<ApprovalMapping["delivery"]>().notNull(),
    invalidated_reason: text().$type<"cancelled" | "terminal" | "native_request_missing">(),
    requested_at: integer().notNull(),
    updated_at: integer().notNull(),
  },
  (table) => [
    uniqueIndex("runner_harness_approval_permission_idx").on(table.permission_request_id),
    uniqueIndex("runner_harness_approval_decision_idx").on(table.decision_id),
    uniqueIndex("runner_harness_approval_active_run_idx")
      .on(table.run_id)
      .where(sql`${table.delivery} IN ('pending', 'unknown')`),
    index("runner_harness_approval_run_idx").on(table.run_id, table.requested_at),
  ],
)
