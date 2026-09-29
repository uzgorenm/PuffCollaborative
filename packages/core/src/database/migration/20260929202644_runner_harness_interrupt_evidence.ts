import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260929202644_runner_harness_interrupt_evidence",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`runner_harness_execution\` ADD \`interrupt_abort\` text;`)
      yield* tx.run(`ALTER TABLE \`runner_harness_execution\` ADD \`interrupt_state\` text;`)
      yield* tx.run(`ALTER TABLE \`runner_harness_execution\` ADD \`interrupt_checked_at\` integer;`)
    })
  },
} satisfies DatabaseMigration.Migration
