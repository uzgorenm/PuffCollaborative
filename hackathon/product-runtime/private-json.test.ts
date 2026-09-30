import { test, expect } from "bun:test"
import { mkdtemp, readFile, stat, rm, writeFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { atomicPrivateJson } from "./private-json"

test("atomic private writes ignore interrupted temporary files and protect existing exclusive settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "puff-private-json-"))
  const file = join(directory, "saved.json")
  try {
    await writeFile(`${file}.interrupted.next`, "partial")
    await atomicPrivateJson(file, { version: 1 }, true)
    await expect(atomicPrivateJson(file, { version: 9 }, true)).rejects.toThrow()
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ version: 1 })
    await atomicPrivateJson(file, { version: 2 })
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ version: 2 })
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect((await readdir(directory)).sort()).toEqual(["saved.json", "saved.json.interrupted.next"])
  } finally { await rm(directory, { recursive: true, force: true }) }
})
