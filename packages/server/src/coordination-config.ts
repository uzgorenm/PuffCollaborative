export * as CoordinationConfig from "./coordination-config"

export function identitiesPath() {
  return process.env.OPENCODE_COORDINATION_IDENTITIES_PATH?.trim() || undefined
}
