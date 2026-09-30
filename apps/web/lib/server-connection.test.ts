import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { connectionResponse, proxyCoordination, type ConnectionOptions } from "./server-connection.ts"

const secret = "test-only-secret-with-at-least-thirty-two-characters"
const frontend = "http://127.0.0.1:3010"
const projects = [{ id: "project-a", name: "Navigation", createdBy: "usr_alice", createdAt: "2026-09-29T20:00:00.000Z" }]

async function backend(handler?: (request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse) => void) {
  const server = createServer((request, response) => {
    if (handler) return handler(request, response)
    if (request.headers.authorization !== "Basic YWxpY2U6cHJpdmF0ZS1wYXNzd29yZA==") { response.writeHead(401); response.end('{"message":"Credentials required"}'); return }
    response.setHeader("Content-Type", "application/json")
    response.end(JSON.stringify(request.url?.endsWith("/me") ? { userId: "usr_alice", kind: "member" } : projects))
  })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert(address && typeof address === "object")
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }) }
}

function request(path: string, method = "GET", body?: unknown, cookie?: string) {
  return new Request(`${frontend}${path}`, { method, headers: { Origin: frontend, ...(method === "GET" ? {} : { "X-Puff-Actor": "usr_alice" }), ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
}

async function connect(url: string, options: ConnectionOptions = { secret }) {
  const response = await connectionResponse(request("/api/connection", "POST", { url, username: "alice", password: "private-password" }), options)
  assert.equal(response.status, 200)
  const cookie = response.headers.get("set-cookie")
  assert(cookie)
  return { response, cookie: cookie.split(";")[0] }
}

test("connection validates a member and encrypts credentials in a strict HttpOnly cookie", async () => {
  const service = await backend()
  try {
    const result = await connect(service.url)
    assert.deepEqual(await result.response.json(), { connected: true, url: service.url, username: "alice", actorId: "usr_alice" })
    assert.match(result.response.headers.get("set-cookie")!, /HttpOnly/)
    assert.match(result.response.headers.get("set-cookie")!, /SameSite=Strict/)
    assert(!result.cookie.includes("private-password"))
    assert(!Buffer.from(result.cookie.split("=")[1], "base64url").toString().includes("private-password"))
    const status = await connectionResponse(request("/api/connection", "GET", undefined, result.cookie), { secret })
    assert.equal((await status.json()).actorId, "usr_alice")
    const mutated = result.cookie.slice(0, -4) + "abcd"
    assert.deepEqual(await (await connectionResponse(request("/api/connection", "GET", undefined, mutated), { secret })).json(), { connected: false })
    const logout = await connectionResponse(request("/api/connection", "DELETE", undefined, result.cookie), { secret })
    assert.match(logout.headers.get("set-cookie")!, /Max-Age=0/)
  } finally { await service.close() }
})

test("connection rejects nonloopback URLs, invalid member identity, and backend auth failure", async () => {
  for (const url of ["https://example.com", "http://127.0.0.1.evil.test", "file:///etc/passwd", "http://user:password@localhost:4096", "http://localhost:4096/?token=x", "http://localhost:4096/other"]) {
    const response = await connectionResponse(request("/api/connection", "POST", { url, username: "alice", password: "private-password" }), { secret })
    assert.equal(response.status, 400, url)
  }
  const unavailable = await backend((_request, response) => { response.writeHead(401); response.end('{"message":"Invalid member"}') })
  const runner = await backend((_request, response) => response.end('{"kind":"runner","workerId":"wrk_1"}'))
  try {
    const denied = await connectionResponse(request("/api/connection", "POST", { url: unavailable.url, username: "alice", password: "private-password" }), { secret })
    assert.equal(denied.status, 401)
    assert.deepEqual(await denied.json(), { message: "Invalid member" })
    assert.equal(denied.headers.get("set-cookie"), null)
    const invalid = await connectionResponse(request("/api/connection", "POST", { url: runner.url, username: "alice", password: "private-password" }), { secret })
    assert.equal(invalid.status, 502)
  } finally { await unavailable.close(); await runner.close() }
})

test("proxy forwards allowlisted paths with member auth and preserves conflict status/body", async () => {
  let observed = ""
  const service = await backend((req, res) => {
    res.setHeader("Content-Type", "application/json")
    if (req.url?.endsWith("/me")) { res.end('{"kind":"member","userId":"usr_alice"}'); return }
    if (req.url?.endsWith("/projects")) { res.end(JSON.stringify(projects)); return }
    observed = `${req.method} ${req.url} ${req.headers.authorization}`
    res.writeHead(409); res.end('{"code":"conflict","message":"Revision changed"}')
  })
  try {
    const { cookie } = await connect(service.url)
    const result = await proxyCoordination(request("/api/coordination/projects/project-a/brief", "PUT", { requestId: "stable-1", expectedVersion: 2 }, cookie), { secret })
    assert.equal(result.status, 409)
    assert.deepEqual(await result.json(), { code: "conflict", message: "Revision changed" })
    assert.equal(observed, "PUT /api/coordination/v1/projects/project-a/brief Basic YWxpY2U6cHJpdmF0ZS1wYXNzd29yZA==")
    const noCookie = await proxyCoordination(request("/api/coordination/projects"), { secret })
    assert.equal(noCookie.status, 401)
    for (const path of ["/api/coordination/runner/threads/a/reserve", "/api/coordination/projects/a%2F..%2Fstatus", "/api/coordination/projects/a%252fstatus", "/api/coordination/projects/a/unknown", "/api/coordination/projects/a/events?after=0&secret=x"]) {
      assert.equal((await proxyCoordination(request(path, "GET", undefined, cookie), { secret })).status, 400, path)
    }
    assert.equal((await proxyCoordination(request("/api/coordination/projects/project-a", "DELETE", undefined, cookie), { secret })).status, 405)
    const foreign = new Request(`${frontend}/api/coordination/projects`, { method: "POST", headers: { Origin: "https://evil.test", Cookie: cookie, "Content-Type": "application/json" }, body: "{}" })
    assert.equal((await proxyCoordination(foreign, { secret })).status, 403)
    const large = await proxyCoordination(request("/api/coordination/projects", "POST", { text: "x".repeat(100) }, cookie), { secret, maxBodyBytes: 50 })
    assert.equal(large.status, 413)
  } finally { await service.close() }
})

test("proxy bounds offline/timeout failures without exposing credentials", async () => {
  const service = await backend((req, res) => {
    if (req.url?.endsWith("/me")) { res.end('{"kind":"member","userId":"usr_alice"}'); return }
    if (req.url?.endsWith("/projects")) { res.end(JSON.stringify(projects)); return }
  })
  try {
    const { cookie } = await connect(service.url)
    const timed = await proxyCoordination(request("/api/coordination/projects/project-a", "GET", undefined, cookie), { secret, timeoutMs: 25 })
    assert.equal(timed.status, 504)
    assert(!(await timed.text()).includes("private-password"))
    await service.close()
    const offline = await proxyCoordination(request("/api/coordination/projects/project-a", "GET", undefined, cookie), { secret })
    assert.equal(offline.status, 502)
  } finally { await service.close() }
})

test("runtime key survives restart and is stored with owner-only permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "puff-cookie-test-"))
  const service = await backend()
  try {
    const { cookie } = await connect(service.url, { runtimeDir: directory })
    const persisted = await readFile(join(directory, "connection.key"))
    assert.equal(persisted.length, 32)
    assert.equal((await stat(join(directory, "connection.key"))).mode & 0o777, 0o600)
    const reloaded = await connectionResponse(request("/api/connection", "GET", undefined, cookie), { runtimeDir: directory })
    assert.equal((await reloaded.json()).connected, true)
  } finally { await service.close(); await rm(directory, { recursive: true, force: true }) }
})

test("configured launcher connection validates identity without exposing its password", async () => {
  const service = await backend()
  const saved = [process.env.PUFF_API_URL, process.env.PUFF_MEMBER_USERNAME, process.env.PUFF_MEMBER_PASSWORD]
  try {
    process.env.PUFF_API_URL = service.url
    process.env.PUFF_MEMBER_USERNAME = "alice"
    process.env.PUFF_MEMBER_PASSWORD = "private-password"
    const response = await connectionResponse(request("/api/connection"), { secret })
    assert.equal(response.status, 200)
    const publicState = await response.text()
    assert.equal(JSON.parse(publicState).actorId, "usr_alice")
    assert(!publicState.includes("private-password"))
    assert.match(response.headers.get("set-cookie")!, /HttpOnly/)
  } finally {
    for (const [index, name] of ["PUFF_API_URL", "PUFF_MEMBER_USERNAME", "PUFF_MEMBER_PASSWORD"].entries()) {
      if (saved[index] === undefined) delete process.env[name]
      else process.env[name] = saved[index]
    }
    await service.close()
  }
})

test("member proxy admits only the agreed cooperation controls and Flower export method", async () => {
  const service = await backend((req, res) => {
    if (req.url?.endsWith("/me")) { res.end('{"userId":"usr_alice"}'); return }
    if (req.url?.endsWith("/projects")) { res.end(JSON.stringify(projects)); return }
    res.end(JSON.stringify({ path: req.url, method: req.method }))
  })
  try {
    const { cookie } = await connect(service.url)
    for (const [path, method, body] of [
      ["/api/coordination/threads/thread-a/cooperation", "GET", undefined],
      ["/api/coordination/threads/thread-a/cooperation", "PUT", { requestId: "consent-1", expectedVersion: 0, featureTopic: "navigation", relationship: "alternative", analysisEnabled: true, awarenessMode: "notify" }],
      ["/api/coordination/projects/project-a/flower/export", "POST", { requestId: "export-1", sourceThreadId: "thread-a", targetThreadId: "thread-b" }],
    ] as const) {
      const response = await proxyCoordination(request(path, method, body, cookie), { secret })
      assert.equal(response.status, 200, `${method} ${path}`)
      assert.equal((await response.json()).method, method)
    }
    assert.equal((await proxyCoordination(request("/api/coordination/projects/project-a/flower/export", "GET", undefined, cookie), { secret })).status, 405)
    assert.equal((await proxyCoordination(request("/api/coordination/projects/project-a/flower/runner", "POST", {}, cookie), { secret })).status, 400)
  } finally { await service.close() }
})

test("origin validation accepts the incoming loopback host after Next rewrites its URL, while rejecting foreign origins", async () => {
  const service = await backend()
  try {
    const { cookie } = await connect(service.url)
    const rewritten = (origin: string, host = "127.0.0.1:3010", site = "same-origin") => new Request("http://localhost:3010/api/coordination/projects/project-a/brief", {
      method: "PUT", headers: { Origin: origin, Host: host, "Sec-Fetch-Site": site, Cookie: cookie, "Content-Type": "application/json", "X-Puff-Actor": "usr_alice" }, body: "{}",
    })
    assert.equal((await proxyCoordination(rewritten(frontend), { secret })).status, 200)
    assert.equal((await proxyCoordination(rewritten("https://evil.test"), { secret })).status, 403)
    assert.equal((await proxyCoordination(rewritten("http://127.0.0.1:3011"), { secret })).status, 403)
    assert.equal((await proxyCoordination(rewritten("http://evil.test:3010", "evil.test:3010"), { secret })).status, 403)
    assert.equal((await proxyCoordination(rewritten(frontend, "127.0.0.1:3010", "cross-site"), { secret })).status, 403)
    assert.equal((await connectionResponse(new Request("http://localhost:3010/api/connection", { method: "DELETE", headers: { Origin: frontend, Host: "127.0.0.1:3010" } }), { secret })).status, 200)
    assert.equal((await proxyCoordination(rewritten(frontend), { secret, webOrigin: frontend })).status, 200)
    assert.equal((await proxyCoordination(rewritten("http://localhost:3010"), { secret, webOrigin: frontend })).status, 403)
    assert.equal((await proxyCoordination(rewritten(frontend), { secret, webOrigin: "http://evil.test:3010" })).status, 500)
  } finally { await service.close() }
})

test("mutations reject missing identity or a cookie switched to another member before forwarding", async () => {
  let mutations = 0
  const service = await backend((req, res) => {
    if (req.url?.endsWith("/me")) { res.end(JSON.stringify({ userId: req.headers.authorization === "Basic YWxpY2U6cHJpdmF0ZS1wYXNzd29yZA==" ? "usr_alice" : "usr_bob" })); return }
    if (req.url?.endsWith("/projects")) { res.end(JSON.stringify(projects)); return }
    mutations += 1
    res.end('{"accepted":true}')
  })
  try {
    const switched = await connectionResponse(request("/api/connection", "POST", { url: service.url, username: "bob", password: "private-password" }), { secret })
    const cookie = switched.headers.get("set-cookie")!.split(";")[0]
    const oldAction = request("/api/coordination/threads/thread-a/instructions", "POST", { requestId: "stable-1", text: "Owned by Alice" }, cookie)
    assert.equal((await proxyCoordination(oldAction, { secret })).status, 409)
    const missingActor = request("/api/coordination/threads/thread-a/instructions", "POST", { text: "Missing actor" }, cookie)
    missingActor.headers.delete("x-puff-actor")
    assert.equal((await proxyCoordination(missingActor, { secret })).status, 409)
    assert.equal(mutations, 0)
    const currentAction = request("/api/coordination/threads/thread-a/instructions", "POST", { text: "Current member" }, cookie)
    currentAction.headers.set("x-puff-actor", "usr_bob")
    assert.equal((await proxyCoordination(currentAction, { secret })).status, 200)
    assert.equal(mutations, 1)
  } finally { await service.close() }
})

test("runtime-scoped cookies coexist on one host and cannot be renamed or reused across scopes", async () => {
  const originalScope = process.env.PUFF_CONNECTION_SCOPE
  const first = await backend()
  const second = await backend()
  const one = { secret, connectionScope: "runtime-one" }
  const two = { secret, connectionScope: "runtime-two" }
  try {
    const a = await connect(first.url, one)
    const b = await connect(second.url, two)
    const nameA = a.cookie.split("=")[0], nameB = b.cookie.split("=")[0]
    assert.notEqual(nameA, nameB)
    assert.match(nameA, /^puff_connection_[a-f0-9]{24}$/)
    assert.deepEqual(await (await connectionResponse(request("/api/connection", "GET", undefined, a.cookie), two)).json(), { connected: false })
    const renamed = `${nameB}=${a.cookie.slice(a.cookie.indexOf("=") + 1)}`
    assert.deepEqual(await (await connectionResponse(request("/api/connection", "GET", undefined, renamed), two)).json(), { connected: false })
    const combined = `${a.cookie}; ${b.cookie}`
    assert.equal((await (await connectionResponse(request("/api/connection", "GET", undefined, combined), one)).json()).url, first.url)
    assert.equal((await (await connectionResponse(request("/api/connection", "GET", undefined, combined), two)).json()).url, second.url)
    assert.match((await connectionResponse(request("/api/connection", "DELETE", undefined, combined), one)).headers.get("set-cookie")!, new RegExp(`^${nameA}=`))
    process.env.PUFF_CONNECTION_SCOPE = "runtime-one"
    assert.equal((await (await connectionResponse(request("/api/connection", "GET", undefined, combined), { secret })).json()).url, first.url)
    process.env.PUFF_CONNECTION_SCOPE = "runtime-two"
    assert.deepEqual(await (await connectionResponse(request("/api/connection", "GET", undefined, a.cookie), { secret })).json(), { connected: false })
    assert.equal((await (await connectionResponse(request("/api/connection", "GET", undefined, combined), { secret })).json()).url, second.url)
  } finally {
    if (originalScope === undefined) delete process.env.PUFF_CONNECTION_SCOPE
    else process.env.PUFF_CONNECTION_SCOPE = originalScope
    await first.close(); await second.close()
  }
})
