import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260929205100_runner_harness_artifact_baseline",
  up(tx) {
    return tx.run("ALTER TABLE runner_harness_execution ADD artifact_baseline text;").pipe(Effect.asVoid)
  },
} satisfies DatabaseMigration.Migration
