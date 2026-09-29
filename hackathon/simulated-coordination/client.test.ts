import { expect, test } from "bun:test"
import { createSimulationServer } from "./server"
import { createTeamController } from "../../packages/app/src/pages/puff/team-state"
import { fixApplicationState } from "../../packages/app/src/pages/puff/fix-reuse"

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 4000
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10))
  expect(predicate()).toBe(true)
}

async function connected(options: Parameters<typeof createSimulationServer>[0] = {}) {
  const server = createSimulationServer({ ...options, port: 0 })
  const team = createTeamController()
  expect(await team.connect(`http://127.0.0.1:${server.port}`, "alice", "demo-alice")).toBe(true)
  await team.refreshOverview()
  team.selectThread("wf04-alice")
  await team.refresh()
  await until(() => !!team.state.fixProposal)
  return { team, cleanup: () => { team.dispose(); server.stop(true) } }
}

test("ordinary client detects the error and No thanks leaves the target untouched", async () => {
  const { team, cleanup } = await connected()
  try {
    expect(team.state.fixProposal?.actorId).toBe("usr_alya")
    team.dismissFix()
    await team.refresh(); await team.refreshOverview()
    expect(team.state.fixProposal).toBeUndefined()
    expect(team.state.snapshot?.instructions).toHaveLength(0)
  } finally { cleanup() }
})

test("approved fix crosses the real HTTP adapter and proves application with actual target tests", async () => {
  const { team, cleanup } = await connected()
  try {
    expect(team.canApplyFix()).toBe(true)
    await team.applyFix(); await team.refresh()
    const runId = team.state.fixAttempts["wf04-alice"]?.runId
    expect(runId).toBeDefined()
    expect(fixApplicationState(runId!, team.state.events)).toBe("applied")
    expect(team.state.snapshot?.runs).toHaveLength(1)
    await team.applyFix(); await team.refresh()
    expect(team.state.snapshot?.runs).toHaveLength(1)
    team.selectThread("wf04-unrelated"); await team.refresh()
    await until(() => !team.state.loading && !team.state.fixLoading)
    expect(team.state.fixProposal).toBeUndefined()
  } finally { cleanup() }
})

test("a failed real target test never becomes an applied-fix receipt", async () => {
  const { team, cleanup } = await connected({ forcePostTestFailure: true })
  try {
    await team.applyFix(); await team.refresh()
    const runId = team.state.fixAttempts["wf04-alice"]?.runId
    expect(runId).toBeDefined()
    expect(fixApplicationState(runId!, team.state.events)).toBe("failed")
    expect(team.state.snapshot?.runs[0]?.state).toBe("failed")
  } finally { cleanup() }
})
