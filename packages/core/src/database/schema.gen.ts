import { Effect } from "effect"
import type { DatabaseMigration } from "./migration"

export default {
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`workspace\` (
          \`id\` text PRIMARY KEY,
          \`type\` text NOT NULL,
          \`name\` text DEFAULT '' NOT NULL,
          \`branch\` text,
          \`directory\` text,
          \`extra\` text,
          \`project_id\` text NOT NULL,
          \`time_used\` integer NOT NULL,
          CONSTRAINT \`fk_workspace_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`data_migration\` (
          \`name\` text PRIMARY KEY,
          \`time_completed\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`runner_harness_outbox\` (
          \`callback_id\` text PRIMARY KEY,
          \`run_id\` text NOT NULL,
          \`producer_key\` text NOT NULL,
          \`worker_id\` text NOT NULL,
          \`instance_id\` text NOT NULL,
          \`ordinal\` integer NOT NULL,
          \`callback\` text NOT NULL,
          \`source_session_seq\` integer,
          \`terminal\` integer DEFAULT 0 NOT NULL,
          \`created_at\` integer NOT NULL,
          \`acknowledged_at\` integer,
          \`attempt_count\` integer DEFAULT 0 NOT NULL,
          \`next_attempt_at\` integer NOT NULL,
          \`permanent_failure_at\` integer,
          \`last_error\` text,
          CONSTRAINT \`fk_runner_harness_outbox_run_id_runner_harness_execution_run_id_fk\` FOREIGN KEY (\`run_id\`) REFERENCES \`runner_harness_execution\`(\`run_id\`) ON DELETE RESTRICT
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`account_state\` (
          \`id\` integer PRIMARY KEY,
          \`active_account_id\` text,
          \`active_org_id\` text,
          CONSTRAINT \`fk_account_state_active_account_id_account_id_fk\` FOREIGN KEY (\`active_account_id\`) REFERENCES \`account\`(\`id\`) ON DELETE SET NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`account\` (
          \`id\` text PRIMARY KEY,
          \`email\` text NOT NULL,
          \`url\` text NOT NULL,
          \`access_token\` text NOT NULL,
          \`refresh_token\` text NOT NULL,
          \`token_expiry\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`control_account\` (
          \`email\` text NOT NULL,
          \`url\` text NOT NULL,
          \`access_token\` text NOT NULL,
          \`refresh_token\` text NOT NULL,
          \`token_expiry\` integer,
          \`active\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`control_account_pk\` PRIMARY KEY(\`email\`, \`url\`)
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`coordination_approval\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`thread_id\` text NOT NULL,
          \`run_id\` text NOT NULL,
          \`tool_call_id\` text NOT NULL,
          \`version\` integer NOT NULL,
          \`state\` text NOT NULL,
          \`requested_at\` integer NOT NULL,
          \`requested_seq\` integer NOT NULL,
          \`claimed_by\` text,
          \`claim_expires_at\` integer,
          \`decision_id\` text,
          \`decision\` text,
          \`delivery_state\` text NOT NULL,
          \`decided_by\` text,
          \`decided_at\` integer
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`coordination_comment\` (
          \`id\` text PRIMARY KEY,
          \`thread_id\` text NOT NULL,
          \`author_id\` text NOT NULL,
          \`body\` text NOT NULL,
          \`created_at\` integer NOT NULL,
          \`event_seq\` integer NOT NULL,
          \`request_id\` text NOT NULL,
          CONSTRAINT \`fk_coordination_comment_thread_id_coordination_thread_id_fk\` FOREIGN KEY (\`thread_id\`) REFERENCES \`coordination_thread\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`coordination_membership\` (
          \`project_id\` text NOT NULL,
          \`user_id\` text NOT NULL,
          \`role\` text NOT NULL,
          \`joined_at\` integer NOT NULL,
          \`added_by\` text,
          \`request_id\` text,
          CONSTRAINT \`coordination_membership_pk\` PRIMARY KEY(\`project_id\`, \`user_id\`),
          CONSTRAINT \`fk_coordination_membership_project_id_coordination_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`coordination_project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`coordination_project\` (
          \`id\` text PRIMARY KEY,
          \`name\` text NOT NULL,
          \`created_by\` text NOT NULL,
          \`created_at\` integer NOT NULL,
          \`request_id\` text NOT NULL,
          CONSTRAINT \`fk_coordination_project_id_project_id_fk\` FOREIGN KEY (\`id\`) REFERENCES \`project\`(\`id\`) ON DELETE RESTRICT
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`coordination_instruction\` (
          \`id\` text PRIMARY KEY,
          \`request_id\` text NOT NULL,
          \`project_id\` text NOT NULL,
          \`thread_id\` text NOT NULL,
          \`actor_id\` text NOT NULL,
          \`text\` text NOT NULL,
          \`queue_seq\` integer NOT NULL,
          \`submitted_at\` integer NOT NULL,
          \`run_id\` text NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`coordination_run_callback\` (
          \`callback_id\` text PRIMARY KEY,
          \`run_id\` text NOT NULL,
          \`callback\` text NOT NULL,
          \`recorded_at\` integer NOT NULL,
          CONSTRAINT \`fk_coordination_run_callback_run_id_coordination_run_id_fk\` FOREIGN KEY (\`run_id\`) REFERENCES \`coordination_run\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`coordination_run\` (
          \`id\` text PRIMARY KEY,
          \`thread_id\` text NOT NULL,
          \`instruction_id\` text NOT NULL,
          \`state\` text NOT NULL,
          \`attempt\` integer NOT NULL,
          \`runner_message_id\` text NOT NULL,
          \`execution_owner_worker_id\` text,
          \`execution_owner_instance_id\` text,
          \`lease_until\` integer,
          \`created_at\` integer NOT NULL,
          \`started_at\` integer,
          \`ended_at\` integer,
          CONSTRAINT \`fk_coordination_run_instruction_id_coordination_instruction_id_fk\` FOREIGN KEY (\`instruction_id\`) REFERENCES \`coordination_instruction\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`coordination_thread\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`worker_id\` text NOT NULL,
          \`title\` text NOT NULL,
          \`created_by\` text NOT NULL,
          \`created_at\` integer NOT NULL,
          \`activity_seq\` integer NOT NULL,
          \`request_id\` text NOT NULL,
          CONSTRAINT \`fk_coordination_thread_project_id_coordination_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`coordination_project\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_coordination_thread_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE RESTRICT
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`coordination_work_card\` (
          \`thread_id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`version\` integer NOT NULL,
          \`source_activity_seq\` integer NOT NULL,
          \`data\` text NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`credential\` (
          \`id\` text PRIMARY KEY,
          \`integration_id\` text,
          \`label\` text NOT NULL,
          \`value\` text NOT NULL,
          \`connector_id\` text,
          \`method_id\` text,
          \`active\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`event_sequence\` (
          \`aggregate_id\` text PRIMARY KEY,
          \`seq\` integer NOT NULL,
          \`owner_id\` text
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`event\` (
          \`id\` text PRIMARY KEY,
          \`aggregate_id\` text NOT NULL,
          \`seq\` integer NOT NULL,
          \`type\` text NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_event_aggregate_id_event_sequence_aggregate_id_fk\` FOREIGN KEY (\`aggregate_id\`) REFERENCES \`event_sequence\`(\`aggregate_id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`permission\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`action\` text NOT NULL,
          \`resource\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_permission_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`project_directory\` (
          \`project_id\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`type\` text,
          \`strategy\` text,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`project_directory_pk\` PRIMARY KEY(\`project_id\`, \`directory\`),
          CONSTRAINT \`fk_project_directory_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`project\` (
          \`id\` text PRIMARY KEY,
          \`worktree\` text NOT NULL,
          \`vcs\` text,
          \`name\` text,
          \`icon_url\` text,
          \`icon_url_override\` text,
          \`icon_color\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`time_initialized\` integer,
          \`sandboxes\` text NOT NULL,
          \`commands\` text
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`runner_harness_execution\` (
          \`run_id\` text PRIMARY KEY,
          \`thread_id\` text NOT NULL,
          \`project_id\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`worker_id\` text NOT NULL,
          \`instance_id\` text NOT NULL,
          \`attempt\` integer NOT NULL,
          \`runner_message_id\` text NOT NULL,
          \`command\` text NOT NULL,
          \`phase\` text NOT NULL,
          \`workspace_id\` text,
          \`workspace_directory\` text,
          \`runtime_id\` text,
          \`admitted_message_id\` text,
          \`last_session_seq\` integer,
          \`interrupt_abort\` text,
          \`interrupt_state\` text,
          \`interrupt_checked_at\` integer,
          \`created_at\` integer NOT NULL,
          \`updated_at\` integer NOT NULL,
          \`terminal_at\` integer
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`runner_harness_thread\` (
          \`thread_id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`worker_id\` text NOT NULL,
          \`workspace_id\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`created_at\` integer NOT NULL,
          \`updated_at\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`message\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_message_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`part\` (
          \`id\` text PRIMARY KEY,
          \`message_id\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_part_message_id_message_id_fk\` FOREIGN KEY (\`message_id\`) REFERENCES \`message\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_context_epoch\` (
          \`session_id\` text PRIMARY KEY,
          \`baseline\` text NOT NULL,
          \`snapshot\` text NOT NULL,
          \`baseline_seq\` integer NOT NULL,
          CONSTRAINT \`fk_session_context_epoch_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_input\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`prompt\` text NOT NULL,
          \`delivery\` text NOT NULL,
          \`admitted_seq\` integer NOT NULL,
          \`promoted_seq\` integer,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_input_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_message\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`type\` text NOT NULL,
          \`seq\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_session_message_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`workspace_id\` text,
          \`parent_id\` text,
          \`slug\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`path\` text,
          \`title\` text NOT NULL,
          \`version\` text NOT NULL,
          \`share_url\` text,
          \`summary_additions\` integer,
          \`summary_deletions\` integer,
          \`summary_files\` integer,
          \`summary_diffs\` text,
          \`metadata\` text,
          \`cost\` real DEFAULT 0 NOT NULL,
          \`tokens_input\` integer DEFAULT 0 NOT NULL,
          \`tokens_output\` integer DEFAULT 0 NOT NULL,
          \`tokens_reasoning\` integer DEFAULT 0 NOT NULL,
          \`tokens_cache_read\` integer DEFAULT 0 NOT NULL,
          \`tokens_cache_write\` integer DEFAULT 0 NOT NULL,
          \`revert\` text,
          \`permission\` text,
          \`agent\` text,
          \`model\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`time_compacting\` integer,
          \`time_archived\` integer,
          CONSTRAINT \`fk_session_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`todo\` (
          \`session_id\` text NOT NULL,
          \`content\` text NOT NULL,
          \`status\` text NOT NULL,
          \`priority\` text NOT NULL,
          \`position\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`todo_pk\` PRIMARY KEY(\`session_id\`, \`position\`),
          CONSTRAINT \`fk_todo_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_share\` (
          \`session_id\` text PRIMARY KEY,
          \`id\` text NOT NULL,
          \`secret\` text NOT NULL,
          \`url\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_session_share_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`runner_harness_outbox_producer_idx\` ON \`runner_harness_outbox\` (\`run_id\`,\`producer_key\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`runner_harness_outbox_order_idx\` ON \`runner_harness_outbox\` (\`run_id\`,\`ordinal\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`runner_harness_outbox_due_idx\` ON \`runner_harness_outbox\` (\`acknowledged_at\`,\`permanent_failure_at\`,\`next_attempt_at\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`coordination_approval_thread_idx\` ON \`coordination_approval\` (\`thread_id\`,\`requested_at\`);`,
      )
      yield* tx.run(`CREATE INDEX \`coordination_approval_run_idx\` ON \`coordination_approval\` (\`run_id\`);`)
      yield* tx.run(
        `CREATE INDEX \`coordination_approval_delivery_idx\` ON \`coordination_approval\` (\`delivery_state\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`coordination_approval_decision_id_idx\` ON \`coordination_approval\` (\`decision_id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`coordination_comment_actor_request_idx\` ON \`coordination_comment\` (\`thread_id\`,\`author_id\`,\`request_id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`coordination_comment_thread_event_idx\` ON \`coordination_comment\` (\`thread_id\`,\`event_seq\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`coordination_membership_user_idx\` ON \`coordination_membership\` (\`user_id\`,\`project_id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`coordination_membership_actor_request_idx\` ON \`coordination_membership\` (\`project_id\`,\`added_by\`,\`request_id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`coordination_project_actor_request_idx\` ON \`coordination_project\` (\`created_by\`,\`request_id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`coordination_instruction_request_idx\` ON \`coordination_instruction\` (\`thread_id\`,\`actor_id\`,\`request_id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`coordination_instruction_order_idx\` ON \`coordination_instruction\` (\`thread_id\`,\`queue_seq\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`coordination_instruction_run_idx\` ON \`coordination_instruction\` (\`run_id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`coordination_instruction_project_idx\` ON \`coordination_instruction\` (\`project_id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`coordination_run_instruction_idx\` ON \`coordination_run\` (\`instruction_id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`coordination_run_message_idx\` ON \`coordination_run\` (\`runner_message_id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`coordination_run_active_thread_idx\` ON \`coordination_run\` (\`thread_id\`) WHERE "coordination_run"."state" IN ('reserved', 'running', 'waiting_approval', 'cancelling', 'recovery_required');`,
      )
      yield* tx.run(
        `CREATE INDEX \`coordination_run_thread_state_idx\` ON \`coordination_run\` (\`thread_id\`,\`state\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`coordination_run_owner_idx\` ON \`coordination_run\` (\`execution_owner_worker_id\`,\`execution_owner_instance_id\`,\`state\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`coordination_thread_session_idx\` ON \`coordination_thread\` (\`session_id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`coordination_thread_actor_request_idx\` ON \`coordination_thread\` (\`project_id\`,\`created_by\`,\`request_id\`);`,
      )
      yield* tx.run(`CREATE INDEX \`coordination_thread_project_idx\` ON \`coordination_thread\` (\`project_id\`);`)
      yield* tx.run(
        `CREATE INDEX \`coordination_work_card_project_idx\` ON \`coordination_work_card\` (\`project_id\`);`,
      )
      yield* tx.run(`CREATE UNIQUE INDEX \`event_aggregate_seq_idx\` ON \`event\` (\`aggregate_id\`,\`seq\`);`)
      yield* tx.run(`CREATE INDEX \`event_aggregate_type_seq_idx\` ON \`event\` (\`aggregate_id\`,\`type\`,\`seq\`);`)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`permission_project_action_resource_idx\` ON \`permission\` (\`project_id\`,\`action\`,\`resource\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`runner_harness_execution_message_idx\` ON \`runner_harness_execution\` (\`runner_message_id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`runner_harness_execution_active_thread_idx\` ON \`runner_harness_execution\` (\`thread_id\`) WHERE "runner_harness_execution"."phase" IN ('accepted', 'prepared', 'admitted', 'running', 'waiting_approval', 'cancelling', 'recovery_required');`,
      )
      yield* tx.run(
        `CREATE INDEX \`runner_harness_execution_thread_phase_idx\` ON \`runner_harness_execution\` (\`thread_id\`,\`phase\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`runner_harness_execution_owner_idx\` ON \`runner_harness_execution\` (\`worker_id\`,\`instance_id\`,\`phase\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`runner_harness_thread_session_idx\` ON \`runner_harness_thread\` (\`session_id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`runner_harness_thread_workspace_idx\` ON \`runner_harness_thread\` (\`workspace_id\`);`,
      )
      yield* tx.run(`CREATE INDEX \`runner_harness_thread_project_idx\` ON \`runner_harness_thread\` (\`project_id\`);`)
      yield* tx.run(
        `CREATE INDEX \`message_session_time_created_id_idx\` ON \`message\` (\`session_id\`,\`time_created\`,\`id\`);`,
      )
      yield* tx.run(`CREATE INDEX \`part_message_id_id_idx\` ON \`part\` (\`message_id\`,\`id\`);`)
      yield* tx.run(`CREATE INDEX \`part_session_idx\` ON \`part\` (\`session_id\`);`)
      yield* tx.run(
        `CREATE INDEX \`session_input_session_pending_delivery_seq_idx\` ON \`session_input\` (\`session_id\`,\`promoted_seq\`,\`delivery\`,\`admitted_seq\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_input_session_admitted_seq_idx\` ON \`session_input\` (\`session_id\`,\`admitted_seq\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_input_session_promoted_seq_idx\` ON \`session_input\` (\`session_id\`,\`promoted_seq\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_message_session_seq_idx\` ON \`session_message\` (\`session_id\`,\`seq\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_message_session_type_seq_idx\` ON \`session_message\` (\`session_id\`,\`type\`,\`seq\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_message_session_time_created_id_idx\` ON \`session_message\` (\`session_id\`,\`time_created\`,\`id\`);`,
      )
      yield* tx.run(`CREATE INDEX \`session_message_time_created_idx\` ON \`session_message\` (\`time_created\`);`)
      yield* tx.run(`CREATE INDEX \`session_project_idx\` ON \`session\` (\`project_id\`);`)
      yield* tx.run(`CREATE INDEX \`session_workspace_idx\` ON \`session\` (\`workspace_id\`);`)
      yield* tx.run(`CREATE INDEX \`session_parent_idx\` ON \`session\` (\`parent_id\`);`)
      yield* tx.run(`CREATE INDEX \`todo_session_idx\` ON \`todo\` (\`session_id\`);`)
    })
  },
} satisfies Omit<DatabaseMigration.Migration, "id">
