import { randomBytes } from "node:crypto"
import { mkdir, readFile, chmod } from "node:fs/promises"
import { join } from "node:path"
import { atomicPrivateJson } from "./private-json"

export type RuntimeSettings = {
  members: { username: string; userId: string; password: string }[]
  workerId: string
  instanceId: string
  runtimePassword: string
  workerPassword: string
  analysisPassword: string
}

export async function initializeSettings(directory: string): Promise<RuntimeSettings> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
  const file = join(directory, "settings.json")
  const existing = await readFile(file, "utf8").catch((error) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  if (existing) {
    const value = JSON.parse(existing) as RuntimeSettings
    if (
      !Array.isArray(value.members) ||
      value.members.length !== 4 ||
      value.members.some((member) => !member.username || !member.userId || !member.password) ||
      !value.workerId ||
      !value.runtimePassword ||
      !value.workerPassword ||
      !value.analysisPassword
    )
      throw new Error("Invalid saved product runtime settings")
    return value
  }
  const secret = () => randomBytes(32).toString("base64url")
  const value: RuntimeSettings = {
    members: ["serdar", "serhat", "talha", "ferit"].map((username) => ({
      username,
      userId: `usr_${username}`,
      password: secret(),
    })),
    workerId: "wrk_product_local",
    instanceId: "product-local",
    runtimePassword: secret(),
    workerPassword: secret(),
    analysisPassword: secret(),
  }
  await atomicPrivateJson(file, value, true)
  return value
}

export function runtimeEnvironment(directory: string, settings: RuntimeSettings): Record<string, string> {
  return {
    OPENCODE_DB: join(directory, "opencode.sqlite"),
    XDG_DATA_HOME: join(directory, "data"),
    XDG_CONFIG_HOME: join(directory, "config"),
    XDG_STATE_HOME: join(directory, "state"),
    XDG_CACHE_HOME: join(directory, "cache"),
    OPENCODE_SERVER_PASSWORD: settings.runtimePassword,
    OPENCODE_RUNNER_PASSWORD: settings.workerPassword,
    OPENCODE_COORDINATION_IDENTITIES_PATH: join(directory, "identities.json"),
    OPENCODE_COORDINATION_ADMISSIONS_PATH: join(directory, "admissions.json"),
    OPENCODE_COORDINATION_PROVISIONING_PATH: join(directory, "provisioning.json"),
    OPENCODE_COORDINATION_MOCK_RUNNER: "0",
  }
}
