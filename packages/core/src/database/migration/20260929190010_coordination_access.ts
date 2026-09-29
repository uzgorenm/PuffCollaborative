import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260929190010_coordination_access",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE coordination_project (
          id TEXT PRIMARY KEY REFERENCES project(id) ON DELETE RESTRICT,
          name TEXT NOT NULL,
          created_by TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          request_id TEXT NOT NULL
        );
      `)
      yield* tx.run(
        `CREATE UNIQUE INDEX coordination_project_actor_request_idx ON coordination_project(created_by, request_id);`,
      )
      yield* tx.run(`
        CREATE TABLE coordination_membership (
          project_id TEXT NOT NULL REFERENCES coordination_project(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
          joined_at INTEGER NOT NULL,
          added_by TEXT,
          request_id TEXT,
          PRIMARY KEY(project_id, user_id)
        );
      `)
      yield* tx.run(`CREATE INDEX coordination_membership_user_idx ON coordination_membership(user_id, project_id);`)
      yield* tx.run(
        `CREATE UNIQUE INDEX coordination_membership_actor_request_idx ON coordination_membership(project_id, added_by, request_id);`,
      )
      yield* tx.run(`
        CREATE TABLE coordination_thread (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES coordination_project(id) ON DELETE CASCADE,
          session_id TEXT NOT NULL REFERENCES session(id) ON DELETE RESTRICT,
          worker_id TEXT NOT NULL,
          title TEXT NOT NULL,
          created_by TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          activity_seq INTEGER NOT NULL,
          request_id TEXT NOT NULL
        );
      `)
      yield* tx.run(`CREATE UNIQUE INDEX coordination_thread_session_idx ON coordination_thread(session_id);`)
      yield* tx.run(
        `CREATE UNIQUE INDEX coordination_thread_actor_request_idx ON coordination_thread(project_id, created_by, request_id);`,
      )
      yield* tx.run(`CREATE INDEX coordination_thread_project_idx ON coordination_thread(project_id);`)
      yield* tx.run(`
        CREATE TABLE coordination_comment (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES coordination_thread(id) ON DELETE CASCADE,
          author_id TEXT NOT NULL,
          body TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          event_seq INTEGER NOT NULL,
          request_id TEXT NOT NULL
        );
      `)
      yield* tx.run(
        `CREATE UNIQUE INDEX coordination_comment_actor_request_idx ON coordination_comment(thread_id, author_id, request_id);`,
      )
      yield* tx.run(`CREATE INDEX coordination_comment_thread_event_idx ON coordination_comment(thread_id, event_seq);`)
    })
  },
} satisfies DatabaseMigration.Migration
