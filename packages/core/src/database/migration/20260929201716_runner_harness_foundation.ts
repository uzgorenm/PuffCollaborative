import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260929201716_runner_harness_foundation",
  up(tx) {
    return Effect.gen(function* () {
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
      yield* tx.run(
        `CREATE UNIQUE INDEX \`runner_harness_execution_message_idx\` ON \`runner_harness_execution\` (\`runner_message_id\`);`,
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
    })
  },
} satisfies DatabaseMigration.Migration
