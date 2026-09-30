import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import test from "node:test"
import { WorkspaceApiError, WorkspaceService } from "./session-service.ts"
import { createDemoWorkspace } from "./workspace.ts"

async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const directory = await mkdtemp(join(tmpdir(), "puff-workspace-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return { directory, service: new WorkspaceService({ directory }) }
}

const task = { prompt: "Draft release notes", owner: "You", scope: "project", modelId: "gpt-6.1-sol" }
const rejected = (status: number) => (error: unknown) => error instanceof WorkspaceApiError && error.status === status

test("bootstrap persists a workspace and a new service reloads later mutations", async (t) => {
  const { directory, service } = await setup(t)
  const initial = await service.execute({ command: "bootstrap" })
  assert.match(initial.workspaceId, /^[0-9a-f-]{36}$/)
  const created = await service.execute({ command: "create", workspaceId: initial.workspaceId, ...task })
  assert.ok(created.sessionId)
  const reloaded = await new WorkspaceService({ directory }).execute({ command: "bootstrap", workspaceId: initial.workspaceId })
  assert.deepEqual(reloaded, { workspaceId: initial.workspaceId, workspace: created.workspace })
  assert.deepEqual(JSON.parse(await readFile(join(directory, `${initial.workspaceId}.json`), "utf8")), created.workspace)
})

test("parallel service instances serialize mutations without losing created sessions", async (t) => {
  const { directory, service } = await setup(t)
  const initial = await service.execute({ command: "bootstrap" })
  const second = new WorkspaceService({ directory })
  const replies = await Promise.all(Array.from({ length: 18 }, (_, index) => (index % 2 ? service : second).execute({ command: "create", workspaceId: initial.workspaceId, ...task, prompt: `Draft release note ${index}` })))
  const saved = await service.execute({ command: "bootstrap", workspaceId: initial.workspaceId })
  assert.equal(saved.workspace.sessions.length, initial.workspace.sessions.length + replies.length)
  assert.equal(new Set(replies.map((reply) => reply.sessionId)).size, replies.length)
  assert.ok(replies.every((reply) => saved.workspace.sessions.some((session) => session.id === reply.sessionId)))
})

test("bootstrap imports a validated browser snapshot only when creating a new workspace", async (t) => {
  const { service } = await setup(t)
  const workspace = createDemoWorkspace("Imported project", "Keep browser work")
  const initial = await service.execute({ command: "bootstrap", initialWorkspace: workspace })
  assert.deepEqual(initial.workspace, workspace)
  await assert.rejects(service.execute({ command: "bootstrap", workspaceId: initial.workspaceId, initialWorkspace: createDemoWorkspace() }), rejected(400))
  const updated = { ...workspace, project: { ...workspace.project, name: "Changed name" } }
  await service.execute({ command: "replace", workspaceId: initial.workspaceId, workspace: updated })
  assert.deepEqual((await service.execute({ command: "bootstrap", workspaceId: initial.workspaceId })).workspace, updated)
})

test("malformed commands, invalid models, paths and ownership do not mutate saved data", async (t) => {
  const { service } = await setup(t)
  const initial = await service.execute({ command: "bootstrap" })
  for (const body of [null, [], {}, { command: "unknown" }, { command: "bootstrap", workspaceId: "../secret" }, { command: "bootstrap", extra: true }, { command: "create", workspaceId: initial.workspaceId, ...task, modelId: "other" }, { command: "create", workspaceId: initial.workspaceId, ...task, owner: "Unknown" }, { command: "create", workspaceId: initial.workspaceId, ...task, owner: "Sam", scope: "private" }, { command: "message", workspaceId: initial.workspaceId, sessionId: initial.workspace.sessions[0].id, prompt: "", modelId: task.modelId }]) {
    await assert.rejects(service.execute(body), rejected(400))
  }
  assert.deepEqual((await service.execute({ command: "bootstrap", workspaceId: initial.workspaceId })).workspace, initial.workspace)
  await assert.rejects(service.execute({ command: "bootstrap", workspaceId: "00000000-0000-4000-8000-000000000000" }), rejected(404))
})

test("snapshot validation rejects malformed sessions and private teammate content", async (t) => {
  const { service } = await setup(t)
  for (const change of [
    (workspace: ReturnType<typeof createDemoWorkspace>) => { workspace.sessions[0].messages[0].role = "tool" as never },
    (workspace: ReturnType<typeof createDemoWorkspace>) => { workspace.sessions[0].scope = "private"; workspace.sessions[0].owner = "Sam" },
    (workspace: ReturnType<typeof createDemoWorkspace>) => { workspace.sessions.push(workspace.sessions[0]) },
    (workspace: ReturnType<typeof createDemoWorkspace>) => { workspace.sessions[0].receivedFindings = ["missing:unknown"] },
  ]) {
    const workspace = createDemoWorkspace()
    change(workspace)
    await assert.rejects(service.execute({ command: "bootstrap", initialWorkspace: workspace }), rejected(400))
  }
})

test("guided creation validates recomputed choices and source references", async (t) => {
  const { service } = await setup(t)
  const initial = await service.execute({ command: "bootstrap" })
  const request = { ...task, prompt: "Build frontend navigation" }
  const analyzed = await service.execute({ command: "analyze", workspaceId: initial.workspaceId, ...request })
  const choice = analyzed.analysis!.options.find((option) => option.action === "create" && option.sourceSessionId)!
  assert.ok(choice)
  await assert.rejects(service.execute({ command: "create", workspaceId: initial.workspaceId, ...request, choiceId: "invented" }), rejected(400))
  await assert.rejects(service.execute({ command: "create", workspaceId: initial.workspaceId, ...request, choiceId: choice.id, sourceSessionId: "missing" }), rejected(404))
  const created = await service.execute({ command: "create", workspaceId: initial.workspaceId, ...request, choiceId: choice.id, sourceSessionId: choice.sourceSessionId })
  assert.equal(created.workspace.sessions.find((session) => session.id === created.sessionId)?.relatedSessionId, choice.sourceSessionId)
  const source = created.workspace.sessions.find((session) => session.id === choice.sourceSessionId)!
  source.task = "An unrelated replacement task"
  await service.execute({ command: "replace", workspaceId: initial.workspaceId, workspace: created.workspace })
  await assert.rejects(service.execute({ command: "create", workspaceId: initial.workspaceId, ...request, choiceId: choice.id, sourceSessionId: choice.sourceSessionId }), rejected(400))
})

test("overlapping work requires a scope choice and leaves the workspace untouched", async (t) => {
  const { service } = await setup(t)
  const initial = await service.execute({ command: "bootstrap" })
  await assert.rejects(service.execute({ command: "create", workspaceId: initial.workspaceId, ...task, prompt: "Build frontend navigation" }), (error: unknown) => error instanceof WorkspaceApiError && error.status === 400 && /Choose a task boundary/.test(error.message))
  assert.deepEqual((await service.execute({ command: "bootstrap", workspaceId: initial.workspaceId })).workspace, initial.workspace)
})

test("messages and repeated finding application persist one attributed context", async (t) => {
  const { service } = await setup(t)
  const initial = await service.execute({ command: "bootstrap" })
  const targetId = initial.workspace.sessions[0].id
  const body = { command: "add-context", workspaceId: initial.workspaceId, targetId, sourceSessionId: "demo-alice-server", findingId: "server-port" }
  const applied = await service.execute(body)
  const twice = await service.execute(body)
  const target = twice.workspace.sessions.find((session) => session.id === targetId)!
  assert.deepEqual(target.receivedFindings, ["demo-alice-server:server-port"])
  assert.equal(target.messages.length, applied.workspace.sessions.find((session) => session.id === targetId)!.messages.length)
  await assert.rejects(service.execute({ ...body, findingId: "missing" }), rejected(404))
  const reply = await service.execute({ command: "message", workspaceId: initial.workspaceId, sessionId: targetId, prompt: "Continue reviewing the task", modelId: "gpt-6-astra" })
  assert.ok(reply.workspace.sessions.find((session) => session.id === targetId)!.messages.some((message) => message.role === "user" && message.text === "Continue reviewing the task"))
  await assert.rejects(service.execute({ command: "message", workspaceId: initial.workspaceId, sessionId: "missing", prompt: "Continue", modelId: task.modelId }), rejected(404))
})

test("storage failure and corrupt stored state surface a server error", async (t) => {
  const { directory, service } = await setup(t)
  const initial = await service.execute({ command: "bootstrap" })
  await writeFile(join(directory, `${initial.workspaceId}.json`), "invalid json")
  await assert.rejects(service.execute({ command: "bootstrap", workspaceId: initial.workspaceId }), rejected(500))
  const blocked = join(directory, "a-file")
  await writeFile(blocked, "not a directory")
  await assert.rejects(new WorkspaceService({ directory: blocked }).execute({ command: "bootstrap" }), rejected(500))
})

test("a teammate session cannot receive or discover You's private finding", async (t) => {
  const { service } = await setup(t)
  const workspace = createDemoWorkspace()
  const source = workspace.sessions.find((session) => session.id === "demo-alice-server")!
  source.scope = "private"
  source.owner = "You"
  source.findings![0].solution = "Private port details known only to You"
  for (const session of workspace.sessions.filter((session) => session.relatedSessionId === source.id)) {
    delete session.relatedSessionId
    delete session.relation
  }
  const initial = await service.execute({ command: "bootstrap", initialWorkspace: workspace })
  const analyzed = await service.execute({ command: "analyze", workspaceId: initial.workspaceId, ...task, owner: "Sam", prompt: "Fix EADDRINUSE on port 3000" })
  assert.equal(analyzed.analysis!.kind, "clear")
  assert.equal(analyzed.analysis!.sourceSessionId, undefined)
  await assert.rejects(service.execute({ command: "add-context", workspaceId: initial.workspaceId, targetId: "demo-sam-frontend", sourceSessionId: source.id, findingId: "server-port" }), rejected(404))
  const reply = await service.execute({ command: "message", workspaceId: initial.workspaceId, sessionId: "demo-sam-frontend", prompt: "Fix EADDRINUSE on port 3000", modelId: task.modelId })
  assert.equal(reply.finding, undefined)
  assert.doesNotMatch(reply.workspace.sessions.find((session) => session.id === "demo-sam-frontend")!.messages.at(-1)!.text, /Private port details/)
})
