import { randomUUID } from "node:crypto"
import { mkdir, open, readFile, unlink } from "node:fs/promises"
import { join } from "node:path"

export async function acquireRuntimeLock(directory: string): Promise<() => Promise<void>> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const file = join(directory, "launcher.lock")
  const token = randomUUID()
  const handle = await open(file, "wx", 0o600).catch((error) => {
    if (error.code === "EEXIST")
      throw new Error(
        `Product runtime is already locked at ${file}. Stop its launcher before starting another. After an unclean shutdown, inspect the recorded PID before removing this lock.`,
      )
    throw error
  })
  await handle.writeFile(JSON.stringify({ pid: process.pid, token }))
  await handle.close()
  let released = false
  return async () => {
    if (released) return
    released = true
    const current = await readFile(file, "utf8")
      .then(JSON.parse)
      .catch(() => undefined)
    if (current?.token === token) await unlink(file)
  }
}
