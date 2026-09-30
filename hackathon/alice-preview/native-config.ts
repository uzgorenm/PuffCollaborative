import { chmod, mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

/** Bound a fresh receiving location to one text-only Responses step. */
export function boundedReceiverConfig(config: Record<string, any>, maxOutputTokens = 1024) {
  const result = structuredClone(config)
  const slash = result.model.indexOf("/")
  const providerId = result.model.slice(0, slash)
  const modelId = result.model.slice(slash + 1)
  const agent = {
    description: "Read-only receiving-session verification from supplied source context",
    mode: "primary",
    steps: 1,
  }
  if (result.providers && !result.provider) {
    result.agents = {
      ...result.agents,
      "serdar-bounded": { ...agent, permissions: [{ action: "*", resource: "*", effect: "deny" }] },
    }
    const model = result.providers[providerId].models[modelId]
    model.request = { ...model.request, body: { ...model.request?.body, max_output_tokens: maxOutputTokens } }
  } else {
    result.agent = { ...result.agent, "serdar-bounded": { ...agent, permission: { "*": "deny" } } }
    const model = result.provider[providerId].models[modelId]
    model.options = { ...model.options, max_output_tokens: maxOutputTokens }
  }
  return result
}

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
