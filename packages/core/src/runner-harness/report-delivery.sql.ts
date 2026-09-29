import type { Coordination } from "@opencode-ai/schema/coordination"
import type { CoordinationContracts } from "../coordination/contracts"
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { ExecutionTable } from "./sql"

export const OutboxTable = sqliteTable(
  "runner_harness_outbox",
  {
    callback_id: text().primaryKey(),
    run_id: text()
      .$type<Coordination.RunID>()
      .notNull()
      .references(() => ExecutionTable.run_id, { onDelete: "restrict" }),
    producer_key: text().notNull(),
    worker_id: text().$type<Coordination.WorkerID>().notNull(),
    instance_id: text().notNull(),
    ordinal: integer().notNull(),
    callback: text({ mode: "json" }).$type<CoordinationContracts.RunnerCallback>().notNull(),
    source_session_seq: integer(),
    terminal: integer().notNull().default(0),
    created_at: integer().notNull(),
    acknowledged_at: integer(),
    attempt_count: integer().notNull().default(0),
    next_attempt_at: integer().notNull(),
    permanent_failure_at: integer(),
    last_error: text(),
  },
  (table) => [
    uniqueIndex("runner_harness_outbox_producer_idx").on(table.run_id, table.producer_key),
    uniqueIndex("runner_harness_outbox_order_idx").on(table.run_id, table.ordinal),
    index("runner_harness_outbox_due_idx").on(table.acknowledged_at, table.permanent_failure_at, table.next_attempt_at),
  ],
)
