import { expect, test } from "bun:test"
import type { Coordination } from "@opencode-ai/schema/coordination"
import { sessionIdentityView } from "./model"

const labels = {
  session: "Session",
  worker: "Worker",
  owner: "Owner",
  runState: (state: string) => `Run ${state}`,
}

// Synthetic UI fixtures: these IDs and titles are not live Session receipts.
const prefix = "Explore project navigation with persistent labels — "
const compact = {
  title: `${prefix}compact approach`,
  sessionId: "ses_project_navigation_experiment_compact_01",
  workerId: "worker_navigation_one",
  ownerId: "usr_serdar",
  threadId: "thread-compact",
  labels,
}
const expanded = {
  ...compact,
  title: `${prefix}expanded approach`,
  sessionId: "ses_project_navigation_experiment_expanded_02",
  threadId: "thread-expanded",
}
const run = (threadId: string, state: Coordination.RunState) => ({ threadId: threadId as Coordination.ThreadID, state })

test("long same-prefix titles keep distinct visible IDs and full accessible identities", () => {
  const a = sessionIdentityView(compact)
  const b = sessionIdentityView(expanded)
  expect(a.session).toContain("compact_01")
  expect(b.session).toContain("panded_02")
  expect(a.session).not.toBe(b.session)
  expect(a.accessibleLabel).toContain(compact.title)
  expect(b.accessibleLabel).toContain(expanded.title)
  expect(a.accessibleLabel).toContain(compact.sessionId)
  expect(b.accessibleLabel).toContain(expanded.sessionId)
  expect(a.accessibleLabel).toContain("Worker worker_navigation_one")
  expect(a.accessibleLabel).toContain("Owner usr_serdar")
})

test("only a matching active run can add state to the accessible identity", () => {
  expect(sessionIdentityView({ ...compact, run: run("thread-compact", "running") }).state).toBe("Run running")
  expect(sessionIdentityView({ ...expanded, run: run("thread-compact", "running") }).state).toBeUndefined()
  expect(sessionIdentityView({ ...expanded, run: run("thread-expanded", "completed") }).state).toBeUndefined()
  expect(sessionIdentityView({ ...expanded, run: run("thread-expanded", "completed") }).accessibleLabel).not.toContain("Run completed")
})

test("missing optional owner and worker do not create invented labels", () => {
  const view = sessionIdentityView({ title: "Local navigation draft", sessionId: "ses_local_01", labels })
  expect(view.session).toBe("ses_local_01")
  expect(view.accessibleLabel).toContain("Session ses_local_01")
  expect(view.accessibleLabel).not.toContain("Worker")
  expect(view.accessibleLabel).not.toContain("Owner")
})
