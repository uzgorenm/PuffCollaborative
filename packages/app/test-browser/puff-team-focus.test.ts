import { expect, test } from "bun:test"
import { createTeamController } from "../src/pages/puff/team-state"
import type { ProjectTransport } from "../src/pages/puff/project-api"

const thread = {
  id: "a",
  title: "A",
  projectId: "prj_test",
  sessionId: "ses_a",
  workerId: "worker",
  createdBy: "alice",
  createdAt: "2026-09-29T19:00:00Z",
  activitySeq: 0,
}
const approval = {
  id: "approval-a",
  threadId: "a",
  runId: "run-a",
  toolCallId: "tool-a",
  version: 1,
  state: "pending",
  requestedAt: "2026-09-29T19:00:00Z",
  deliveryState: "none",
}
const snapshot = () => ({ thread, instructions: [], runs: [], approvals: [], workCard: null, cursor: 0 })
function service(handler: (path: string) => Response | undefined): ProjectTransport {
  return async (url) => {
    const path = new URL(url).pathname.replace("/api/coordination/v1", "") + new URL(url).search
    const response = handler(path)
    if (response) return response
    if (path === "/projects")
      return Response.json([{ id: "prj_test", name: "Fixture", createdBy: "alice", createdAt: "2026-09-29T19:00:00Z" }])
    if (path === "/projects/prj_test/threads") return Response.json([thread])
    return Response.json({ events: [], cursor: 0, hasMore: false })
  }
}
async function settle() {
  for (let index = 0; index < 400; index++) await Promise.resolve()
}
async function connected(transport: ProjectTransport) {
  const team = createTeamController(transport)
  expect(await team.connect("https://team.example", "alice", "fixture-only")).toBe(true)
  await settle()
  return team
}
// Store identity is a browser behavior; Solid's server reconcile replaces snapshots.

test("polling_preserves_panel_row_identity_while_applying_changed_fields", async () => {
  let version = 1
  const team = await connected(
    service((path) =>
      path === "/threads/a" ? Response.json({ ...snapshot(), approvals: [{ ...approval, version }] }) : undefined,
    ),
  )
  team.selectThread("a")
  await settle()
  const first = team.state.snapshot?.approvals[0]
  const firstThread = team.state.threads[0]
  expect(first).toBeDefined()
  await team.refresh()
  expect(team.state.snapshot?.approvals[0]).toBe(first)
  expect(team.state.threads[0]).toBe(firstThread)
  version = 2
  await team.refresh()
  expect(team.state.snapshot?.approvals[0]).toBe(first)
  expect(first?.version).toBe(2)
  team.dispose()
})
