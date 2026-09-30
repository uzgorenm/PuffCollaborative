import { expect, test } from "bun:test"
import { join } from "node:path"

test("isolated Alice preview verifies persisted exact evidence and authenticated runner boundaries", async () => {
  const env: NodeJS.ProcessEnv = { ...process.env, PUFF_PREVIEW_SERVER_PORT: "4479" }
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
  const line = stdout.split("\n").find((value) => value.startsWith("ALICE_CHECKS "))
  expect(line).toBeDefined()
  const checks = JSON.parse(line!.slice("ALICE_CHECKS ".length))
  const directory = stdout
    .split("\n")
    .find((value) => value.startsWith("Isolated source/data and measurement receipts: "))!
  const capture = await Bun.file(
    join(directory.slice("Isolated source/data and measurement receipts: ".length), "capture.json"),
  ).json()
  expect(capture.occupiedPort).toBeGreaterThan(0)
  expect(capture.occupiedPort).not.toBe(capture.recoveryPort)
  expect(checks.collision).toBe("EADDRINUSE")
  expect(checks.recovered).toBe(true)
  expect(checks.exactEvidence).toBe(true)
  expect(checks.wrongEvidenceRejected).toBe(true)
  expect(checks.staleWorkCardRejected).toBe(true)
  expect(checks.exactWorkCardRetry).toBe(true)
  expect(checks.exactInstructionRetry).toBe(true)
  expect(checks.changedInstructionRetryRejected).toBe(true)
  expect(checks.memberCannotReserve).toBe(true)
  expect(checks.outsiderCannotRead).toBe(true)
  expect(checks.privateSessionNotExported).toBe(true)
  expect(checks.runtimeHistoryClosed).toBe(true)
  expect(checks.staleRunnerRejected).toBe(true)
  expect(checks.realRunner).toBe(true)
  expect(checks.noModelHistoryFabricated).toBe(true)
}, 90_000)
