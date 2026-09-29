import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260929205500_runner_harness_artifact_report",
  up(tx) {
    return tx.run("ALTER TABLE runner_harness_execution ADD artifact_report text;").pipe(Effect.asVoid)
  },
} satisfies DatabaseMigration.Migration
