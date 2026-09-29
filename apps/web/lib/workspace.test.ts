import assert from "node:assert/strict"
import test from "node:test"
import { createDemoWorkspace, createTaskSession, findRelatedWork, findSolvedProblem, refreshWorkspacePresentation } from "./workspace.ts"

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
  assert.match(task.messages[1].text, /^Plan for Puff:/)
  assert.doesNotMatch(task.messages[1].text, /demo|walkthrough|does not (?:run|execute)/i)
  assert.doesNotMatch(task.summary, /demo/i)
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
  assert.match(task.messages[1].text, /^Plan for Puff:/)
  assert.match(task.messages[1].text, /proposed complementary scope/)
  assert.doesNotMatch(task.messages[1].text, /demo|walkthrough|does not (?:run|execute)/i)
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

test("the seeded startup finding uses startup copy and keeps its attribution", () => {
  const source = createDemoWorkspace().sessions.find((session) => session.id === "demo-alice-server")!
  assert.match(source.messages[1].text, /^The startup error was a port conflict:/)
  assert.doesNotMatch(source.messages[1].text, /scenario/i)
  assert.equal(source.findings?.[0].source, "Alice · Fix the failing development server · message 2")
})

test("saved workspace presentation refreshes known plans without changing user content or session identity", () => {
  const workspace = createDemoWorkspace("demo-marker project", "Keep the demo-marker goal")
  const task = createTaskSession("Keep the demo-marker task", "You", workspace.project)
  task.id = "demo-task-saved"
  task.title = "Keep the demo-marker title"
  task.scope = "private"
  task.relation = "Independent alongside demo-marker source"
  task.relatedSessionId = "demo-source-marker"
  task.summary = "Task assigned in this demo; the first step is ready to review."
  task.messages = [
    { role: "user", text: "Keep the demo-marker task\nDemo plan: this literal user note must stay." },
    { role: "assistant", text: "Demo plan for demo-marker project: clarify the outcome for “Keep the demo-marker task”, inspect the relevant project context, and propose a small first step. This creates a local demo session; it does not run an agent or change another session." },
    { role: "assistant", text: "Discuss the demo-marker with the team; this local demo should stay in my notes." },
  ]
  workspace.sessions.push(task)
  const before = structuredClone(workspace)
  const refreshed = refreshWorkspacePresentation(workspace)
  const saved = refreshed.sessions.find((session) => session.id === "demo-task-saved")!

  assert.equal(saved.messages[1].text, "Plan for demo-marker project: clarify the outcome for “Keep the demo-marker task”, inspect the relevant project context, and propose a small first step.")
  assert.equal(saved.summary, "The first step is ready to review.")
  assert.equal(saved.messages[0], task.messages[0])
  assert.equal(saved.messages[2], task.messages[2])
  assert.equal(saved.task, "Keep the demo-marker task")
  assert.equal(saved.title, "Keep the demo-marker title")
  assert.equal(saved.scope, "private")
  assert.equal(saved.relation, "Independent alongside demo-marker source")
  assert.equal(saved.relatedSessionId, "demo-source-marker")
  assert.equal(saved.updatedAt, task.updatedAt)
  assert.equal(refreshed.project, workspace.project)
  assert.deepEqual(workspace, before)
  assert.deepEqual(refreshWorkspacePresentation(refreshed), refreshed)
})

test("saved related task plans retain source references and proposed complementary scope", () => {
  const workspace = createDemoWorkspace("demo-marker project")
  const source = workspace.sessions.find((session) => session.id === "demo-sam-frontend")!
  source.title = "Build the demo-marker navigation"
  const independent = createTaskSession("Review the demo-marker navigation", "You", workspace.project, "independent", source)
  independent.messages[1].text = "Demo plan for demo-marker project: clarify the outcome for “Review the demo-marker navigation”, inspect the relevant project context, and propose a small first step. Sam · Build the demo-marker navigation is related work; keep this task independent and compare scope before implementing. This creates a local demo session; it does not run an agent or change another session."
  const complementary = createTaskSession("Build navigation", "You", workspace.project, "complementary", source)
  complementary.messages[1].text = "Demo plan for demo-marker project: review Sam · Build the demo-marker navigation as source context, then take a complementary scope: keyboard accessibility checks and project-switching tests. Keep a separate approach and record your own findings. This creates a local demo session; it does not run an agent, copy the source implementation, or stop the source session."
  workspace.sessions.push(independent, complementary)
  const refreshed = refreshWorkspacePresentation(workspace)
  const savedIndependent = refreshed.sessions.find((session) => session.id === independent.id)!
  const savedComplementary = refreshed.sessions.find((session) => session.id === complementary.id)!

  assert.equal(savedIndependent.messages[1].text, "Plan for demo-marker project: clarify the outcome for “Review the demo-marker navigation”, inspect the relevant project context, and propose a small first step. Sam · Build the demo-marker navigation is related work; keep this task independent and compare scope before implementing.")
  assert.equal(savedComplementary.messages[1].text, "Plan for demo-marker project: review Sam · Build the demo-marker navigation as source context, then consider this proposed complementary scope: keyboard accessibility checks and project-switching tests. Keep a separate approach and record your own findings.")
  assert.equal(savedIndependent.relatedSessionId, source.id)
  assert.equal(savedComplementary.relatedSessionId, source.id)
  assert.equal(savedComplementary.relation, "Complements Sam · Build the demo-marker navigation")
  assert.equal(savedComplementary.summary, "Proposed complementary scope: keyboard accessibility checks and project-switching tests.")
})

