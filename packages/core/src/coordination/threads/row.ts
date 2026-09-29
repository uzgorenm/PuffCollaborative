import type { Coordination } from "@opencode-ai/schema/coordination"
import { ThreadTable } from "./sql"

export function threadFromRow(row: typeof ThreadTable.$inferSelect): Coordination.Thread {
  return {
    id: row.id,
    projectId: row.project_id,
    sessionId: row.session_id,
    workerId: row.worker_id,
    title: row.title,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at).toISOString(),
    activitySeq: row.activity_seq,
  }
}
