export * as CoordinationAccess from "./index"

import { and, eq } from "drizzle-orm"
import { Effect } from "effect"
import type { Coordination } from "@opencode-ai/schema/coordination"
import type { Database } from "../../database/database"
import type { CoordinationContracts } from "../contracts"
import { MembershipTable } from "../projects/sql"
import { ThreadTable } from "../threads/sql"
import { threadFromRow } from "../threads/row"

const denied: CoordinationContracts.Failure = { code: "forbidden", message: "Access denied" }

export function make(db: Database.Interface["db"]): CoordinationContracts.Access {
  const threadRow = (threadId: Coordination.ThreadID) =>
    db.select().from(ThreadTable).where(eq(ThreadTable.id, threadId)).get().pipe(Effect.orDie)

  const authorize: CoordinationContracts.Access["authorize"] = (auth, projectId, threadId, action) =>
    Effect.gen(function* () {
      const thread = threadId ? yield* threadRow(threadId) : undefined
      if (threadId && (!thread || thread.project_id !== projectId)) return yield* Effect.fail(denied)

      if (auth.kind === "member") {
        if (action === "runner" || action === "update_work_card") return yield* Effect.fail(denied)
        const membership = yield* db
          .select({ user_id: MembershipTable.user_id })
          .from(MembershipTable)
          .where(and(eq(MembershipTable.project_id, projectId), eq(MembershipTable.user_id, auth.userId)))
          .get()
          .pipe(Effect.orDie)
        if (!membership) return yield* Effect.fail(denied)
        return
      }

      if (auth.kind === "runner") {
        if (action !== "runner" || !thread || thread.worker_id !== auth.workerId) return yield* Effect.fail(denied)
        return
      }

      if (action !== "update_work_card" || !thread) return yield* Effect.fail(denied)
    })

  const getThread: CoordinationContracts.Access["getThread"] = (auth, threadId, action) =>
    Effect.gen(function* () {
      const row = yield* threadRow(threadId)
      if (!row) return yield* Effect.fail(denied)
      yield* authorize(auth, row.project_id, threadId, action)
      return threadFromRow(row)
    })

  return { authorize, getThread }
}
