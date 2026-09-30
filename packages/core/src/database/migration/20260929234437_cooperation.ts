import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260929234437_cooperation",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`coordination_cooperation_revision\` (
          \`thread_id\` text NOT NULL,
          \`version\` integer NOT NULL,
          \`owner_id\` text NOT NULL,
          \`request_id\` text NOT NULL,
          \`content\` text NOT NULL,
          \`updated_at\` integer NOT NULL,
          CONSTRAINT \`coordination_cooperation_revision_pk\` PRIMARY KEY(\`thread_id\`, \`version\`)
        );
      `)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`coordination_cooperation_request_idx\` ON \`coordination_cooperation_revision\` (\`thread_id\`,\`request_id\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
