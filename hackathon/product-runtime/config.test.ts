import { test, expect } from "bun:test"
import { mkdtemp, readFile, stat, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initializeSettings, runtimeEnvironment } from "./config"

test("runtime preserves individual credentials and never aliases member and worker passwords", async () => {
  const directory = await mkdtemp(join(tmpdir(), "puff-product-"))
  try {
    const first = await initializeSettings(directory)
    const again = await initializeSettings(directory)
    expect(again).toEqual(first)
    expect(first.members.map((member) => member.username)).toEqual(["serdar", "serhat", "talha", "ferit"])
    expect(
      new Set([...first.members.map((member) => member.password), first.runtimePassword, first.workerPassword]).size,
    ).toBe(6)
    expect((await stat(join(directory, "settings.json"))).mode & 0o777).toBe(0o600)
    expect(JSON.parse(await readFile(join(directory, "settings.json"), "utf8"))).toEqual(first)
    const environment = runtimeEnvironment(directory, first)
    expect(environment.OPENCODE_COORDINATION_MOCK_RUNNER).toBe("0")
    expect(environment.OPENCODE_DB).toBe(join(directory, "opencode.sqlite"))
    expect(environment.PUFF_MEMBER_USERNAME).toBe("serdar")
    expect(environment.PUFF_MEMBER_PASSWORD).toBe(first.members[0].password)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
