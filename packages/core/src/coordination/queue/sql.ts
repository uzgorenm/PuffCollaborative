import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"
import type { Coordination } from "@opencode-ai/schema/coordination"
import type { CoordinationContracts } from "../contracts"

export const InstructionTable = sqliteTable(
  "coordination_instruction",
  {
    id: text().$type<Coordination.InstructionID>().primaryKey(),
    request_id: text().notNull(),
    project_id: text().$type<Coordination.ProjectID>().notNull(),
    thread_id: text().$type<Coordination.ThreadID>().notNull(),
    actor_id: text().$type<Coordination.UserID>().notNull(),
    text: text().notNull(),
    queue_seq: integer().notNull(),
    submitted_at: integer().notNull(),
    run_id: text().$type<Coordination.RunID>().notNull(),
  },
  (table) => [
    uniqueIndex("coordination_instruction_request_idx").on(table.thread_id, table.actor_id, table.request_id),
    uniqueIndex("coordination_instruction_order_idx").on(table.thread_id, table.queue_seq),
    uniqueIndex("coordination_instruction_run_idx").on(table.run_id),
    index("coordination_instruction_project_idx").on(table.project_id),
  ],
)

export const RunTable = sqliteTable(
  "coordination_run",
  {
    id: text().$type<Coordination.RunID>().primaryKey(),
    thread_id: text().$type<Coordination.ThreadID>().notNull(),
    instruction_id: text()
      .$type<Coordination.InstructionID>()
      .notNull()
      .references(() => InstructionTable.id, { onDelete: "cascade" }),
    state: text().$type<Coordination.RunState>().notNull(),
    attempt: integer().notNull(),
    runner_message_id: text().notNull(),
    execution_owner_worker_id: text().$type<Coordination.WorkerID>(),
    execution_owner_instance_id: text(),
    lease_until: integer(),
    created_at: integer().notNull(),
    started_at: integer(),
    ended_at: integer(),
  },
  (table) => [
    uniqueIndex("coordination_run_instruction_idx").on(table.instruction_id),
    uniqueIndex("coordination_run_message_idx").on(table.runner_message_id),
    uniqueIndex("coordination_run_active_thread_idx")
      .on(table.thread_id)
      .where(sql`${table.state} IN ('reserved', 'running', 'waiting_approval', 'cancelling', 'recovery_required')`),
    index("coordination_run_thread_state_idx").on(table.thread_id, table.state),
    index("coordination_run_owner_idx").on(
      table.execution_owner_worker_id,
      table.execution_owner_instance_id,
      table.state,
    ),
  ],
)

export const RunCallbackTable = sqliteTable("coordination_run_callback", {
  callback_id: text().primaryKey(),
  run_id: text()
    .$type<Coordination.RunID>()
    .notNull()
    .references(() => RunTable.id, { onDelete: "cascade" }),
  callback: text({ mode: "json" }).$type<CoordinationContracts.RunnerCallback>().notNull(),
  recorded_at: integer().notNull(),
})
