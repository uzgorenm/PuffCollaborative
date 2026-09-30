import { expect, test } from "bun:test"
import { stat } from "node:fs/promises"
import { join } from "node:path"

test("bootstrap selection grants remain private and reject another member or an unselected Session", async () => {
  const env: NodeJS.ProcessEnv = { ...process.env, PUFF_PREVIEW_SERVER_PORT: "4481" }
  delete env.PUFF_MODEL_CONFIG_PATH
  delete env.PUFF_PREVIEW_NATIVE_SCENARIO
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "run.ts"), "--check-only"], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (status !== 0) throw new Error(`Alice launcher failed (${status}): ${stderr}\n${stdout}`)
  const checks = JSON.parse(
    stdout
      .split("\n")
      .find((line) => line.startsWith("ALICE_CHECKS "))!
      .slice(13),
  )
  expect(checks.otherMemberCannotShare).toBe(true)
  expect(checks.privateSessionCannotShare).toBe(true)
  expect(checks.runnerAvailability.configured).toBe(false)
  expect(checks.noModelHistoryFabricated).toBe(true)
  const directory = stdout
    .split("\n")
    .find((line) => line.startsWith("Isolated source/data and measurement receipts: "))!
    .slice("Isolated source/data and measurement receipts: ".length)
  expect((await stat(directory)).mode & 0o777).toBe(0o700)
  expect((await stat(join(directory, "selections.json"))).mode & 0o777).toBe(0o600)
  const selection = await Bun.file(join(directory, "selections.json")).json()
  const capture = await Bun.file(join(directory, "capture.json")).json()
  expect(capture.projectId).toMatch(/^[0-9a-f]{40}$/)
  expect(selection.allowed).toHaveLength(3)
  expect(selection.allowed).toEqual([
    {
      userId: "usr_alice",
      projectId: capture.projectId,
      sessionId: "ses_alice_preview",
      workerId: "wrk_alice_preview",
    },
    {
      userId: "usr_serdar",
      projectId: capture.projectId,
      sessionId: "ses_serdar_preview",
      workerId: "wrk_alice_preview",
    },
    {
      userId: "usr_serdar",
      projectId: capture.projectId,
      sessionId: "ses_serdar_bounded",
      workerId: "wrk_alice_preview",
    },
  ])
}, 90_000)
