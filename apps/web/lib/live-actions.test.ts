import { test } from "node:test"
import assert from "node:assert/strict"
import { prepareLiveAction, reviewedContextText, possiblyRelatedWork } from "./live-actions.ts"
import type { WorkspaceSession } from "./live-workspace.ts"

test("a retry keeps its exact identity and body while changed actor or text starts a new action", () => {
  const input = {
    actorId: "usr_serdar",
    projectId: "prj_one",
    path: "/threads/thr_one/instructions",
    body: { text: "Inspect navigation" },
  }
  const first = prepareLiveAction(input, undefined, () => "request-one")
  const retry = prepareLiveAction({ ...input, body: { text: "Inspect navigation" } }, first, () => "unexpected")
  assert.equal(retry, first)
  assert.deepEqual(retry.body, { text: "Inspect navigation", requestId: "request-one" })
  assert.equal(
    prepareLiveAction({ ...input, body: { text: "Review access" } }, first, () => "request-two").body.requestId,
    "request-two",
  )
  assert.equal(
    prepareLiveAction({ ...input, actorId: "usr_talha" }, first, () => "request-three").body.requestId,
    "request-three",
  )
})

test("a failed versioned write retries its captured version even if fresh state has changed", () => {
  const first = prepareLiveAction(
    {
      actorId: "usr_serdar",
      projectId: "prj_one",
      path: "/projects/prj_one/focus/me",
      method: "PUT",
      body: { text: "Access rules", expectedVersion: 4 },
    },
    undefined,
    () => "focus-one",
  )
  assert.deepEqual(first.body, { text: "Access rules", expectedVersion: 4, requestId: "focus-one" })
  assert.equal(first.method, "PUT")
})

test("reviewed context carries the exact source identity without claiming execution or use", () => {
  const source = {
    id: "evt_focus",
    projectId: "prj_one",
    threadId: "thr_source",
    seq: 0,
    kind: "run.output",
    payload: { text: "Keyboard focus must remain visible.", token: "not selected" },
  }
  const text = reviewedContextText("prj_one", "thr_target", source)
  assert.match(text, /thr_source.*evt_focus.*0/)
  assert.match(text, /Keyboard focus must remain visible/)
  assert.doesNotMatch(text, /not selected|already applied|Flower verified/)
  assert.throws(() => reviewedContextText("prj_other", "thr_target", source))
  assert.throws(() => reviewedContextText("prj_one", "thr_source", source))
})

test("person overview bounds an instruction preview and omits reviewed source identifiers", async () => {
  const { sessionTaskPreview } = await import("./live-actions.ts")
  const source = {
    id: "evt_focus",
    projectId: "prj_one",
    threadId: "thr_source",
    seq: 3,
    kind: "run.output",
    payload: { text: "Keyboard focus must remain visible. ".repeat(30) },
  }
  const instruction = reviewedContextText("prj_one", "thr_target", source)
  const preview = sessionTaskPreview(instruction)
  assert.ok(preview.length <= 180)
  assert.match(preview, /Keyboard focus must remain visible/)
  assert.doesNotMatch(preview, /thr_source|evt_focus|Selected source|Source content is evidence/)
  assert.match(instruction, /thr_source.*evt_focus/)
  assert.ok(instruction.length > 180)
  assert.equal(sessionTaskPreview("Inspect navigation\nthen verify access."), "Inspect navigation then verify access.")
  assert.ok(sessionTaskPreview("A long coding instruction ".repeat(30)).length <= 180)
})

test("generic server errors never match a solved port conflict and private work is excluded", () => {
  const session = {
    id: "thr_port",
    title: "Development server port",
    owner: "Alice",
    initials: "A",
    color: "blue",
    status: "complete",
    summary: "Resolved EADDRINUSE on port 3000",
    task: "Inspect development port",
    topic: "server",
    updatedAt: "2026-09-29T21:00:00Z",
    scope: "project",
    messages: [],
  } satisfies WorkspaceSession
  assert.deepEqual(possiblyRelatedWork("My server has an error", [session]), [])
  assert.deepEqual(
    possiblyRelatedWork("EADDRINUSE on port 3000", [session]).map((item) => item.id),
    ["thr_port"],
  )
  assert.deepEqual(possiblyRelatedWork("EADDRINUSE on port 3000", [{ ...session, scope: "private" }]), [])
  assert.deepEqual(possiblyRelatedWork("ECONNREFUSED on port 3000", [session]), [])
})

