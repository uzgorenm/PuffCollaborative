import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

export type ConnectionOptions = {
  secret?: string
  runtimeDir?: string
  timeoutMs?: number
  maxBodyBytes?: number
  webOrigin?: string
  connectionScope?: string
}
type Session = { url: string; username: string; password: string; actorId: string; expiresAt: number }
function cookieName(options: ConnectionOptions) {
  const scope = options.connectionScope ?? process.env.PUFF_CONNECTION_SCOPE
  if (scope === undefined) return "puff_connection"
  if (!scope || scope.length > 4096) throw new ConnectionFailure(500, "Invalid configured connection scope")
  return `puff_connection_${createHash("sha256").update(scope).digest("hex").slice(0, 24)}`
}
const lifetime = 12 * 60 * 60
const prefix = "/api/coordination/v1"

class ConnectionFailure extends Error {
  status: number
  response?: Response
  constructor(status: number, message: string, response?: Response) {
    super(message)
    this.status = status
    this.response = response
  }
}

function failure(error: unknown) {
  if (error instanceof ConnectionFailure)
    return (
      error.response ??
      Response.json({ message: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } })
    )
  return Response.json(
    { message: "Connection service unavailable" },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  )
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function backendUrl(input: unknown) {
  if (typeof input !== "string" || input.length > 2048) throw new ConnectionFailure(400, "Use a loopback backend URL")
  const url = URL.parse(input)
  if (
    !url ||
    !["http:", "https:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["/", "", prefix, `${prefix}/`].includes(url.pathname)
  )
    throw new ConnectionFailure(400, "Use a loopback backend URL without credentials or query parameters")
  return url.origin
}

function sameOrigin(request: Request, options: ConnectionOptions) {
  const requestUrl = new URL(request.url)
  const configured = options.webOrigin ?? process.env.PUFF_WEB_ORIGIN
  let expected = requestUrl.origin
  if (configured !== undefined) {
    const value = URL.parse(configured)
    if (
      !value ||
      !["http:", "https:"].includes(value.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(value.hostname) ||
      value.username ||
      value.password ||
      value.search ||
      value.hash ||
      value.pathname !== "/"
    )
      throw new ConnectionFailure(500, "Invalid configured web origin")
    expected = value.origin
  } else {
    // Next development can rewrite 127.0.0.1 to localhost in Request.url.
    // Trust only the incoming loopback Host at the same protocol and port;
    // forwarded hosts and foreign Host values are never an origin authority.
    const host = request.headers.get("host")
    const incoming = host ? URL.parse(`${requestUrl.protocol}//${host}`) : undefined
    if (
      incoming &&
      ["http:", "https:"].includes(requestUrl.protocol) &&
      ["127.0.0.1", "localhost", "[::1]"].includes(requestUrl.hostname) &&
      ["127.0.0.1", "localhost", "[::1]"].includes(incoming.hostname) &&
      incoming.host === host &&
      incoming.port === requestUrl.port &&
      !incoming.username &&
      !incoming.password &&
      !incoming.search &&
      !incoming.hash &&
      incoming.pathname === "/"
    )
      expected = incoming.origin
  }
  const origin = request.headers.get("origin")
  if ((origin && origin !== expected) || request.headers.get("sec-fetch-site") === "cross-site")
    throw new ConnectionFailure(403, "Same-origin request required")
}

async function boundedText(stream: ReadableStream<Uint8Array> | null, limit: number) {
  if (!stream) return ""
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))
      size += next.value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw new ConnectionFailure(413, "Request exceeds the permitted size")
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
}

async function jsonBody(request: Request, options: ConnectionOptions) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    throw new ConnectionFailure(415, "JSON request required")
  const length = Number(request.headers.get("content-length") ?? 0)
  const limit = options.maxBodyBytes ?? 65_536
  if (length > limit) throw new ConnectionFailure(413, "Request exceeds the permitted size")
  const text = await boundedText(request.body, limit)
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new ConnectionFailure(400, "Invalid JSON request")
  }
}

async function key(options: ConnectionOptions) {
  const secret = options.secret ?? process.env.PUFF_CONNECTION_SECRET
  if (secret !== undefined) {
    if (secret.length < 32) throw new ConnectionFailure(500, "Connection secret must contain at least 32 characters")
    return createHash("sha256").update(secret).digest()
  }
  const directory = options.runtimeDir ?? process.env.PUFF_RUNTIME_DIR ?? join(process.cwd(), ".puff")
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, "connection.key")
  await writeFile(path, randomBytes(32), { flag: "wx", mode: 0o600 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error
  })
  await chmod(path, 0o600)
  const value = await readFile(path)
  if (value.length !== 32) throw new ConnectionFailure(500, "Connection key is invalid")
  return value
}

