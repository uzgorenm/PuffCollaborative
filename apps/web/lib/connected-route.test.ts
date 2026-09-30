import { test } from "node:test"
import assert from "node:assert/strict"
import { handleLive } from "./connected.ts"

test("connected preview guards every request before configuration and cannot borrow root credentials", async context => {
  const names = ["PUFF_BACKEND_MEMBER_PATH", "PUFF_BACKEND_URL", "PUFF_WEB_ORIGIN", "PUFF_API_URL", "PUFF_MEMBER_USERNAME", "PUFF_MEMBER_PASSWORD"]
  const previous = names.map(name => process.env[name])
  context.after(() => names.forEach((name, index) => {
    if (previous[index] === undefined) delete process.env[name]
    else process.env[name] = previous[index]
  }))
  delete process.env.PUFF_BACKEND_MEMBER_PATH
  delete process.env.PUFF_BACKEND_URL
  process.env.PUFF_WEB_ORIGIN = "http://127.0.0.1:3006"
  process.env.PUFF_API_URL = "http://127.0.0.1:4187"
  process.env.PUFF_MEMBER_USERNAME = "root-member"
  process.env.PUFF_MEMBER_PASSWORD = "test-only-root-password"
  const upstream = context.mock.method(globalThis, "fetch", async () => { throw new Error("No upstream request is permitted") })
  const allowed = await handleLive(new Request("http://localhost:3006/api/live/workspace", { headers: { Host: "127.0.0.1:3006" } }), ["workspace"])
  assert.equal(allowed.status, 503)
  assert.deepEqual(await allowed.json(), { error: "Connect the coordination backend to open your project." })
  const hostileHeaders: Record<string, string>[] = [
    { Host: "rebind.example:3006", Origin: "http://rebind.example:3006" },
    { Host: "127.0.0.1:3006", Origin: "https://outside.example" },
    { Host: "127.0.0.1:3006", "Sec-Fetch-Site": "cross-site" },
  ]
  for (const method of ["GET", "POST"]) {
    for (const headers of hostileHeaders) {
      const response = await handleLive(new Request("http://localhost:3006/api/live/workspace", { method, headers: { ...headers, "Content-Type": "application/json" }, body: method === "POST" ? "{}" : undefined }), ["workspace"])
      assert.equal(response.status, 403, `${method}: ${JSON.stringify(headers)}`)
    }
  }
  const missingOrigin = await handleLive(new Request("http://localhost:3006/api/live/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), ["workspace"])
  assert.equal(missingOrigin.status, 403)
  const malformedMediaType = await handleLive(new Request("http://localhost:3006/api/live/workspace", { method: "POST", headers: { Origin: process.env.PUFF_WEB_ORIGIN, "Content-Type": "application/json-anything" }, body: "{}" }), ["workspace"])
  assert.equal(malformedMediaType.status, 403)
  const allowedPost = await handleLive(new Request("http://localhost:3006/api/live/workspace", { method: "POST", headers: { Origin: process.env.PUFF_WEB_ORIGIN, "Content-Type": "Application/JSON; charset=utf-8" }, body: "{}" }), ["workspace"])
  assert.equal(allowedPost.status, 503)
  assert.equal(upstream.mock.callCount(), 0)
})
