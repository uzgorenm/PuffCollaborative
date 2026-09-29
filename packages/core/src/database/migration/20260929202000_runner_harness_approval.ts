import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260929202000_runner_harness_approval",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE runner_harness_approval (
          approval_id text PRIMARY KEY,
          run_id text NOT NULL,
          thread_id text NOT NULL,
          session_id text NOT NULL,
          permission_request_id text NOT NULL,
          tool_call_id text NOT NULL,
          source_message_id text NOT NULL,
          scope_hash text NOT NULL,
          tool_name text NOT NULL,
          summary text NOT NULL,
          decision_id text,
          decision text,
          delivery text NOT NULL CHECK (delivery IN ('pending', 'unknown', 'delivered', 'invalidated')),
          invalidated_reason text,
          requested_at integer NOT NULL,
          updated_at integer NOT NULL
        );
      `)
      yield* tx.run(
        `CREATE UNIQUE INDEX runner_harness_approval_permission_idx ON runner_harness_approval (permission_request_id);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX runner_harness_approval_decision_idx ON runner_harness_approval (decision_id);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX runner_harness_approval_active_run_idx ON runner_harness_approval (run_id) WHERE delivery IN ('pending', 'unknown');`,
      )
      yield* tx.run(`CREATE INDEX runner_harness_approval_run_idx ON runner_harness_approval (run_id, requested_at);`)
    })
  },
} satisfies DatabaseMigration.Migration