test("pending requests survive reload with exact body, identity and captured version only in their actor/backend/project scope", async () => {
  const { restorePendingActions, pendingActionsForScope } = await import("./live-actions.ts")
  const action = prepareLiveAction(
    {
      actorId: "usr_serdar",
      projectId: "prj_one",
      path: "/projects/prj_one/focus/me",
      method: "PUT",
      body: { text: "Review access", expectedVersion: 3 },
    },
    undefined,
    () => "durable-one",
  )
  const pending = { key: "http://127.0.0.1:4096|usr_serdar|prj_one|focus", action, label: "Personal focus" }
  const restored = restorePendingActions(JSON.stringify([pending]))
  assert.deepEqual(restored, [pending])
  assert.equal(
    pendingActionsForScope(restored, { url: "http://127.0.0.1:4096", actorId: "usr_serdar", projectId: "prj_one" })
      .length,
    1,
  )
  assert.equal(
    pendingActionsForScope(restored, { url: "http://127.0.0.1:4096", actorId: "usr_ferit", projectId: "prj_one" })
      .length,
    0,
  )
  assert.equal(
    pendingActionsForScope(restored, { url: "http://127.0.0.1:4097", actorId: "usr_serdar", projectId: "prj_one" })
      .length,
    0,
  )
  assert.equal(
    pendingActionsForScope(restored, { url: "http://127.0.0.1:4096", actorId: "usr_serdar", projectId: "prj_other" })
      .length,
    0,
  )
  assert.deepEqual(restorePendingActions("invalid JSON"), [])
  assert.deepEqual(
    restorePendingActions(JSON.stringify([{ ...pending, action: { ...action, path: "https://evil.example" } }])),
    [],
  )
})

test("cooperation writes retain the reviewed version and normalize opt-out to no notifications", async () => {
  const { cooperationWrite } = await import("./live-actions.ts")
  assert.deepEqual(
    cooperationWrite({
      expectedVersion: 2,
      featureTopic: " navigation ",
      relationship: "alternative",
      analysisEnabled: false,
      awarenessMode: "notify",
    }),
    {
      expectedVersion: 2,
      featureTopic: "navigation",
      relationship: "alternative",
      analysisEnabled: false,
      analysisTextEnabled: false,
      awarenessMode: "off",
    },
  )
  assert.throws(() =>
    cooperationWrite({
      expectedVersion: 2,
      featureTopic: "",
      relationship: "open",
      analysisEnabled: true,
      awarenessMode: "off",
    }),
  )
  const body = cooperationWrite({
    expectedVersion: 2,
    featureTopic: "navigation",
    relationship: "complementary",
    analysisEnabled: true,
    awarenessMode: "notify",
  })
  const action = prepareLiveAction(
    { actorId: "usr_serdar", projectId: "prj_one", path: "/threads/thr_one/cooperation", method: "PUT", body },
    undefined,
    () => "policy-one",
  )
  assert.equal(action.body.expectedVersion, 2)
  assert.equal(action.body.requestId, "policy-one")
})

test("Flower text consent defaults off, depends on analysis and survives a retry exactly", async () => {
  const { cooperationWrite } = await import("./live-actions.ts")
  const settings = {
    expectedVersion: 7,
    featureTopic: "navigation",
    relationship: "open" as const,
    analysisEnabled: true,
    awarenessMode: "off" as const,
  }
  assert.equal(cooperationWrite(settings).analysisTextEnabled, false)
  assert.equal(cooperationWrite({ ...settings, analysisTextEnabled: false }).analysisTextEnabled, false)
  const body = cooperationWrite({ ...settings, analysisTextEnabled: true })
  assert.equal(body.analysisTextEnabled, true)
  assert.equal(
    cooperationWrite({ ...settings, analysisEnabled: false, analysisTextEnabled: true }).analysisTextEnabled,
    false,
  )
  assert.throws(() => cooperationWrite({ ...settings, analysisTextEnabled: "yes" as unknown as boolean }))
  const input = {
    actorId: "usr_serdar",
    projectId: "prj_one",
    path: "/threads/thr_one/cooperation",
    method: "PUT" as const,
    body,
  }
  const first = prepareLiveAction(input, undefined, () => "text-consent-one")
  const retry = prepareLiveAction(input, first, () => "unexpected")
  assert.equal(retry, first)
  assert.deepEqual(retry.body, {
    ...body,
    expectedVersion: 7,
    analysisTextEnabled: true,
    requestId: "text-consent-one",
  })
  const metadataOnly = prepareLiveAction(
    { ...input, body: cooperationWrite(settings) },
    first,
    () => "metadata-consent-two",
  )
  assert.equal(metadataOnly.body.analysisTextEnabled, false)
  assert.equal(metadataOnly.body.requestId, "metadata-consent-two")
})

