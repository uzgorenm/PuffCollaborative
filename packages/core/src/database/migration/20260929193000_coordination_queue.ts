import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260929193000_coordination_queue",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE coordination_instruction (
          id TEXT PRIMARY KEY NOT NULL,
          request_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          thread_id TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          text TEXT NOT NULL,
          queue_seq INTEGER NOT NULL,
          submitted_at INTEGER NOT NULL,
          run_id TEXT NOT NULL
        );
      `)
      yield* tx.run(
        `CREATE UNIQUE INDEX coordination_instruction_request_idx ON coordination_instruction (thread_id, actor_id, request_id);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX coordination_instruction_order_idx ON coordination_instruction (thread_id, queue_seq);`,
      )
      yield* tx.run(`CREATE UNIQUE INDEX coordination_instruction_run_idx ON coordination_instruction (run_id);`)
      yield* tx.run(`CREATE INDEX coordination_instruction_project_idx ON coordination_instruction (project_id);`)
      yield* tx.run(`
        CREATE TABLE coordination_run (
          id TEXT PRIMARY KEY NOT NULL,
          thread_id TEXT NOT NULL,
          instruction_id TEXT NOT NULL REFERENCES coordination_instruction(id) ON DELETE CASCADE,
          state TEXT NOT NULL,
          attempt INTEGER NOT NULL,
          runner_message_id TEXT NOT NULL,
          execution_owner_worker_id TEXT,
          execution_owner_instance_id TEXT,
          lease_until INTEGER,
          created_at INTEGER NOT NULL,
          started_at INTEGER,
          ended_at INTEGER
        );
      `)
      yield* tx.run(`CREATE UNIQUE INDEX coordination_run_instruction_idx ON coordination_run (instruction_id);`)
      yield* tx.run(`CREATE UNIQUE INDEX coordination_run_message_idx ON coordination_run (runner_message_id);`)
      yield* tx.run(
        `CREATE UNIQUE INDEX coordination_run_active_thread_idx ON coordination_run (thread_id) WHERE state IN ('reserved', 'running', 'waiting_approval', 'cancelling', 'recovery_required');`,
      )
      yield* tx.run(`CREATE INDEX coordination_run_thread_state_idx ON coordination_run (thread_id, state);`)
      yield* tx.run(
        `CREATE INDEX coordination_run_owner_idx ON coordination_run (execution_owner_worker_id, execution_owner_instance_id, state);`,
      )
      yield* tx.run(`
        CREATE TABLE coordination_run_callback (
          callback_id TEXT PRIMARY KEY NOT NULL,
          run_id TEXT NOT NULL REFERENCES coordination_run(id) ON DELETE CASCADE,
          callback TEXT NOT NULL,
          recorded_at INTEGER NOT NULL
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
