import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260929190020_coordination_work_card",
  up(tx) {
    return Effect.gen(function* () {
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
      yield* tx.run(
        `CREATE INDEX \`coordination_work_card_project_idx\` ON \`coordination_work_card\` (\`project_id\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
