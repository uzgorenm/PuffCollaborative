import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261002045007_analysis_results",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`coordination_flower_delivery\` RENAME TO \`coordination_analysis_delivery\`;`)
      yield* tx.run(`ALTER TABLE \`coordination_flower_result\` RENAME TO \`coordination_analysis_result\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`coordination_flower_delivery_message_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`coordination_flower_result_request_idx\`;`)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`coordination_analysis_delivery_message_idx\` ON \`coordination_analysis_delivery\` (\`message_id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`coordination_analysis_result_request_idx\` ON \`coordination_analysis_result\` (\`project_id\`,\`request_id\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
