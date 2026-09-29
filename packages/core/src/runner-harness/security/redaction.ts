export * as RunnerRedaction from "./redaction"

import path from "path"
import { Redacted } from "effect"

const sensitiveName =
  /^(?:\.env(?:\..*)?|\.envrc|\.direnv|\.npmrc|\.pypirc|\.netrc|\.git|\.ssh|\.aws|\.config|\.runner-home|credentials(?:\..*)?|secrets?(?:\..*)?|service-account\.json|id_(?:rsa|dsa|ed25519)(?:\.pub)?|.*\.(?:pem|p12|pfx|key|sqlite|db))$/i
const secretField =
  /["']?\b(authorization|proxy-authorization|cookie|set-cookie|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret))["']?\s*[:=]\s*["']?(?:bearer\s+|basic\s+)?[^\s,;"'}]+/gi

export function make(secrets: ReadonlyArray<Redacted.Redacted>) {
  const values = secrets.map(Redacted.value).filter((value) => value.length >= 4)
  return (text: string) =>
    values
      .reduce((current, value) => current.replaceAll(value, "[REDACTED]"), text)
      .replace(secretField, "$1=[REDACTED]")
}

export function sensitiveArtifact(file: string) {
  return path
    .normalize(file)
    .split(path.sep)
    .some((segment) => sensitiveName.test(segment))
}

export function safeReference(ref: string | undefined) {
  if (ref === undefined) return undefined
  if (!/^(?:opencode|runner|git|artifact):[A-Za-z0-9_.-][A-Za-z0-9_./:-]*$/.test(ref) || ref.includes(".."))
    return undefined
  return ref
}
