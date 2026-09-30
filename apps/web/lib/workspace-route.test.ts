import assert from "node:assert/strict"
import test from "node:test"
import { GET, POST } from "../app/api/workspace/route.ts"
import { parseWorkspaceRequest, WorkspaceApiError, workspaceRequestLimit } from "./session-service.ts"

test("POST reports malformed JSON and malformed commands as JSON errors", async () => {
  for (const body of ["invalid json", "null", JSON.stringify({ command: "bootstrap", workspaceId: "../private" }), JSON.stringify({ command: "wrong" })]) {
    const response = await POST(new Request("http://localhost/api/workspace", { method: "POST", body }))
    assert.equal(response.status, 400)
    assert.equal(typeof (await response.json()).error, "string")
  }
})

test("POST reports an unknown UUID without creating a workspace", async () => {
  const response = await POST(new Request("http://localhost/api/workspace", { method: "POST", body: JSON.stringify({ command: "bootstrap", workspaceId: "00000000-0000-4000-8000-000000000000" }) }))
  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), { error: "Workspace not found" })
})

test("request parsing caps bodies even without Content-Length", async () => {
  const body = JSON.stringify({ command: "bootstrap", value: "x".repeat(workspaceRequestLimit) })
  const response = await POST(new Request("http://localhost/api/workspace", { method: "POST", body }))
  assert.equal(response.status, 400)
  assert.match((await response.json()).error, /256 KiB/)
  await assert.rejects(parseWorkspaceRequest(new Request("http://localhost/api/workspace", { method: "POST", headers: { "content-length": String(workspaceRequestLimit + 1) }, body: "{}" })), (error: unknown) => error instanceof WorkspaceApiError && error.status === 400)
})

test("health catalog identifies the local service and selectable models", async () => {
  const response = await GET()
  assert.equal(response.status, 200)
  const catalog = await response.json()
  assert.equal(catalog.localDemo, true)
  assert.deepEqual(catalog.models.map((entry: { id: string }) => entry.id), ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna"])
})
