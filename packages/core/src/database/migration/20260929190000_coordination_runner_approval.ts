import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260929190000_coordination_runner_approval",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE coordination_approval (
          id text PRIMARY KEY,
          project_id text NOT NULL,
          thread_id text NOT NULL,
          run_id text NOT NULL,
          tool_call_id text NOT NULL,
          version integer NOT NULL,
          state text NOT NULL,
          requested_at integer NOT NULL,
          requested_seq integer NOT NULL,
          claimed_by text,
          claim_expires_at integer,
          decision_id text,
          decision text,
          delivery_state text NOT NULL,
          decided_by text,
          decided_at integer
        );
      `)
      yield* tx.run(`CREATE INDEX coordination_approval_thread_idx ON coordination_approval (thread_id, requested_at);`)
      yield* tx.run(`CREATE INDEX coordination_approval_run_idx ON coordination_approval (run_id);`)
      yield* tx.run(`CREATE INDEX coordination_approval_delivery_idx ON coordination_approval (delivery_state);`)
      yield* tx.run(`CREATE UNIQUE INDEX coordination_approval_decision_id_idx ON coordination_approval (decision_id);`)
    })
  },
} satisfies DatabaseMigration.Migration
