import { randomUUID } from "node:crypto"
import { open, rename, unlink, link } from "node:fs/promises"

export async function atomicPrivateFile(file: string, content: string | Uint8Array, exclusive = false) {
  const temporary = `${file}.${randomUUID()}.next`
  const handle = await open(temporary, "wx", 0o600)
  try {
    await handle.writeFile(content)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    if (exclusive) {
      await link(temporary, file)
      await unlink(temporary)
    } else await rename(temporary, file)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
}

export const atomicPrivateJson = (file: string, value: unknown, exclusive = false) =>
  atomicPrivateFile(file, JSON.stringify(value, null, 2), exclusive)