test("restored provisioning and approval decisions retain continuation and decision IDs", async () => {
  const { restorePendingActions } = await import("./live-actions.ts")
  const provision = prepareLiveAction(
    { actorId: "usr_serdar", projectId: "prj_one", path: "/projects/prj_one/sessions", body: { title: "Navigation" } },
    undefined,
    () => "session-one",
  )
  const decision = prepareLiveAction(
    {
      actorId: "usr_serdar",
      projectId: "prj_one",
      path: "/threads/thr_one/approvals/apr_one/decision",
      body: { expectedVersion: 4, decision: "reject" },
      identityField: "decisionId",
    },
    undefined,
    () => "decision-one",
  )
  const values = [
    {
      key: "http://127.0.0.1:4096|usr_serdar|prj_one|provision:Navigation",
      action: provision,
      label: "Shared Session",
      provision: { task: "Review navigation", draftKey: "draft-one", draftText: "Review navigation" },
    },
    {
      key: "http://127.0.0.1:4096|usr_serdar|prj_one|thr_one|apr_one:reject",
      action: decision,
      label: "Tool rejection",
      approval: true,
    },
  ]
  const restored = restorePendingActions(JSON.stringify(values))
  assert.deepEqual(restored, values)
  assert.equal(restored[1].action.body.decisionId, "decision-one")
})

test("admission reconciliation requires exact instruction request, actor, thread and body", async () => {
  const { confirmedPendingInstruction } = await import("./live-actions.ts")
  const action = prepareLiveAction(
    {
      actorId: "usr_serdar",
      projectId: "prj_one",
      path: "/threads/thr_one/instructions",
      body: { text: "Review navigation" },
    },
    undefined,
    () => "instruction-one",
  )
  const entry = { key: "http://127.0.0.1:4096|usr_serdar|prj_one|thr_one:instruction", action, label: "Instruction" }
  const record = { threadId: "thr_one", actorId: "usr_serdar", requestId: "instruction-one", text: "Review navigation" }
  assert.equal(confirmedPendingInstruction(entry, { thr_one: { instructions: [record] } }), "thr_one")
  assert.equal(
    confirmedPendingInstruction(entry, { thr_one: { instructions: [{ ...record, requestId: "other" }] } }),
    undefined,
  )
  assert.equal(
    confirmedPendingInstruction(entry, { thr_one: { instructions: [{ ...record, actorId: "usr_ferit" }] } }),
    undefined,
  )
  assert.equal(
    confirmedPendingInstruction(entry, { thr_one: { instructions: [{ ...record, text: "Edited request" }] } }),
    undefined,
  )
  assert.equal(confirmedPendingInstruction(entry, { thr_other: { instructions: [record] } }), undefined)
})

