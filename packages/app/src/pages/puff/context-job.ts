import { ProjectApiError, type ContextJob } from "./project-api"

const key = "puff.pending-context"
const memory = new Map<string, string>()

// Persist only opaque pending IDs, never member credentials or shared content.
export function rememberJob(hub: string, project: string, job: ContextJob) {
  const scope = JSON.stringify([hub.replace(/\/$/, ""), project])
  const jobs = stored()
  if (job.status === "pending") jobs[scope] = job.requestId
  if (job.status !== "pending") delete jobs[scope]
  memory.clear()
  Object.entries(jobs).forEach(([scope, id]) => memory.set(scope, id))
  try {
    sessionStorage.setItem(key, JSON.stringify(jobs))
  } catch {
    /* In-memory reconciliation still works if storage is unavailable. */
  }
}

export function pendingJob(hub: string, project: string): ContextJob | undefined {
  const requestId = stored()[JSON.stringify([hub.replace(/\/$/, ""), project])]
  return requestId ? { requestId, status: "pending" } : undefined
}

export function submittedJob(job: ContextJob, error: unknown): ContextJob {
  // These responses reject admission. Network errors, 409 and server errors remain ambiguous.
  if (error instanceof ProjectApiError && [400, 401, 403, 404, 422].includes(error.status))
    return { ...job, status: "failed" }
  return job
}

function stored(): Record<string, string> {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(key) ?? "{}")
    if (raw && typeof raw === "object" && !Array.isArray(raw))
      return Object.fromEntries(Object.entries(raw).filter(([, id]) => typeof id === "string" && id.length > 0))
  } catch {
    /* Corrupt or unavailable session storage must not break the view. */
  }
  return Object.fromEntries(memory)
}
