import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260929233322_coordination_provisioning",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`coordination_session_provisioning\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`owner_id\` text NOT NULL,
          \`request_id\` text NOT NULL,
          \`title\` text NOT NULL,
          \`worker_id\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`workspace_id\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`config_signature\` text NOT NULL,
          \`model\` text NOT NULL,
          \`phase\` text NOT NULL,
          \`thread\` text,
          \`created_at\` integer NOT NULL,
          \`updated_at\` integer NOT NULL
        );
      `)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`coordination_provisioning_request_idx\` ON \`coordination_session_provisioning\` (\`project_id\`,\`owner_id\`,\`request_id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`coordination_provisioning_session_idx\` ON \`coordination_session_provisioning\` (\`session_id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`coordination_provisioning_workspace_idx\` ON \`coordination_session_provisioning\` (\`workspace_id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`coordination_provisioning_directory_idx\` ON \`coordination_session_provisioning\` (\`directory\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
