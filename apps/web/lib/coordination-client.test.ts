import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { createCoordinationClient, CoordinationError } from "./coordination-client.ts"

async function service() {
  const requests: { url?: string; method?: string; body: string; cookie?: string; expectedActor?: string }[] = []
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks).toString()
    requests.push({ url: req.url, method: req.method, body, cookie: req.headers.cookie, expectedActor: req.headers["x-puff-actor"] as string | undefined })
    res.setHeader("Content-Type", "application/json")
    if (req.url === "/api/connection") { res.end(JSON.stringify({ connected: req.method !== "DELETE", url: "http://127.0.0.1:4096", username: "alice", actorId: "usr_alice" })); return }
    if (req.url?.includes("conflict")) { res.writeHead(409); res.end('{"code":"conflict","message":"Version changed"}'); return }
    if (req.url?.includes("malformed")) { res.end("oops"); return }
    if (req.url?.includes("slow")) return
    res.end(JSON.stringify({ requestId: JSON.parse(body || "{}").requestId ?? null, ok: true }))
  })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert(address && typeof address === "object")
  const origin = `http://127.0.0.1:${address.port}`
  const client = createCoordinationClient((url, init) => fetch(origin + url, init))
  return { client, requests, close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }) }
}

test("browser client uses only same-origin proxy and retains stable mutation identity", async () => {
  const server = await service()
  try {
    assert.equal((await server.client.connectToBackend({ url: "http://127.0.0.1:4096", username: "alice", password: "temporary" })).actorId, "usr_alice")
    assert.equal((await server.client.readConnection()).connected, true)
    for (let index = 0; index < 2; index++) {
      assert.deepEqual(await server.client.coordinationRequest("/threads/thread-a/instructions", { method: "POST", expectedActorId: "usr_alice", body: { requestId: "stable-1", text: "Check focus" } }), { requestId: "stable-1", ok: true })
    }
    assert.deepEqual(server.requests.slice(2).map(req => [req.url, req.method, JSON.parse(req.body).requestId]), [["/api/coordination/threads/thread-a/instructions", "POST", "stable-1"], ["/api/coordination/threads/thread-a/instructions", "POST", "stable-1"]])
    assert(server.requests.slice(2).every(req => req.expectedActor === "usr_alice"))
    await server.client.disconnectBackend()
    assert.equal(server.requests.at(-1)?.method, "DELETE")
    const count = server.requests.length
    for (const path of ["https://example.com/projects", "//evil.test", "/projects/../status", "/projects/a%2Fstatus", "/projects/a\\status"]) {
      await assert.rejects(server.client.coordinationRequest(path), CoordinationError)
    }
    assert.equal(server.requests.length, count)
    await assert.rejects(server.client.coordinationRequest("/threads/thread-a/instructions", { method: "POST", body: { text: "No actor" } }), (error: unknown) => error instanceof CoordinationError && error.status === 400)
    assert.equal(server.requests.length, count)
  } finally { await server.close() }
})

test("browser client preserves backend error details and rejects invalid response JSON", async () => {
  const server = await service()
  try {
    await assert.rejects(server.client.coordinationRequest("/threads/conflict"), (error: unknown) => error instanceof CoordinationError && error.status === 409 && error.message === "Version changed" && (error.details as { code: string }).code === "conflict")
    await assert.rejects(server.client.coordinationRequest("/threads/malformed"), (error: unknown) => error instanceof CoordinationError && error.status === 502)
    const controller = new AbortController()
    const pending = server.client.coordinationRequest("/threads/slow", { signal: controller.signal })
    controller.abort()
    await assert.rejects(pending, (error: unknown) => error instanceof Error && error.name === "AbortError")
  } finally { await server.close() }
})
