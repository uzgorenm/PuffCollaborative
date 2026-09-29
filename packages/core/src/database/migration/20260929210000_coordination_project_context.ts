import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260929210000_coordination_project_context",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE coordination_project_brief_revision (
          project_id TEXT NOT NULL REFERENCES coordination_project(id) ON DELETE CASCADE,
          version INTEGER NOT NULL,
          content TEXT NOT NULL,
          updated_by TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          request_id TEXT NOT NULL,
          event_seq INTEGER NOT NULL,
          PRIMARY KEY (project_id, version)
        );
      `)
      yield* tx.run(`CREATE UNIQUE INDEX coordination_project_brief_request_idx
        ON coordination_project_brief_revision(project_id, updated_by, request_id);`)
      yield* tx.run(`
        CREATE TABLE coordination_person_focus_revision (
          project_id TEXT NOT NULL REFERENCES coordination_project(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          focus_text TEXT,
          updated_at INTEGER NOT NULL,
          request_id TEXT NOT NULL,
          event_seq INTEGER NOT NULL,
          PRIMARY KEY (project_id, user_id, version)
        );
      `)
      yield* tx.run(`CREATE UNIQUE INDEX coordination_person_focus_request_idx
        ON coordination_person_focus_revision(project_id, user_id, request_id);`)
    })
  },
} satisfies DatabaseMigration.Migration
