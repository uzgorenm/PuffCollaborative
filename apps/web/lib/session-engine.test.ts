import assert from "node:assert/strict"
import test from "node:test"
import { analyzeSessionTask, applySessionFinding, createGuidedSession, replyToSession } from "./session-engine.ts"
import { createDemoWorkspace } from "./workspace.ts"
import type { TaskRequest } from "./session-api.ts"

const request = (prompt: string, extra: Partial<TaskRequest> = {}): TaskRequest => ({ prompt, owner: "You", scope: "project", modelId: "gpt-6.1-sol", ...extra })

test("broad frontend intent and common typing mistakes find the actual navigation scope", () => {
  const workspace = createDemoWorkspace()
  for (const prompt of ["frontend", "Start frontend this feature", "Build the front end", "start frondend this feature", "Build frontend navigaton", "Build the project sidebr"]) {
    const result = analyzeSessionTask(request(prompt), workspace)
    assert.equal(result.kind, "overlap", prompt)
    assert.equal(result.sourceSessionId, "demo-sam-frontend", prompt)
    assert.match(result.explanation, /sidebar.*project switcher.*session list/i)
    assert.doesNotMatch(result.explanation, /already (?:built|implemented|finished)/i)
  }
})

test("a frontend keyword never claims unrelated feature ownership", () => {
  const workspace = createDemoWorkspace()
  for (const prompt of ["Build billing frontend", "Start the checkout frontend", "Build a search frontend", "Build customer profile frontend", "Build payment forms with React", "Review database connection failures"]) {
    assert.equal(analyzeSessionTask(request(prompt), workspace).kind, "clear", prompt)
  }
})

test("navigation choices distinguish unowned states, session search, and opening the source", () => {
  const result = analyzeSessionTask(request("build frontend"), createDemoWorkspace())
  const states = result.options.find((option) => option.title === "Finish navigation states")!
  const search = result.options.find((option) => option.title === "Build session search and filters")!
  const open = result.options.find((option) => option.action === "open")!
  assert.equal(states.action, "create")
  assert.match(states.task, /loading.*empty.*error.*accessibility/i)
  assert.match(states.boundary, /sidebar.*project switcher.*mobile/i)
  assert.equal(search.action, "create")
  assert.match(search.task, /session search.*filter/i)
  assert.doesNotMatch(search.description, /Sam.*(?:built|implemented).*search/i)
  assert.equal(open.sourceSessionId, "demo-sam-frontend")
  assert.equal(new Set(result.options.map((option) => option.id)).size, result.options.length)
})

test("analysis checks shared work and only the requesting owner's private work", () => {
  const workspace = createDemoWorkspace()
  workspace.sessions.find((session) => session.id === "demo-sam-frontend")!.scope = "private"
  workspace.sessions.find((session) => session.id === "demo-sam-mobile")!.scope = "private"
  workspace.sessions[0].scope = "private"
  const mine = analyzeSessionTask(request("Build frontend"), workspace)
  assert.equal(mine.kind, "clear")
  assert.equal(mine.checkedCount, 4)
  const alice = analyzeSessionTask(request("Build the project API", { owner: "Alice" }), workspace)
  assert.equal(alice.checkedCount, 3)
  assert.notEqual(alice.sourceSessionId, "demo-you-api")
  assert.ok(alice.options.every((option) => option.sourceSessionId !== "demo-you-api"))
  assert.doesNotMatch(alice.explanation, /You · Build the project API/)
})