async function encrypted(session: Session, options: ConnectionOptions) {
  const nonce = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", await key(options), nonce)
  cipher.setAAD(Buffer.from(cookieName(options)))
  const content = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()])
  return Buffer.concat([nonce, cipher.getAuthTag(), content]).toString("base64url")
}

async function savedSession(request: Request, options: ConnectionOptions): Promise<Session | undefined> {
  const name = cookieName(options)
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1)
  if (!cookie || cookie.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(cookie)) return undefined
  try {
    const bytes = Buffer.from(cookie, "base64url")
    if (bytes.length < 29) return undefined
    const cipher = createDecipheriv("aes-256-gcm", await key(options), bytes.subarray(0, 12))
    cipher.setAAD(Buffer.from(name))
    cipher.setAuthTag(bytes.subarray(12, 28))
    const value: unknown = JSON.parse(
      Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString("utf8"),
    )
    if (
      !record(value) ||
      typeof value.url !== "string" ||
      typeof value.username !== "string" ||
      typeof value.password !== "string" ||
      typeof value.actorId !== "string" ||
      typeof value.expiresAt !== "number" ||
      value.expiresAt <= Date.now()
    )
      return undefined
    backendUrl(value.url)
    return value as Session
  } catch {
    return undefined
  }
}

function publicConnection(session: Session) {
  return { connected: true, url: session.url, username: session.username, actorId: session.actorId }
}

function cookie(request: Request, token: string, options: ConnectionOptions, clear = false) {
  return `${cookieName(options)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : lifetime}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`
}

