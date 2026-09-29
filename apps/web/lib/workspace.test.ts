import assert from "node:assert/strict"
import test from "node:test"
import { createDemoWorkspace, createTaskSession, findRelatedWork, findSolvedProblem } from "./workspace.ts"

test("setup preserves supplied project details and gives each person parallel sessions", () => {
  const workspace = createDemoWorkspace("  Launchpad  ", "  Ship a collaborative workspace  ")
  assert.equal(workspace.project.name, "Launchpad")
  assert.equal(workspace.project.goal, "Ship a collaborative workspace")
  assert.deepEqual(workspace.project.members.map((member) => member.name), ["You", "Sam", "Alice"])
  assert.equal(workspace.sessions.filter((session) => session.owner === "You").length, 2)
  assert.equal(workspace.sessions.filter((session) => session.owner === "Sam").length, 2)
  assert.equal(workspace.sessions.filter((session) => session.owner === "Alice").length, 2)
})

test("each setup creates independent data so one workspace cannot change another", () => {
  const first = createDemoWorkspace()
  first.sessions[0].messages.push({ role: "user", text: "Local note" })
  first.project.members[0].focus = "Changed locally"
  const second = createDemoWorkspace()
  assert.equal(second.sessions[0].messages.length, 2)
  assert.notEqual(second.project.members[0].focus, "Changed locally")
})

test("navigation overlap includes both of Sam's relevant frontend sessions", () => {
  const workspace = createDemoWorkspace()
  assert.deepEqual(findRelatedWork("Build the FRONTEND sidebar", workspace.sessions).map((session) => session.id), [
    "demo-sam-frontend",
    "demo-sam-mobile",
  ])
})

test("backend overlap includes another session owned by the same person", () => {
  const workspace = createDemoWorkspace()
  assert.deepEqual(findRelatedWork("Add an API for project membership", workspace.sessions).map((session) => session.id), [
    "demo-you-api",
    "demo-you-auth",
  ])
})

test("server overlap stays separate from backend work and ignores unrelated prompts", () => {
  const sessions = createDemoWorkspace().sessions
  assert.deepEqual(findRelatedWork("Fix the server EADDRINUSE error", sessions).map((session) => session.id), ["demo-alice-server"])
  assert.deepEqual(findRelatedWork("Write a release announcement", sessions), [])
  assert.deepEqual(findRelatedWork("Check the capital of Spain", sessions), [])
})

test("solved server lookup returns the original session and finding with its source", () => {
  const sessions = createDemoWorkspace().sessions
  const result = findSolvedProblem("My development server fails: EADDRINUSE on port 3000", sessions)
  assert.ok(result)
  assert.equal(result.session.id, "demo-alice-server")
  assert.equal(result.session.status, "complete")
  assert.equal(result.session, sessions.find((session) => session.id === "demo-alice-server"))
  assert.equal(result.finding, result.session.findings?.[0])
  assert.equal(result.finding.source, "Alice · Fix the failing development server · message 2")
  assert.match(result.finding.solution, /3005/)
})

test("solved server lookup accepts the scenario but never promotes an unrelated bug", () => {
  const sessions = createDemoWorkspace().sessions
  for (const prompt of ["The server keeps failing", "The dev server won't start", "Port 3000 is already in use"]) {
    assert.equal(findSolvedProblem(prompt, sessions)?.finding.id, "server-port", prompt)
  }
  for (const prompt of ["Fix a general bug", "Fix login", "Review server authentication", "Change the report format", "The server returns the wrong data"]) {
    assert.equal(findSolvedProblem(prompt, sessions), undefined, prompt)
  }
})

test("a server mention plus another failure does not imply a solved port conflict", () => {
  const sessions = createDemoWorkspace().sessions
  for (const prompt of [
    "Server authentication fails for new users",
    "API server requests are failing",
    "The server startup fails because the database is unavailable",
    "The server fails with ENOENT",
    "The server keeps failing with a timeout",
    "Port the UI to mobile; the server has a login problem",
    "The server has an authentication problem on port 3000",
  ]) {
    assert.equal(findSolvedProblem(prompt, sessions), undefined, prompt)
  }
})

