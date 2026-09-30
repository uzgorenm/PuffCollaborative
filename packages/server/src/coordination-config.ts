export * as CoordinationConfig from "./coordination-config"

export function identitiesPath() {
  return process.env.OPENCODE_COORDINATION_IDENTITIES_PATH?.trim() || undefined
}

export function admissionsPath() {
  return process.env.OPENCODE_COORDINATION_ADMISSIONS_PATH?.trim() || undefined
}

export function mockRunner() {
  return process.env.OPENCODE_COORDINATION_MOCK_RUNNER === "1"
}

export function mockWorker() {
  return process.env.OPENCODE_COORDINATION_MOCK_WORKER_ID?.trim() || undefined
}

export function mockInstance() {
  return process.env.OPENCODE_COORDINATION_MOCK_INSTANCE_ID?.trim() || "local-mock"
}

export function provisioningPath() {
  return process.env.OPENCODE_COORDINATION_PROVISIONING_PATH?.trim() || undefined
}