async function upstream(
  session: Pick<Session, "url" | "username" | "password">,
  path: string,
  method: string,
  body: unknown,
  options: ConnectionOptions,
  signal: AbortSignal,
) {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 10_000)
  try {
    const response = await fetch(`${session.url}${prefix}${path}`, {
      method,
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.any([signal, timeout]),
      headers: {
        Authorization: `Basic ${Buffer.from(`${session.username}:${session.password}`, "utf8").toString("base64")}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await boundedText(response.body, 4 * 1024 * 1024)
    const headers = new Headers({
      "Cache-Control": "no-store",
      "Content-Type": response.headers.get("content-type") ?? "application/json",
    })
    for (const name of ["www-authenticate", "retry-after"]) {
      const value = response.headers.get(name)
      if (value) headers.set(name, value)
    }
    return new Response([204, 304].includes(response.status) ? null : text, { status: response.status, headers })
  } catch (error) {
    if (error instanceof ConnectionFailure) throw error
    if (timeout.aborted) throw new ConnectionFailure(504, "Backend request timed out")
    if (signal.aborted) throw new ConnectionFailure(499, "Request cancelled")
    throw new ConnectionFailure(502, "Backend is unavailable")
  }
}

async function validatedSession(value: unknown, request: Request, options: ConnectionOptions) {
  if (
    !record(value) ||
    typeof value.username !== "string" ||
    !value.username ||
    value.username.length > 200 ||
    /[:\r\n]/.test(value.username) ||
    typeof value.password !== "string" ||
    !value.password ||
    value.password.length > 4096
  )
    throw new ConnectionFailure(400, "Member username and password are required")
  const credentials = { url: backendUrl(value.url), username: value.username, password: value.password }
  const identity = await upstream(credentials, "/me", "GET", undefined, options, request.signal)
  if (!identity.ok) throw new ConnectionFailure(identity.status, "Member authentication failed", identity)
  const actor: unknown = await identity.json().catch(() => undefined)
  if (
    !record(actor) ||
    typeof actor.userId !== "string" ||
    !actor.userId ||
    (actor.kind !== undefined && actor.kind !== "member")
  )
    throw new ConnectionFailure(502, "Backend did not return a valid member identity")
  const response = await upstream(credentials, "/projects", "GET", undefined, options, request.signal)
  if (!response.ok) throw new ConnectionFailure(response.status, "Project access failed", response)
  const projects: unknown = await response.json().catch(() => undefined)
  if (
    !Array.isArray(projects) ||
    !projects.every(
      (project) =>
        record(project) &&
        typeof project.id === "string" &&
        project.id &&
        typeof project.name === "string" &&
        typeof project.createdBy === "string",
    )
  )
    throw new ConnectionFailure(502, "Backend returned invalid projects")
  return { ...credentials, actorId: actor.userId, expiresAt: Date.now() + lifetime * 1000 }
}

export async function connectionResponse(request: Request, options: ConnectionOptions = {}): Promise<Response> {
  try {
    sameOrigin(request, options)
    if (request.method === "DELETE")
      return Response.json(
        { connected: false },
        { headers: { "Set-Cookie": cookie(request, "", options, true), "Cache-Control": "no-store" } },
      )
    if (request.method === "GET") {
      const session = await savedSession(request, options)
      if (session) return Response.json(publicConnection(session), { headers: { "Cache-Control": "no-store" } })
      // Every browser must authenticate separately, including tunneled teammates.
      const url = process.env.PUFF_API_URL ? backendUrl(process.env.PUFF_API_URL) : undefined
      return Response.json({ connected: false, ...(url ? { url } : {}) }, { headers: { "Cache-Control": "no-store" } })
    }
    if (request.method !== "POST") throw new ConnectionFailure(405, "Method not allowed")
    const session = await validatedSession(await jsonBody(request, options), request, options)
    return Response.json(publicConnection(session), {
      headers: {
        "Set-Cookie": cookie(request, await encrypted(session, options), options),
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    return failure(error)
  }
}

function permittedPath(request: Request) {
  const url = new URL(request.url)
  if (!url.pathname.startsWith("/api/coordination/") || /[%\\]/.test(url.pathname))
    throw new ConnectionFailure(400, "Invalid coordination path")
  const path = url.pathname.slice("/api/coordination".length)
  const id = "[A-Za-z0-9_-]+"
  const rules: [RegExp, readonly string[]][] = [
    [/^\/(?:me|status|provisioning)$/, ["GET"]],
    [/^\/projects$/, ["GET", "POST"]],
    [new RegExp(`^/projects/${id}$`), ["GET"]],
    [new RegExp(`^/projects/${id}/brief$`), ["GET", "PUT"]],
    [new RegExp(`^/projects/${id}/focus$`), ["GET"]],
    [new RegExp(`^/projects/${id}/focus/me$`), ["PUT"]],
    [new RegExp(`^/projects/${id}/members$`), ["POST"]],
    [new RegExp(`^/projects/${id}/(?:contributions|activity|work-cards|events)$`), ["GET"]],
    [new RegExp(`^/projects/${id}/threads$`), ["GET", "POST"]],
    [new RegExp(`^/projects/${id}/sessions$`), ["POST"]],
    [new RegExp(`^/projects/${id}/flower/export$`), ["POST"]],
    [new RegExp(`^/threads/${id}$`), ["GET"]],
    [new RegExp(`^/threads/${id}/cooperation$`), ["GET", "PUT"]],
    [new RegExp(`^/threads/${id}/comments$`), ["GET", "POST"]],
    [new RegExp(`^/threads/${id}/instructions$`), ["POST"]],
    [new RegExp(`^/threads/${id}/instructions/${id}/cancel$`), ["POST"]],
    [new RegExp(`^/threads/${id}/approvals/${id}/(?:claim|decision)$`), ["POST"]],
    [new RegExp(`^/threads/${id}/(?:events|work-card)$`), ["GET"]],
  ]
  const methods = rules.find(([pattern]) => pattern.test(path))?.[1]
  if (!methods) throw new ConnectionFailure(400, "Coordination path is not available")
  if (!methods.includes(request.method)) throw new ConnectionFailure(405, "Method not allowed")
  const seen = new Set<string>()
  for (const [name, value] of url.searchParams) {
    if (seen.has(name)) throw new ConnectionFailure(400, "Duplicate query parameter")
    seen.add(name)
    if (
      path.endsWith("/events") &&
      ["after", "limit"].includes(name) &&
      /^\d+$/.test(value) &&
      Number.isSafeInteger(Number(value)) &&
      (name !== "limit" || (Number(value) > 0 && Number(value) <= 200))
    )
      continue
    if (path.endsWith("/contributions") && name === "userId" && /^[A-Za-z0-9_-]+$/.test(value)) continue
    throw new ConnectionFailure(400, "Invalid coordination query")
  }
  return path + url.search
}

export async function proxyCoordination(request: Request, options: ConnectionOptions = {}): Promise<Response> {
  try {
    sameOrigin(request, options)
    const path = permittedPath(request)
    const session = await savedSession(request, options)
    if (!session) throw new ConnectionFailure(401, "Connect to the backend first")
    const expectedActorId = request.headers.get("x-puff-actor")
    if ((request.method !== "GET" || expectedActorId !== null) && expectedActorId !== session.actorId)
      throw new ConnectionFailure(409, "Member identity changed or is missing; reconnect before sending this request")
    const body = request.method === "GET" ? undefined : await jsonBody(request, options)
    return await upstream(session, path, request.method, body, options, request.signal)
  } catch (error) {
    return failure(error)
  }
}