test("only completed sources with the matching finding can supply a solved problem", () => {
  const sessions = createDemoWorkspace().sessions
  const source = sessions.find((session) => session.id === "demo-alice-server")!
  source.status = "waiting"
  assert.equal(findSolvedProblem("EADDRINUSE on port 3000", sessions), undefined)
  source.status = "complete"
  source.findings = [{ id: "unrelated", title: "Another fix", problem: "A login problem", solution: "Review membership", source: "Alice" }]
  assert.equal(findSolvedProblem("EADDRINUSE on port 3000", sessions), undefined)
})

test("matching uses only the source sessions admitted by the caller", () => {
  const sessions = createDemoWorkspace().sessions
  const source = sessions.find((session) => session.id === "demo-alice-server")!
  source.scope = "private"
  const visible = sessions.filter((session) => session.scope === "project" || session.owner === "You")
  assert.equal(findSolvedProblem("EADDRINUSE on port 3000", visible), undefined)
  assert.deepEqual(findRelatedWork("Fix the dev server", visible), [])
})

test("an independent task preserves its prompt and supports an unknown team member", () => {
  const workspace = createDemoWorkspace()
  const before = structuredClone(workspace)
  const task = createTaskSession("  Draft release notes  ", "Maya Chen", workspace.project)
  assert.equal(task.owner, "Maya Chen")
  assert.equal(task.initials, "MC")
  assert.equal(task.task, "Draft release notes")
  assert.equal(task.messages[0].text, "Draft release notes")
  assert.equal(task.status, "waiting")
  assert.equal(task.scope, "project")
  assert.match(task.messages[1].text, /demo/i)
  assert.equal(task.relation, undefined)
  assert.deepEqual(workspace, before)
})

test("complementary work adds a separate scoped plan and keeps the source conversation intact", () => {
  const workspace = createDemoWorkspace()
  const source = workspace.sessions.find((session) => session.id === "demo-sam-frontend")!
  const before = structuredClone(workspace)
  const task = createTaskSession("Build frontend navigation", "You", workspace.project, "complementary", source)
  assert.notEqual(task.id, source.id)
  assert.equal(task.owner, "You")
  assert.equal(task.topic, "navigation")
  assert.equal(task.task, "Check navigation accessibility and project switching")
  assert.equal(task.title, "Check navigation accessibility and project switching")
  assert.equal(task.messages[0].text, "Build frontend navigation")
  assert.match(task.relation ?? "", /Sam/)
  assert.equal(task.relatedSessionId, "demo-sam-frontend")
  assert.equal(task.messages[1].text.includes("demo-sam-frontend"), false)
  assert.equal(task.relation?.includes("demo-sam-frontend"), false)
  assert.match(task.messages[1].text, /accessibility/i)
  assert.match(task.messages[1].text, /test/i)
  assert.match(task.messages[1].text, /Sam · Build project navigation/)
  assert.match(task.messages[1].text, /demo/i)
  assert.deepEqual(workspace, before)
})

test("repeating a task creates separate local sessions", () => {
  const project = createDemoWorkspace().project
  assert.notEqual(createTaskSession("Review the API", "You", project).id, createTaskSession("Review the API", "You", project).id)
})

test("complementary backend work proposes API and access checks instead of navigation work", () => {
  const workspace = createDemoWorkspace()
  const source = workspace.sessions.find((session) => session.id === "demo-you-api")!
  const before = structuredClone(workspace)
  const task = createTaskSession("Build the project API", "You", workspace.project, "complementary", source)
  assert.equal(task.relatedSessionId, "demo-you-api")
  assert.equal(task.topic, "backend")
  assert.equal(task.task, "Check API contracts and access rules")
  assert.equal(task.title, "Check API contracts and access rules")
  assert.equal(task.messages[0].text, "Build the project API")
  assert.match(task.messages[1].text, /API contract tests/)
  assert.match(task.messages[1].text, /access-rule review/)
  assert.equal(task.messages[1].text.includes("project-switching"), false)
  assert.match(task.summary, /API contract tests/)
  assert.deepEqual(workspace, before)
})
