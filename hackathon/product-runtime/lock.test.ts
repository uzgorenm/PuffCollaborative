import { test, expect } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { acquireRuntimeLock } from "./lock"

test("one launcher owns a runtime until its children have stopped", async () => {
  const directory = await mkdtemp(join(tmpdir(), "puff-launch-lock-"))
  try {
    const release = await acquireRuntimeLock(directory)
    await expect(acquireRuntimeLock(directory)).rejects.toThrow("already locked")
    const lock = JSON.parse(await readFile(join(directory, "launcher.lock"), "utf8"))
    expect(lock.pid).toBe(process.pid)
    await release()
    const nextRelease = await acquireRuntimeLock(directory)
    await release()
    await expect(acquireRuntimeLock(directory)).rejects.toThrow("already locked")
    await nextRelease()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
