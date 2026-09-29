export * as CoordinationSnapshot from "./snapshot"

import { Effect } from "effect"
import type { Database } from "../database/database"
import type { CoordinationContracts } from "./contracts"

export function make(input: {
  readonly database: Database.Interface
  readonly access: CoordinationContracts.Access
  readonly queue: CoordinationContracts.Queue
  readonly runner: CoordinationContracts.Runner
  readonly workCards: CoordinationContracts.WorkCards
  readonly events: CoordinationContracts.Events
}): CoordinationContracts.Snapshot {
  return {
    thread: (auth, threadId) =>
      input.database.db
        .transaction(() =>
          Effect.gen(function* () {
            const thread = yield* input.access.getThread(auth, threadId, "read")
            const instructions = yield* input.queue.instructions(thread.id)
            const runs = yield* input.queue.runs(thread.id)
            const approvals = yield* input.runner.approvals(thread.id)
            const workCard = yield* input.workCards.get(thread.id)
            const cursor = yield* input.events.latestSequence(thread.projectId)
            return { thread, instructions, runs, approvals, workCard, cursor }
          }),
        )
        .pipe(
          Effect.mapError(
            (error): CoordinationContracts.Failure =>
              typeof error === "object" && error !== null && "code" in error && "message" in error
                ? (error as CoordinationContracts.Failure)
                : { code: "unavailable", message: "Could not read the thread snapshot" },
          ),
        ),
  }
}
