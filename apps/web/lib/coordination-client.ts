export type ConnectionState = { connected: boolean; url?: string; username?: string; actorId?: string }
export type CoordinationOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE"
  body?: unknown
  signal?: AbortSignal
  expectedActorId?: string
}
export class CoordinationError extends Error {
  status: number
  details: unknown
  constructor(message: string, status = 0, details?: unknown) {
    super(message)
    this.name = "CoordinationError"
    this.status = status
    this.details = details
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function connection(value: unknown): ConnectionState {
  if (
    !record(value) ||
    typeof value.connected !== "boolean" ||
    (value.connected &&
      (typeof value.url !== "string" || typeof value.username !== "string" || typeof value.actorId !== "string"))
  )
    throw new CoordinationError("Invalid connection response", 502)
  return value.connected
    ? { connected: true, url: String(value.url), username: String(value.username), actorId: String(value.actorId) }
    : { connected: false, ...(typeof value.url === "string" ? { url: value.url } : {}) }
}

export function createCoordinationClient(transport: (url: string, init?: RequestInit) => Promise<Response> = fetch) {
  async function request<T>(url: string, options: CoordinationOptions = {}): Promise<T> {
    options.signal?.throwIfAborted()
    const response = await transport(url, {
      method: options.method ?? "GET",
      cache: "no-store",
      credentials: "same-origin",
      signal: options.signal,
      headers: {
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(options.expectedActorId === undefined ? {} : { "X-Puff-Actor": options.expectedActorId }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }).catch((error: unknown) => {
      if (options.signal?.aborted) throw error
      throw new CoordinationError("Could not reach the local web service", 0)
    })
    if (response.status === 204) return undefined as T
    const text = await response.text()
    const value: unknown = text
      ? (() => {
          try {
            return JSON.parse(text) as unknown
          } catch {
            return undefined
          }
        })()
      : undefined
    if (!response.ok)
      throw new CoordinationError(
        record(value) && typeof value.message === "string"
          ? value.message
          : `Backend request failed (${response.status})`,
        response.status,
        value,
      )
    if (value === undefined) throw new CoordinationError("Backend returned invalid JSON", 502)
    return value as T
  }
  return {
    async connectToBackend(input: { url: string; username: string; password: string }): Promise<ConnectionState> {
      return connection(await request("/api/connection", { method: "POST", body: input }))
    },
    async disconnectBackend(): Promise<void> {
      await request("/api/connection", { method: "DELETE" })
    },
    async readConnection(signal?: AbortSignal): Promise<ConnectionState> {
      return connection(await request("/api/connection", { signal }))
    },
    async coordinationRequest<T>(path: string, options: CoordinationOptions = {}): Promise<T> {
      const pathname = path.split("?")[0]
      if (
        !path.startsWith("/") ||
        path.startsWith("//") ||
        /[%\\#]/.test(path) ||
        pathname
          .slice(1)
          .split("/")
          .some((part) => !part || part === "." || part === "..")
      )
        throw new CoordinationError("Invalid coordination path", 400)
      if (options.body !== undefined && (options.method ?? "GET") === "GET")
        throw new CoordinationError("GET requests cannot include a body", 400)
      if (
        ((options.method ?? "GET") !== "GET" || options.expectedActorId !== undefined) &&
        (typeof options.expectedActorId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(options.expectedActorId))
      )
        throw new CoordinationError("The expected member identity is required for this request", 400)
      return request<T>(`/api/coordination${path}`, options)
    },
  }
}
const client = createCoordinationClient()
export const connectToBackend = client.connectToBackend
export const disconnectBackend = client.disconnectBackend
export const readConnection = client.readConnection
export const coordinationRequest = client.coordinationRequest
