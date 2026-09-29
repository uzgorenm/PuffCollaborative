import { expect, test } from "bun:test"
import { ProjectApiError } from "./project-api"
import { rememberJob, pendingJob, submittedJob } from "./context-job"

test("pending_request_survives_disconnect_without_persisting_credentials", () => {
  sessionStorage.clear()
  rememberJob("https://hub.example", "project-a", { requestId: "existing-run", status: "pending" })
  expect(pendingJob("https://hub.example", "project-a")).toEqual({ requestId: "existing-run", status: "pending" })
  expect(pendingJob("https://other.example", "project-a")).toBeUndefined()
  expect(pendingJob("https://hub.example", "project-b")).toBeUndefined()
  rememberJob("https://hub.example", "project-a", { requestId: "existing-run", status: "completed" })
  expect(pendingJob("https://hub.example", "project-a")).toBeUndefined()
})

test("invalid_persisted_jobs_do_not_crash_the_view", () => {
  sessionStorage.setItem("puff.pending-context", "invalid json")
  expect(pendingJob("https://hub.example", "project-a")).toBeUndefined()
})

test("rejected_admission_can_retry_but_ambiguous_submission_keeps_its_id", () => {
  const job = { requestId: "same-request", status: "pending" as const }
  expect(submittedJob(job, new ProjectApiError("request", 422)).status).toBe("failed")
  expect(submittedJob(job, new ProjectApiError("unauthorized", 403)).status).toBe("failed")
  expect(submittedJob(job, new ProjectApiError("connection"))).toEqual(job)
  expect(submittedJob(job, new ProjectApiError("conflict", 409))).toEqual(job)
  expect(submittedJob(job, new ProjectApiError("request", 500))).toEqual(job)
})
