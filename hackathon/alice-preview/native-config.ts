import { chmod, mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

/** Materialize config for native Config.Service, whose file loader does not expand CLI variables. */
export async function provisionNativeConfig(root: string, config: unknown, configPath?: string) {
  const directory = join(root, "config", "opencode")
  await mkdir(directory, { recursive: true, mode: 0o700 })
  let text = JSON.stringify(config ?? { formatter: false, lsp: false })
  text = text.replace(/\{env:([^}]+)\}/g, (_, name: string) => JSON.stringify(process.env[name] ?? "").slice(1, -1))
  for (const match of [...text.matchAll(/\{file:([^}]+)\}/g)]) {
    const file = match[1].startsWith("~/")
      ? join(homedir(), match[1].slice(2))
      : resolve(configPath ? dirname(configPath) : root, match[1])
    const value = (await Bun.file(file).text()).trim()
    text = text.replaceAll(match[0], () => JSON.stringify(value).slice(1, -1))
  }
  const path = join(directory, "opencode.json")
  await Bun.write(path, text)
  await chmod(path, 0o600)
  return { directory, path }
}