test("saved finding context refreshes generated guidance while retaining source and deduplication identity", () => {
  const workspace = createDemoWorkspace()
  const source = workspace.sessions.find((session) => session.id === "demo-alice-server")!
  source.messages[1].text = "The scenario's error was a port conflict: another process owned port 3000. Identify its owner first. This project uses development port 3005, so use its configured dev command. Reusing 3000 requires a deliberate restart after confirming the process belongs to this project. This finding is specific to that startup error; compare your error before applying it."
  const target = workspace.sessions[0]
  const finding = source.findings![0]
  finding.solution += "\nKeep the demo-marker note attached to this source."
  target.receivedFindings = ["demo-alice-server:server-port"]
  target.messages.push(
    { role: "assistant", text: `Context from ${finding.source}\n\nProblem: ${finding.problem}\n\nFinding: ${finding.solution}\n\nDemo adaptation for “${target.task}”:\n1. Check which process owns port 3000.\n2. Preserve that session and use this project's configured port, 3005.\n3. Verify this session's server starts on that port before resuming the original task.\n\nThis is a walkthrough plan, not a live execution result.` },
    { role: "assistant", text: `Demo context check: Alice's port-conflict finding is already in this session. Reuse that attributed context: check who owns port 3000, preserve that process, use this project's port 3005, and verify this server before continuing “${target.task}”. The finding has not been added a second time.` },
    { role: "assistant", text: `Demo next step: keep “${target.task}” as this session's task, inspect the relevant context for “Keep the demo-marker”, and propose a small check. This walkthrough does not execute an agent or modify project files.` },
    { role: "assistant", text: `Demo plan: continue investigating this server error independently. Compare the error, inspect which process owns the port, and record the next check in this session. Keep the original task, “${target.task}”, in scope. No finding has been copied or execution performed.` },
  )
  const refreshed = refreshWorkspacePresentation(workspace)
  const savedSource = refreshed.sessions.find((session) => session.id === "demo-alice-server")!
  const savedTarget = refreshed.sessions[0]

  assert.match(savedSource.messages[1].text, /^The startup error was a port conflict:/)
  assert.equal(savedSource.findings, source.findings)
  assert.equal(savedSource.findings![0], finding)
  assert.equal(savedTarget.receivedFindings, target.receivedFindings)
  assert.match(savedTarget.messages[2].text, /^Context from Alice · Fix the failing development server · message 2\n/)
  assert.ok(savedTarget.messages[2].text.includes(`Problem: ${finding.problem}\n\nFinding: ${finding.solution}`))
  assert.ok(savedTarget.messages[2].text.includes(`Suggested steps for “${target.task}”:`))
  assert.doesNotMatch(savedTarget.messages[2].text, /Demo adaptation|walkthrough plan/)
  assert.match(savedTarget.messages[3].text, /^Context check: Alice's/)
  assert.match(savedTarget.messages[3].text, /The finding has not been added a second time\.$/)
  assert.match(savedTarget.messages[4].text, /^Next step:/)
  assert.match(savedTarget.messages[4].text, /demo-marker/)
  assert.doesNotMatch(savedTarget.messages[4].text, /Demo next step|does not execute/)
  assert.match(savedTarget.messages[5].text, /^Plan: continue investigating/)
  assert.doesNotMatch(savedTarget.messages[5].text, /execution performed/)
  assert.equal(findSolvedProblem("EADDRINUSE on port 3000", refreshed.sessions)?.finding, finding)
})

test("presentation refresh leaves arbitrary assistant copy and exact user quotations untouched", () => {
  const workspace = createDemoWorkspace()
  const task = workspace.sessions[0]
  task.summary = "Task assigned in this demo; keep the supplied custom summary."
  task.messages.push(
    { role: "assistant", text: "Demo plan for our meeting: bring the local demo and discuss why it does not execute." },
    { role: "assistant", text: "Demo next step: discuss a walkthrough plan with Alice." },
    { role: "assistant", text: "The scenario's error was reported in the demo-marker notes." },
    { role: "user", text: `Demo next step: keep “${task.task}” as this session's task, inspect the relevant context for “literal demo-marker”, and propose a small check. This walkthrough does not execute an agent or modify project files.` },
  )
  const before = structuredClone(workspace)
  assert.deepEqual(refreshWorkspacePresentation(workspace), before)
})
