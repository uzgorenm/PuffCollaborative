import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260929201736_runner_harness_active_guard",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(
        `CREATE UNIQUE INDEX \`runner_harness_execution_active_thread_idx\` ON \`runner_harness_execution\` (\`thread_id\`) WHERE "runner_harness_execution"."phase" IN ('accepted', 'prepared', 'admitted', 'running', 'waiting_approval', 'cancelling', 'recovery_required');`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
