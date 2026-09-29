export * as RunnerEnvironment from "./environment"

import path from "path"

export interface ToolConfig {
  readonly workspace: string
  readonly executablePath: string
  readonly locale?: string
  readonly terminal?: string
}

/** Explicit tool-process environment. No value is copied from process.env. */
export function tool(config: ToolConfig): Readonly<Record<string, string>> {
  if (!path.isAbsolute(config.workspace) || !config.executablePath.trim())
    throw new Error("Runner tool environment requires an absolute workspace and configured PATH")
  const home = path.join(config.workspace, ".runner-home")
  return {
    PATH: config.executablePath,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    TMPDIR: path.join(home, ".tmp"),
    LANG: config.locale ?? "C.UTF-8",
    TERM: config.terminal ?? "dumb",
  }
}

export function rejectsInheritedSecrets(environment: Readonly<Record<string, string>>) {
  return Object.keys(environment).every(
    (key) =>
      !/(?:TOKEN|SECRET|PASSWORD|API_KEY|AUTHORIZATION|CREDENTIAL|COOKIE|SSH_|AWS_|GCP_|AZURE_|OPENAI_|ANTHROPIC_)/i.test(
        key,
      ),
  )
}
