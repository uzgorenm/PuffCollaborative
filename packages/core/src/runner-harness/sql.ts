export * as RunnerHarnessSql from "./sql"

import type { Coordination } from "@opencode-ai/schema/coordination"
import type { Session } from "@opencode-ai/schema/session"
import { sql } from "drizzle-orm"
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import type { RunnerArtifacts } from "./artifacts"
import type { LocalPhase, StartCommand } from "./contracts"

export const ThreadBindingTable = sqliteTable(
  "runner_harness_thread",
  {
    thread_id: text().$type<Coordination.ThreadID>().primaryKey(),
    project_id: text().$type<Coordination.ProjectID>().notNull(),
    session_id: text().$type<Session.ID>().notNull(),
    worker_id: text().$type<Coordination.WorkerID>().notNull(),
    workspace_id: text().notNull(),
    directory: text().notNull(),
    created_at: integer().notNull(),
    updated_at: integer().notNull(),
  },
  (table) => [
    uniqueIndex("runner_harness_thread_session_idx").on(table.session_id),
    uniqueIndex("runner_harness_thread_workspace_idx").on(table.workspace_id),
    index("runner_harness_thread_project_idx").on(table.project_id),
  ],
)

export const ExecutionTable = sqliteTable(
  "runner_harness_execution",
  {
    run_id: text().$type<Coordination.RunID>().primaryKey(),
    thread_id: text().$type<Coordination.ThreadID>().notNull(),
    project_id: text().$type<Coordination.ProjectID>().notNull(),
    session_id: text().$type<Session.ID>().notNull(),
    worker_id: text().$type<Coordination.WorkerID>().notNull(),
    instance_id: text().notNull(),
    attempt: integer().notNull(),
    runner_message_id: text().notNull(),
    command: text({ mode: "json" }).$type<StartCommand>().notNull(),
    phase: text().$type<LocalPhase>().notNull(),
    workspace_id: text(),
    workspace_directory: text(),
    runtime_id: text(),
    admitted_message_id: text(),
    artifact_baseline: text({ mode: "json" }).$type<RunnerArtifacts.Baseline>(),
    last_session_seq: integer(),
    interrupt_abort: text().$type<"acknowledged" | "unknown" | "not_delivered">(),
    interrupt_state: text().$type<"stopped" | "already_idle" | "uncertain">(),
    interrupt_checked_at: integer(),
    created_at: integer().notNull(),
    updated_at: integer().notNull(),
    terminal_at: integer(),
  },
  (table) => [
    uniqueIndex("runner_harness_execution_message_idx").on(table.runner_message_id),
    uniqueIndex("runner_harness_execution_active_thread_idx")
      .on(table.thread_id)
      .where(sql`${table.phase} IN ('accepted', 'prepared', 'admitted', 'running', 'waiting_approval', 'cancelling', 'recovery_required')`),
    index("runner_harness_execution_thread_phase_idx").on(table.thread_id, table.phase),
    index("runner_harness_execution_owner_idx").on(table.worker_id, table.instance_id, table.phase),
  ],
)
