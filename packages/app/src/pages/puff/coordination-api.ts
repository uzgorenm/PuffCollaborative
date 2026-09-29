import { ProjectApiError, serviceUrl, type ProjectTransport } from "./project-api"

// This is the only registered coordination HTTP route at the current backend commit.
// Do not rename the provisional adapter's URLs and pretend its different records are compatible.
export async function checkCoordination(config: {
  baseUrl: string
  username: string
  password: string
  transport?: ProjectTransport
}) {
  const root = serviceUrl(config.baseUrl)
  if (!config.username || config.username.includes(":")) throw new ProjectApiError("unauthorized")
  const credential = btoa(
    Array.from(new TextEncoder().encode(`${config.username}:${config.password}`), (byte) =>
      String.fromCharCode(byte),
    ).join(""),
  )
  const response = await (config.transport ?? fetch)(`${root}/api/coordination/v1/status`, {
    headers: { Authorization: `Basic ${credential}` },
    redirect: "error",
    credentials: "omit",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {
    throw new ProjectApiError("connection")
  })
  if (response.status === 503) throw new ProjectApiError("unavailable", 503)
  if (!response.ok)
    throw new ProjectApiError([401, 403].includes(response.status) ? "unauthorized" : "request", response.status)
  const data: unknown = await response.json().catch(() => {
    throw new ProjectApiError("invalid")
  })
  if (!data || typeof data !== "object" || !("ready" in data) || typeof data.ready !== "boolean")
    throw new ProjectApiError("invalid")
  if (!data.ready) throw new ProjectApiError("unavailable")
  return true
}
