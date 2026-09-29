import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260929202500_runner_harness_outbox",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`runner_harness_outbox\` (
          \`callback_id\` text PRIMARY KEY,
          \`run_id\` text NOT NULL REFERENCES \`runner_harness_execution\`(\`run_id\`) ON DELETE RESTRICT,
          \`producer_key\` text NOT NULL,
          \`worker_id\` text NOT NULL,
          \`instance_id\` text NOT NULL,
          \`ordinal\` integer NOT NULL,
          \`callback\` text NOT NULL,
          \`source_session_seq\` integer,
          \`terminal\` integer NOT NULL DEFAULT 0,
          \`created_at\` integer NOT NULL,
          \`acknowledged_at\` integer,
          \`attempt_count\` integer NOT NULL DEFAULT 0,
          \`next_attempt_at\` integer NOT NULL,
          \`permanent_failure_at\` integer,
          \`last_error\` text
        );
      `)
      yield* tx.run(
        "CREATE UNIQUE INDEX `runner_harness_outbox_producer_idx` ON `runner_harness_outbox` (`run_id`,`producer_key`);",
      )
      yield* tx.run(
        "CREATE UNIQUE INDEX `runner_harness_outbox_order_idx` ON `runner_harness_outbox` (`run_id`,`ordinal`);",
      )
      yield* tx.run(
        "CREATE INDEX `runner_harness_outbox_due_idx` ON `runner_harness_outbox` (`acknowledged_at`,`permanent_failure_at`,`next_attempt_at`);",
      )
    })
  },
} satisfies DatabaseMigration.Migration