test("chosen state scope preserves exact user text, model, privacy, and source identity", () => {
  const workspace = createDemoWorkspace()
  const before = structuredClone(workspace)
  const input = request("  start frontend this feature\nKeep labels readable.  ", { scope: "private", modelId: "gpt-6-astra" })
  const choice = analyzeSessionTask(input, workspace).options.find((option) => option.title === "Finish navigation states")!
  const result = createGuidedSession({ ...input, choiceId: choice.id, sourceSessionId: choice.sourceSessionId }, workspace)
  assert.equal(result.title, "Finish navigation states")
  assert.equal(result.task, choice.task)
  assert.equal(result.scope, "private")
  assert.equal(result.modelId, "gpt-6-astra")
  assert.equal(result.messages[0].text, input.prompt)
  assert.equal(result.messages[1].modelId, "gpt-6-astra")
  assert.equal(result.relatedSessionId, "demo-sam-frontend")
  assert.match(result.scopeBoundary ?? "", /mobile/i)
  assert.match(result.messages[1].text, /Sam · Build project navigation/)
  assert.match(result.messages[1].text, /```tsx/)
  assert.ok(result.messages[1].text.split("\n\n").length >= 4)
  assert.doesNotMatch(result.messages[1].text, /(?:demo|scripted|fake)|(?:I|we) (?:changed|edited|ran|passed|implemented)/i)
  assert.deepEqual(workspace, before)
})

test("search choice keeps a separate search scope and provides a filtering example", () => {
  const workspace = createDemoWorkspace()
  const input = request("Build frontend")
  const choice = analyzeSessionTask(input, workspace).options.find((option) => option.title === "Build session search and filters")!
  const result = createGuidedSession({ ...input, choiceId: choice.id, sourceSessionId: choice.sourceSessionId }, workspace)
  assert.equal(result.title, "Build session search and filters")
  assert.match(result.task, /session search/i)
  assert.match(result.messages[1].text, /filter\(/)
  assert.match(result.messages[1].text, /search/i)
  assert.doesNotMatch(result.messages[1].text, /Sam (?:has|already) (?:built|implemented).*search/i)
})

test("invalid, cross-request, source-mismatched and stale choices cannot create work", () => {
  const workspace = createDemoWorkspace()
  const input = request("Build frontend")
  const choice = analyzeSessionTask(input, workspace).options[0]
  assert.throws(() => createGuidedSession({ ...input, choiceId: "invented" }, workspace), /choice/i)
  assert.throws(() => createGuidedSession({ ...request("Build billing frontend"), choiceId: choice.id }, workspace), /choice/i)
  assert.throws(() => createGuidedSession({ ...input, choiceId: choice.id, sourceSessionId: "demo-alice-server" }, workspace), /source|choice/i)
  workspace.sessions.find((session) => session.id === "demo-sam-frontend")!.task = "The scope changed to a billing page"
  assert.throws(() => createGuidedSession({ ...input, choiceId: choice.id }, workspace), /choice/i)
})

test("opening a source cannot accidentally create a second session", () => {
  const workspace = createDemoWorkspace()
  const input = request("Build frontend")
  const choice = analyzeSessionTask(input, workspace).options.find((option) => option.action === "open")!
  assert.throws(() => createGuidedSession({ ...input, choiceId: choice.id }, workspace), /open|create/i)
})

test("clear work preserves its specific feature instead of becoming navigation", () => {
  const workspace = createDemoWorkspace()
  const input = request("  Build billing frontend  ", { modelId: "gpt-6-luna" })
  const session = createGuidedSession(input, workspace)
  assert.equal(session.task, "Build billing frontend")
  assert.equal(session.messages[0].text, input.prompt)
  assert.equal(session.relatedSessionId, undefined)
  assert.equal(session.modelId, "gpt-6-luna")
  assert.match(session.messages[1].text, /billing/i)
  assert.doesNotMatch(session.messages[1].text, /Sam/)
})

test("a selected task scope remains valid when the user changes the model", () => {
  const workspace = createDemoWorkspace()
  const input = request("Build frontend")
  const choice = analyzeSessionTask(input, workspace).options.find((option) => option.title === "Finish navigation states")!
  const result = createGuidedSession({ ...input, modelId: "gpt-6-astra", choiceId: choice.id }, workspace)
  assert.equal(result.title, "Finish navigation states")
  assert.equal(result.modelId, "gpt-6-astra")
  assert.equal(result.messages[1].modelId, "gpt-6-astra")
})

test("continue and build it retain chosen scope while selected model changes detail", () => {
  const workspace = createDemoWorkspace()
  const input = request("Build frontend")
  const choice = analyzeSessionTask(input, workspace).options.find((option) => option.title === "Finish navigation states")!
  const session = createGuidedSession({ ...input, choiceId: choice.id }, workspace)
  workspace.sessions.unshift(session)
  const brief = replyToSession("continue", session, workspace, "gpt-6-luna").session
  const detailed = replyToSession("build it", session, workspace, "gpt-6-astra").session
  assert.equal(brief.task, session.task)
  assert.equal(detailed.task, session.task)
  assert.equal(detailed.modelId, "gpt-6-astra")
  assert.equal(detailed.messages.at(-1)!.modelId, "gpt-6-astra")
  assert.equal(detailed.messages.at(-2)!.text, "build it")
  assert.match(detailed.messages.at(-1)!.text, /```tsx/)
  assert.match(detailed.messages.at(-1)!.text, /loading|empty|error/i)
  assert.ok(detailed.messages.at(-1)!.text.length > brief.messages.at(-1)!.text.length)
  assert.doesNotMatch(detailed.messages.at(-1)!.text, /I (?:edited|changed|ran)|tests (?:passed|pass)/i)
})

