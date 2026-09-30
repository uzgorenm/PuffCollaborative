import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260929234925_flower_results",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`coordination_flower_delivery\` (
          \`report_id\` text NOT NULL,
          \`note_id\` text NOT NULL,
          \`message_id\` text NOT NULL,
          \`owner_id\` text NOT NULL,
          \`created_at\` integer NOT NULL,
          CONSTRAINT \`coordination_flower_delivery_pk\` PRIMARY KEY(\`report_id\`, \`note_id\`)
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`coordination_flower_result\` (
          \`report_id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`request_id\` text NOT NULL,
          \`service_id\` text NOT NULL,
          \`content\` text NOT NULL,
          \`created_at\` integer NOT NULL
        );
      `)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`coordination_flower_delivery_message_idx\` ON \`coordination_flower_delivery\` (\`message_id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`coordination_flower_result_request_idx\` ON \`coordination_flower_result\` (\`project_id\`,\`request_id\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