test("Allow requires complete exact Session/call review and a changed permission scope invalidates review", async () => {
  const { toolReviewForApproval, toolReviewFingerprint } = await import("./live-actions.ts")
  const review = {
    permissionRequestId: "permission-one",
    sessionId: "ses_one",
    toolCallId: "call-one",
    sourceMessageId: "msg-one",
    scopeHash: "scope-one",
    toolName: "bash",
    permission: "bash",
    patterns: ["npm test"],
    savePatterns: [],
    metadataJson: '{"command":"npm test"}',
    inputJson: '{"command":"npm test"}',
    summary: "Run tests",
    complete: true,
  }
  assert.deepEqual(toolReviewForApproval({ toolCallId: "call-one", review }, "ses_one"), review)
  assert.equal(toolReviewForApproval({ toolCallId: "call-one" }, "ses_one"), undefined)
  assert.equal(
    toolReviewForApproval({ toolCallId: "call-one", review: { ...review, inputJson: undefined } }, "ses_one"),
    undefined,
  )
  assert.equal(
    toolReviewForApproval({ toolCallId: "call-one", review: { ...review, inputJson: "not JSON" } }, "ses_one"),
    undefined,
  )
  assert.equal(
    toolReviewForApproval({ toolCallId: "call-one", review: { ...review, complete: false } }, "ses_one"),
    undefined,
  )
  assert.equal(toolReviewForApproval({ toolCallId: "other", review }, "ses_one"), undefined)
  assert.equal(toolReviewForApproval({ toolCallId: "call-one", review }, "ses_other"), undefined)
  assert.notEqual(toolReviewFingerprint(review), toolReviewFingerprint({ ...review, scopeHash: "changed-scope" }))
  assert.notEqual(
    toolReviewFingerprint(review),
    toolReviewFingerprint({ ...review, inputJson: '{"command":"rm -rf project"}' }),
  )
  assert.notEqual(
    toolReviewFingerprint(review),
    toolReviewFingerprint({ ...review, metadataJson: '{"command":"rm -rf project"}' }),
  )
})

test("an unconfirmed Session continuation cannot be replaced by changed related work", async () => {
  const { preserveProvisionContinuation } = await import("./live-actions.ts")
  const original = {
    task: "Review navigation alongside thr_original",
    draftKey: "draft-one",
    draftText: "Review navigation",
  }
  assert.equal(preserveProvisionContinuation(original, { ...original }), original)
  assert.throws(() =>
    preserveProvisionContinuation(original, { ...original, task: "Review navigation alongside thr_other" }),
  )
  assert.deepEqual(original, {
    task: "Review navigation alongside thr_original",
    draftKey: "draft-one",
    draftText: "Review navigation",
  })
})

test("a cookie account or backend change rejects the prior action/display scope", async () => {
  const { matchesConnectionScope } = await import("./live-actions.ts")
  const scope = { url: "http://127.0.0.1:4096", actorId: "usr_serdar" }
  assert.equal(matchesConnectionScope({ connected: true, ...scope }, scope), true)
  assert.equal(matchesConnectionScope({ connected: true, ...scope, actorId: "usr_ferit" }, scope), false)
  assert.equal(matchesConnectionScope({ connected: true, ...scope, url: "http://127.0.0.1:4097" }, scope), false)
  assert.equal(matchesConnectionScope({ connected: false }, scope), false)
  assert.equal(matchesConnectionScope({ connected: true, ...scope }, { url: scope.url }), false)
  assert.equal(matchesConnectionScope({ connected: true, ...scope }, undefined), false)
})

test("project context uses the latest usable actual source without inventing a summary citation", async () => {
  const { sessionContextSource } = await import("./live-actions.ts")
  const event = {
    id: "evt_output",
    projectId: "prj_one",
    threadId: "thr_source",
    seq: 12,
    kind: "run.output",
    payload: { text: "Actual verified native output" },
  }
  const session = {
    id: "thr_source",
    evidenceRefs: [],
    sourceEvents: [
      { ...event, id: "evt_older", seq: 4 },
      event,
      { ...event, id: "evt_empty", seq: 15, payload: {} },
      { ...event, id: "evt_state", seq: 16, kind: "run.completed" },
      { ...event, id: "evt_other", seq: 17, projectId: "prj_other" },
    ],
  }
  assert.deepEqual(sessionContextSource("prj_one", session), {
    kind: "recorded_event",
    ref: { threadId: "thr_source", eventId: "evt_output", seq: 12 },
    event,
  })
  assert.deepEqual(session.evidenceRefs, [])
  const cited = { threadId: "thr_source", eventId: "evt_cited", seq: 3 }
  assert.deepEqual(sessionContextSource("prj_one", { ...session, evidenceRefs: [cited] }), {
    kind: "summary_citation",
    ref: cited,
  })
  assert.equal(sessionContextSource("prj_one", { id: "thr_empty", evidenceRefs: [], sourceEvents: [] }), undefined)
  assert.equal(
    sessionContextSource("prj_one", {
      id: "thr_source",
      evidenceRefs: [],
      sourceEvents: [{ ...event, threadId: "thr_other" }],
    }),
    undefined,
  )
})