test("port conflicts return the completed attributed finding and database errors do not", () => {
  const workspace = createDemoWorkspace()
  const session = createGuidedSession(request("Build billing frontend"), workspace)
  workspace.sessions.unshift(session)
  const matched = replyToSession("My server fails with EADDRINUSE on port 3000", session, workspace, "gpt-6.1-sol")
  assert.deepEqual(matched.finding, { sourceSessionId: "demo-alice-server", findingId: "server-port", targetId: session.id })
  assert.match(matched.session.messages.at(-1)!.text, /Alice · Fix the failing development server/)
  assert.match(matched.session.messages.at(-1)!.text, /3005/)
  for (const text of ["The server can't connect to the database", "Server startup fails because the database is unavailable", "Database server EADDRINUSE on port 5432", "Error: listen EADDRINUSE: address already in use :::3005", "Error: listen EADDRINUSE: address already in use 127.0.0.1:5432"]) {
    assert.equal(replyToSession(text, session, workspace, "gpt-6.1-sol").finding, undefined, text)
  }
  assert.equal(replyToSession("Error: listen EADDRINUSE: address already in use :::3000", session, workspace, "gpt-6.1-sol").finding?.findingId, "server-port")
})

test("private completed findings stay private to their owner", () => {
  const workspace = createDemoWorkspace()
  const source = workspace.sessions.find((session) => session.id === "demo-alice-server")!
  source.scope = "private"
  const session = createGuidedSession(request("Investigate server startup"), workspace)
  workspace.sessions.unshift(session)
  assert.equal(replyToSession("EADDRINUSE on port 3000", session, workspace, "gpt-6.1-sol").finding, undefined)
  assert.throws(() => applySessionFinding(session, source, "server-port", workspace), /private|visible|access/i)
})

test("adding source context preserves origin and deduplicates repeated additions and suggestions", () => {
  const workspace = createDemoWorkspace()
  const source = workspace.sessions.find((session) => session.id === "demo-alice-server")!
  const target = createGuidedSession(request("Build frontend billing"), workspace)
  workspace.sessions.unshift(target)
  const before = structuredClone(source)
  const added = applySessionFinding(target, source, "server-port", workspace)
  assert.equal(added.task, target.task)
  assert.deepEqual(added.receivedFindings, ["demo-alice-server:server-port"])
  assert.match(added.messages.at(-1)!.text, /Alice · Fix the failing development server · message 2/)
  assert.equal(applySessionFinding(added, source, "server-port", workspace).messages.length, added.messages.length)
  const next = replyToSession("EADDRINUSE again", added, workspace, "gpt-6.1-sol")
  assert.equal(next.finding, undefined)
  assert.match(next.session.messages.at(-1)!.text, /already.*context|context.*already/i)
  assert.deepEqual(source, before)
  assert.throws(() => applySessionFinding(target, source, "unknown", workspace), /finding/i)
})

test("seed sessions have relative activity times and concrete scope references", () => {
  const workspace = createDemoWorkspace()
  for (const session of workspace.sessions) {
    assert.ok(Date.now() - Date.parse(session.updatedAt) >= 0)
    assert.ok(Date.now() - Date.parse(session.updatedAt) < 90 * 60_000)
    assert.ok(session.scopeBoundary)
  }
  const source = workspace.sessions.find((session) => session.id === "demo-sam-frontend")!
  assert.match(source.messages[1].text, /apps\/web\//)
  assert.doesNotMatch(source.messages[1].text, /tests passed|I (?:changed|ran)/i)
})
