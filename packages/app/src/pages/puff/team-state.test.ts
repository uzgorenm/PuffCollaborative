import { expect, test } from "bun:test"
import { createTeamController, mergeTeamEvents, submissionAttempt, teamEventText } from "./team-state"
import type { Coordination } from "@opencode-ai/schema/coordination"
import type { ProjectTransport } from "./project-api"

const event = (id: string, seq: number, threadId = "thread-a") => ({
  id,
  seq,
  projectId: "project" as Coordination.ProjectID,
  threadId: threadId as Coordination.ThreadID,
  kind: "run.output" as const,
  occurredAt: "2026-09-29T19:00:00Z",
  payload: { text: "Finding" },
})

test("replayed_events_are_ordered_deduplicated_and_never_cross_threads", () => {
  expect(
    mergeTeamEvents([event("b", 2)], [event("a", 1), event("b", 2), event("x", 3, "thread-b")], "thread-a").map(
      (x) => x.id,
    ),
  ).toEqual(["a", "b"])
})

test("an_ambiguous_send_can_only_retry_the_same_text_mode_and_target", () => {
  const original = submissionAttempt(
    undefined,
    { threadId: "a", kind: "instruction", text: "Check focus" },
    () => "stable",
  )
  expect(
    submissionAttempt(original, { threadId: "a", kind: "instruction", text: "Check focus" }, () => "different"),
  ).toBe(original)
  expect(() => submissionAttempt(original, { threadId: "b", kind: "instruction", text: "Check focus" })).toThrow()
  expect(() => submissionAttempt(original, { threadId: "a", kind: "comment", text: "Check focus" })).toThrow()
  expect(() => submissionAttempt(original, { threadId: "a", kind: "instruction", text: "Changed" })).toThrow()
})

test("only_documented_event_text_is_rendered_and_it_stays_plain_text", () => {
  expect(teamEventText(event("a", 1))).toBe("Finding")
  expect(teamEventText({ ...event("b", 2), payload: { text: { html: "unsafe" } } })).toBe("")
  expect(teamEventText({ ...event("c", 3), payload: { text: "<img onerror=alert(1)>" } })).toBe(
    "<img onerror=alert(1)>",
  )
})

const thread = (id = "a", title = id) => ({
  id,
  title,
  projectId: "prj_test",
  sessionId: `ses_${id}`,
  workerId: "worker",
  createdBy: "alice",
  createdAt: "2026-09-29T19:00:00Z",
  activitySeq: 0,
})
const snapshot = (id = "a", title = id) => ({
  thread: thread(id, title),
  instructions: [],
  runs: [],
  approvals: [],
  workCard: null,
  cursor: 0,
})
const approval = {
  id: "approval-a",
  threadId: "a" as Coordination.ThreadID,
  runId: "run-a" as Coordination.RunID,
  toolCallId: "tool-a",
  version: 1,
  state: "pending" as const,
  requestedAt: "2026-09-29T19:00:00Z",
  deliveryState: "none" as const,
}

function service(
  handler: (path: string, init: RequestInit) => Response | Promise<Response> | undefined,
): ProjectTransport {
  return async (url, init) => {
    const path = new URL(url).pathname.replace("/api/coordination/v1", "") + new URL(url).search
    const response = handler(path, init)
    if (response !== undefined) return response
    if (path === "/projects")
      return Response.json([{ id: "prj_test", name: "Project", createdBy: "alice", createdAt: "2026-09-29T19:00:00Z" }])
    if (path === "/projects/prj_test/threads") return Response.json([thread()])
    if (path.startsWith("/threads/") && path.includes("/events?"))
      return Response.json({ events: [], cursor: 0, hasMore: false })
    if (path === "/threads/a") return Response.json(snapshot())
    throw new Error(`Unexpected test request: ${path}`)
  }
}

// Drain only promise continuations; no wall-clock sleeps or live service requests.
async function settle() {
  for (let i = 0; i < 400; i++) await Promise.resolve()
}

async function connected(transport: ProjectTransport) {
  const team = createTeamController(transport)
  expect(await team.connect("https://team.example", "alice", "test-only")).toBe(true)
  await settle()
  return team
}

test("switching_A_B_A_starts_each_read_immediately_and_ignores_obsolete_responses", async () => {
  const reads: {
    id: string
    signal?: AbortSignal | null
    response: ReturnType<typeof Promise.withResolvers<Response>>
  }[] = []
  const team = await connected(
    service((path, init) => {
      if (!/^\/threads\/[ab]$/.test(path)) return
      const response = Promise.withResolvers<Response>()
      reads.push({ id: path.split("/").at(-1)!, signal: init.signal, response })
      // Deliberately emulate a transport that can finish even after cancellation.
      return response.promise
    }),
  )
  team.selectThread("a")
  team.selectThread("b")
  team.selectThread("a")
  expect(reads.map((read) => read.id)).toEqual(["a", "b", "a"])
  expect(reads[0]!.signal?.aborted).toBe(true)
  expect(reads[1]!.signal?.aborted).toBe(true)
  reads[2]!.response.resolve(Response.json(snapshot("a", "Current A")))
  await settle()
  reads[0]!.response.resolve(Response.json(snapshot("a", "Obsolete A")))
  reads[1]!.response.resolve(Response.json(snapshot("b", "Obsolete B")))
  await settle()
  expect(team.state.snapshot?.thread.title).toBe("Current A")
  expect(team.writable()).toBe(true)
  team.dispose()
})

test("roster_refresh_discovers_a_shared_thread_while_another_is_open", async () => {
  let shared = [thread()]
  const team = await connected(
    service((path) => (path === "/projects/prj_test/threads" ? Response.json(shared) : undefined)),
  )
  team.selectThread("a")
  await settle()
  shared = [thread(), thread("b")]
  await team.refresh()
  expect(team.state.threads.map((value) => String(value.id))).toEqual(["a", "b"])
  expect(team.state.threadId).toBe("a")
  team.dispose()
})

test("overview_refresh_reads_exact_project_and_thread_snapshots", async () => {
  const project = { id: "prj_test" as Coordination.ProjectID, name: "Project", createdBy: "alice" as Coordination.UserID, createdAt: "2026-09-29T19:00:00Z" }
  const members = [{ projectId: project.id, userId: "alice" as Coordination.UserID, role: "owner" as const, joinedAt: project.createdAt }]
  const team = await connected(service((path) => {
    if (path === "/projects/prj_test") return Response.json({ project, members })
    if (path === "/projects/prj_test/work-cards") return Response.json([])
    return
  }))
  await team.refreshOverview()
  expect(team.state.overview?.project).toEqual(project)
  expect(team.state.overview?.members).toEqual(members)
  expect(team.state.overview?.threads.map((value) => String(value.id))).toEqual(["a"])
  expect(team.state.overview?.snapshots.map((value) => String(value.thread.id))).toEqual(["a"])
  expect(team.state.overviewError).toBe("")
  team.dispose()
})

test("overview_switch_aborts_old_read_and_never_publishes_a_partial_project", async () => {
  const pending = Promise.withResolvers<Response>()
  let oldSignal: AbortSignal | null | undefined
  const second = { id: "prj_other" as Coordination.ProjectID, name: "Other", createdBy: "bob", createdAt: "2026-09-29T19:00:00Z" }
  const team = await connected(service((path, init) => {
    if (path === "/projects/prj_test") {
      oldSignal = init.signal
      return pending.promise
    }
    if (path === "/projects/prj_other") return Response.json({ project: second, members: [] })
    if (path === "/projects/prj_other/threads" || path === "/projects/prj_other/work-cards") return Response.json([])
    if (path === "/projects") return Response.json([
      { id: "prj_test", name: "Project", createdBy: "alice", createdAt: second.createdAt }, second,
    ])
    return
  }))
  const old = team.refreshOverview()
  await team.loadProject(second.id)
  expect(oldSignal?.aborted).toBe(true)
  await team.refreshOverview()
  pending.resolve(Response.json({ project: { ...second, id: "prj_test" }, members: [] }))
  await old
  expect(team.state.overview?.project.id).toBe(second.id)
  expect(team.state.overview?.threads).toEqual([])
  team.dispose()
})

test("overview_rejects_mixed_activity_revisions_instead_of_showing_a_card_as_current", async () => {
  const project = { id: "prj_test", name: "Project", createdBy: "alice", createdAt: "2026-09-29T19:00:00Z" }
  const team = await connected(service((path) => {
    if (path === "/projects/prj_test") return Response.json({ project, members: [] })
    if (path === "/projects/prj_test/work-cards") return Response.json([])
    if (path === "/threads/a") return Response.json({ ...snapshot(), thread: { ...thread(), activitySeq: 1 } })
    return
  }))
  await team.refreshOverview()
  expect(team.state.overview).toBeUndefined()
  expect(team.state.overviewError).toBe("invalid")
  team.dispose()
})

test("overview_inspects_an_exact_non_conversation_source_without_changing_the_target_draft", async () => {
  const stamp = "2026-09-29T19:00:00Z"
  const cited = {
    id: "work-card-event", projectId: "prj_test" as Coordination.ProjectID,
    threadId: "a" as Coordination.ThreadID, seq: 1,
    kind: "work-card.updated" as const, occurredAt: stamp, payload: { version: 1 },
  } satisfies Coordination.Event
  const card = {
    id: "card-a", projectId: "prj_test", threadId: "a", version: 1, sourceActivitySeq: 1,
    currentTask: "Review", progress: "In progress", blockers: [], status: "active",
    recentVerifiedOutcome: null, contributors: [], evidenceRefs: [{ threadId: "a", eventId: cited.id, seq: 1 }],
    generatedAt: stamp, submittedBy: "analyst", updatedAt: stamp, summaryJobId: "job-a",
  }
  const team = await connected(service((path) => {
    if (path === "/projects/prj_test") return Response.json({
      project: { id: "prj_test", name: "Project", createdBy: "alice", createdAt: stamp }, members: [],
    })
    if (path === "/projects/prj_test/threads") return Response.json([{ ...thread(), activitySeq: 1 }])
    if (path === "/projects/prj_test/work-cards") return Response.json([card])
    if (path === "/threads/a") return Response.json({ ...snapshot(), thread: { ...thread(), activitySeq: 1 } })
    if (path === "/projects/prj_test/events?after=0&limit=1")
      return Response.json({ events: [cited], cursor: 1, hasMore: false })
    return
  }))
  await team.refreshOverview()
  team.selectThread("a")
  team.set("drafts", "a", { text: "Keep this draft", kind: "comment" })
  expect(await team.resolveOverviewSource(card.evidenceRefs[0]!, new AbortController().signal)).toEqual(cited)
  expect(team.state.threadId).toBe("a")
  expect(team.state.drafts.a?.text).toBe("Keep this draft")
  team.dispose()
})

test("capped_replay_stays_nonwritable_and_continues_until_the_backlog_is_complete", async () => {
  const tail = Promise.withResolvers<Response>()
  const team = await connected(
    service((path) => {
      if (!path.includes("/events?")) return
      const after = Number(new URL(`https://team.example${path}`).searchParams.get("after"))
      if (after >= 25) return tail.promise
      return Response.json({
        events: [{ ...event(`e${after + 1}`, after + 1, "a"), projectId: "prj_test" }],
        cursor: after + 1,
        hasMore: true,
      })
    }),
  )
  team.selectThread("a")
  await settle()
  expect(team.state.cursor).toBe(25)
  expect(team.state.loading).toBe(true)
  expect(team.writable()).toBe(false)
  expect(team.state.lastSuccess).toBe(0)
  tail.resolve(Response.json({ events: [], cursor: 25, hasMore: false }))
  await settle()
  expect(team.state.loading).toBe(false)
  expect(team.writable()).toBe(true)
  team.dispose()
})

test.each([401, 403])(
  "authorization_%s_clears_visible_protected_state_even_if_a_thread_read_finishes_later",
  async (status) => {
    let revoked = false
    const team = await connected(
      service((path) => (path === "/projects" && revoked ? new Response(null, { status }) : undefined)),
    )
    team.selectThread("a")
    await settle()
    team.set("drafts", "a", { text: "Private draft", kind: "instruction" })
    revoked = true
    await team.refresh()
    expect(team.state.connected).toBe(false)
    expect(team.state.snapshot).toBeUndefined()
    expect(team.state.events).toEqual([])
    expect(team.state.projects).toEqual([])
    expect(team.state.threads).toEqual([])
    expect(Object.keys(team.state.drafts)).toEqual([])
    expect(team.state.error).toBe("unauthorized")
    expect(team.state.serviceUrl).toBe("")
    team.dispose()
  },
)

test("an_ambiguous_submission_survives_later_401_and_disconnect_only_in_its_original_account_and_service", async () => {
  const requests: { requestId: string; text: string }[] = []
  let response: "lost" | "unauthorized" | "ok" = "lost"
  const team = await connected(
    service((path, init) => {
      if (path !== "/threads/a/instructions") return
      const body = JSON.parse(String(init.body))
      requests.push(body)
      if (response === "lost") return Promise.reject(new Error("Lost response"))
      if (response === "unauthorized") return new Response(null, { status: 401 })
      return Response.json({
        instruction: {
          id: "ins_a",
          requestId: body.requestId,
          threadId: "a",
          actorId: "alice",
          text: body.text,
          queueSeq: 1,
          submittedAt: "2026-09-29T19:00:00Z",
          runId: "run_a",
        },
        run: {
          id: "run_a",
          threadId: "a",
          instructionId: "ins_a",
          state: "queued",
          attempt: 0,
          runnerMessageId: "message_a",
          createdAt: "2026-09-29T19:00:00Z",
        },
      })
    }),
  )
  team.selectThread("a")
  await settle()
  team.set("drafts", "a", { text: "Keep this request", kind: "instruction" })
  team.set("positions", "a", { top: 240, followTail: false })
  await team.send()
  await settle()
  const requestId = team.state.pending.a?.requestId
  if (!requestId) throw new Error("Expected an unresolved submission")
  response = "unauthorized"
  await team.send()
  expect(team.state.connected).toBe(false)
  expect(Object.keys(team.state.pending)).toEqual([])
  expect(await team.connect("https://team.example", "bob", "test-only")).toBe(true)
  await settle()
  expect(team.state.drafts.a).toBeUndefined()
  expect(team.state.pending.a).toBeUndefined()
  expect(team.state.positions.a).toBeUndefined()
  team.disconnect()
  expect(await team.connect("https://other.example", "alice", "test-only")).toBe(true)
  await settle()
  expect(team.state.drafts.a).toBeUndefined()
  expect(team.state.pending.a).toBeUndefined()
  team.disconnect()
  expect(await team.connect("https://team.example/", "alice", "test-only")).toBe(true)
  await settle()
  expect(team.state.pending.a?.requestId).toBe(requestId)
  expect(team.state.drafts.a?.text).toBe("Keep this request")
  expect(team.state.positions.a).toEqual({ top: 240, followTail: false })
  team.disconnect()
  expect(team.state.connected).toBe(false)
  expect(await team.connect("https://team.example", "alice", "test-only")).toBe(true)
  await settle()
  response = "ok"
  await team.send()
  expect(requests.map((request) => request.requestId)).toEqual([requestId, requestId, requestId])
  expect(team.state.pending.a).toBeUndefined()
  expect(team.state.drafts.a?.text).toBe("")
  team.dispose()
})

test("an_uncertain_rejection_retries_the_identical_decision_without_reclaiming", async () => {
  let claims = 0
  const decisions: { expectedVersion: number; decision: string; decisionId: string }[] = []
  const team = await connected(
    service((path, init) => {
      if (path === "/threads/a") return Response.json({ ...snapshot(), approvals: [approval] })
      if (path.endsWith("/claim")) {
        claims++
        return Response.json({ ...approval, state: "claimed", version: 2, claimedBy: "alice" })
      }
      if (path.endsWith("/decision")) {
        decisions.push(JSON.parse(String(init.body)))
        if (decisions.length === 1) return Promise.reject(new Error("Lost response"))
        return Response.json({
          ...approval,
          version: 3,
          state: "rejected",
          decision: "reject",
          decisionId: decisions[1]!.decisionId,
        })
      }
    }),
  )
  team.selectThread("a")
  await settle()
  await team.control("reject", approval)
  await settle()
  await team.control("reject", approval)
  expect(claims).toBe(1)
  expect(decisions).toHaveLength(2)
  expect(decisions[0]).toEqual(decisions[1])
  expect(decisions[1]?.expectedVersion).toBe(2)
  team.dispose()
})

test("committed_rejection_with_pending_delivery_retries_the_remembered_decision_without_reclaiming", async () => {
  let current: Coordination.Approval = approval
  let claims = 0
  const decisions: { expectedVersion: number; decision: string; decisionId: string }[] = []
  const team = await connected(
    service((path, init) => {
      if (path === "/threads/a") return Response.json({ ...snapshot(), approvals: [current] })
      if (path.endsWith("/claim")) {
        claims++
        current = { ...approval, state: "claimed", version: 2, claimedBy: "alice" as Coordination.UserID }
        return Response.json(current)
      }
      if (path.endsWith("/decision")) {
        const body = JSON.parse(String(init.body)) as (typeof decisions)[number]
        decisions.push(body)
        current = {
          ...current,
          state: "rejected",
          version: 3,
          decision: "reject",
          decisionId: body.decisionId,
          decidedBy: "alice" as Coordination.UserID,
          deliveryState: decisions.length === 1 ? "pending" : "delivered",
        }
        if (decisions.length === 1) return Promise.reject(new Error("Runner delivery failed after commit"))
        return Response.json(current)
      }
    }),
  )
  team.selectThread("a")
  await settle()
  await team.control("reject", approval)
  await settle()
  expect(team.state.snapshot?.approvals[0]?.deliveryState).toBe("pending")
  expect(team.canRetryDecision(team.state.snapshot!.approvals[0]!)).toBe(true)
  await team.retryDecision(team.state.snapshot!.approvals[0]!)
  await settle()
  expect(claims).toBe(1)
  expect(decisions).toHaveLength(2)
  expect(decisions[1]).toEqual(decisions[0])
  expect(decisions[1]?.expectedVersion).toBe(2)
  expect(team.state.snapshot?.approvals[0]?.deliveryState).toBe("delivered")
  expect(team.canRetryDecision(team.state.snapshot!.approvals[0]!)).toBe(false)
  team.dispose()
})

test("only_the_original_connected_account_can_retry_an_undelivered_decision", async () => {
  let current: Coordination.Approval = approval
  const team = await connected(
    service((path, init) => {
      if (path === "/threads/a") return Response.json({ ...snapshot(), approvals: [current] })
      if (path.endsWith("/claim"))
        return Response.json({ ...approval, state: "claimed", version: 2, claimedBy: "alice" })
      if (path.endsWith("/decision")) {
        const body = JSON.parse(String(init.body)) as { decisionId: string }
        current = {
          ...approval,
          state: "rejected",
          version: 3,
          decision: "reject",
          decisionId: body.decisionId,
          decidedBy: "alice" as Coordination.UserID,
          deliveryState: "failed",
        }
        return Promise.reject(new Error("Delivery failed"))
      }
    }),
  )
  team.selectThread("a")
  await settle()
  await team.control("reject", approval)
  await settle()
  expect(team.canRetryDecision(team.state.snapshot!.approvals[0]!)).toBe(true)
  team.disconnect()
  expect(await team.connect("https://team.example", "bob", "test-only")).toBe(true)
  await settle()
  expect(team.canRetryDecision(team.state.snapshot!.approvals[0]!)).toBe(false)
  team.disconnect()
  expect(await team.connect("https://team.example", "alice", "test-only")).toBe(true)
  await settle()
  expect(team.canRetryDecision(team.state.snapshot!.approvals[0]!)).toBe(true)
  team.dispose()
  const afterReload = await connected(
    service((path) => (path === "/threads/a" ? Response.json({ ...snapshot(), approvals: [current] }) : undefined)),
  )
  afterReload.selectThread("a")
  await settle()
  expect(afterReload.canRetryDecision(afterReload.state.snapshot!.approvals[0]!)).toBe(false)
  afterReload.dispose()
})

test("worker_delivery_observed_on_refresh_clears_the_remembered_decision", async () => {
  let current: Coordination.Approval = approval
  const team = await connected(
    service((path, init) => {
      if (path === "/threads/a") return Response.json({ ...snapshot(), approvals: [current] })
      if (path.endsWith("/claim")) return Response.json({ ...approval, state: "claimed", version: 2 })
      if (path.endsWith("/decision")) {
        const body = JSON.parse(String(init.body)) as { decisionId: string }
        current = {
          ...approval,
          state: "rejected",
          version: 3,
          decision: "reject",
          decisionId: body.decisionId,
          deliveryState: "pending",
        }
        return Promise.reject(new Error("Delivery failed"))
      }
    }),
  )
  team.selectThread("a")
  await settle()
  await team.control("reject", approval)
  await settle()
  expect(team.canRetryDecision(team.state.snapshot!.approvals[0]!)).toBe(true)
  current = { ...current, deliveryState: "delivered" }
  await team.refresh()
  expect(team.canRetryDecision(team.state.snapshot!.approvals[0]!)).toBe(false)
  team.disconnect()
  expect(await team.connect("https://team.example", "alice", "test-only")).toBe(true)
  await settle()
  expect(team.canRetryDecision(team.state.snapshot!.approvals[0]!)).toBe(false)
  team.dispose()
})

test("resolving_an_exact_source_keeps_the_target_thread_and_draft", async () => {
  const source = { ...event("source", 7, "a"), projectId: "prj_test" as Coordination.ProjectID }
  const team = await connected(
    service((path) => {
      if (path === "/threads/b") return Response.json(snapshot("b"))
      if (path.startsWith("/projects/prj_test/events?"))
        return Response.json({ events: [source], cursor: 7, hasMore: false })
    }),
  )
  team.selectThread("b")
  await settle()
  team.set("drafts", "b", { text: "Continue B", kind: "instruction" })
  const found = await team.resolveSource({ threadId: "a", eventId: "source", seq: 7 }, new AbortController().signal)
  expect(found).toEqual(source)
  expect(team.state.threadId).toBe("b")
  expect(team.state.drafts.b?.text).toBe("Continue B")
  team.dispose()
})

test("source_lookup_uses_the_visible_A_thread_after_the_roster_switches_to_project_B", async () => {
  const source = { ...event("source", 7, "a"), projectId: "prj_test" as Coordination.ProjectID }
  const requests: string[] = []
  const team = await connected(
    service((path) => {
      if (path === "/projects")
        return Response.json([
          { id: "prj_test", name: "A", createdBy: "alice", createdAt: "2026-09-29T19:00:00Z" },
          { id: "prj_other", name: "B", createdBy: "alice", createdAt: "2026-09-29T19:00:00Z" },
        ])
      if (path === "/projects/prj_other/threads") return Response.json([])
      if (path.startsWith("/projects/prj_test/events?")) {
        requests.push(path)
        return Response.json({ events: [source], cursor: 7, hasMore: false })
      }
      if (path.startsWith("/projects/prj_other/events?")) {
        requests.push(path)
        return new Response(null, { status: 404 })
      }
    }),
  )
  team.selectThread("a")
  await settle()
  team.set("drafts", "a", { text: "Keep A's draft", kind: "instruction" })
  await team.loadProject("prj_other")
  expect(team.state.projectId).toBe("prj_other")
  expect(String(team.state.snapshot?.thread.projectId)).toBe("prj_test")
  const found = await team.resolveSource({ threadId: "a", eventId: "source", seq: 7 }, new AbortController().signal)
  expect(found).toEqual(source)
  expect(requests).toEqual(["/projects/prj_test/events?after=6&limit=1"])
  expect(team.state.threadId).toBe("a")
  expect(team.state.drafts.a?.text).toBe("Keep A's draft")
  team.dispose()
})

test("a_project_switch_during_source_lookup_rejects_the_late_A_event", async () => {
  const response = Promise.withResolvers<Response>()
  const source = { ...event("source", 7, "a"), projectId: "prj_test" as Coordination.ProjectID }
  const team = await connected(
    service((path) => {
      if (path === "/projects")
        return Response.json([
          { id: "prj_test", name: "A", createdBy: "alice", createdAt: "2026-09-29T19:00:00Z" },
          { id: "prj_other", name: "B", createdBy: "alice", createdAt: "2026-09-29T19:00:00Z" },
        ])
      if (path === "/projects/prj_other/threads") return Response.json([])
      if (path.startsWith("/projects/prj_test/events?")) return response.promise
    }),
  )
  team.selectThread("a")
  await settle()
  const pending = team.resolveSource({ threadId: "a", eventId: "source", seq: 7 }, new AbortController().signal)
  await team.loadProject("prj_other")
  response.resolve(Response.json({ events: [source], cursor: 7, hasMore: false }))
  await expect(pending).rejects.toMatchObject({ code: "invalid" })
  team.dispose()
})

test("cancelled_or_wrong_target_late_evidence_never_resolves", async () => {
  const source = { ...event("source", 7, "a"), projectId: "prj_test" as Coordination.ProjectID }
  const responses = [Promise.withResolvers<Response>(), Promise.withResolvers<Response>()]
  let requests = 0
  const team = await connected(
    service((path) => {
      if (path === "/threads/b") return Response.json(snapshot("b"))
      if (path.startsWith("/projects/prj_test/events?")) return responses[requests++]?.promise
    }),
  )
  team.selectThread("a")
  await settle()
  const abort = new AbortController()
  const cancelled = team.resolveSource({ threadId: "a", eventId: "source", seq: 7 }, abort.signal)
  abort.abort()
  responses[0]!.resolve(Response.json({ events: [source], cursor: 7, hasMore: false }))
  await expect(cancelled).rejects.toThrow()
  const switched = team.resolveSource({ threadId: "a", eventId: "source", seq: 7 }, new AbortController().signal)
  team.selectThread("b")
  responses[1]!.resolve(Response.json({ events: [source], cursor: 7, hasMore: false }))
  await expect(switched).rejects.toMatchObject({ code: "invalid" })
  team.dispose()
})

test("evidence_started_under_one_account_cannot_finish_after_reconnect_as_another", async () => {
  const response = Promise.withResolvers<Response>()
  const source = { ...event("source", 7, "a"), projectId: "prj_test" as Coordination.ProjectID }
  const team = await connected(
    service((path) => {
      if (path.startsWith("/projects/prj_test/events?")) return response.promise
    }),
  )
  team.selectThread("a")
  await settle()
  const pending = team.resolveSource({ threadId: "a", eventId: "source", seq: 7 }, new AbortController().signal)
  team.disconnect()
  expect(await team.connect("https://team.example", "bob", "test-only")).toBe(true)
  response.resolve(Response.json({ events: [source], cursor: 7, hasMore: false }))
  await expect(pending).rejects.toMatchObject({ code: "invalid" })
  team.dispose()
})

test("source_scope_changes_on_every_connection_and_clears_on_disconnect", async () => {
  const team = await connected(service(() => undefined))
  const first = team.state.sourceScope
  expect(first).not.toBe("")
  team.disconnect()
  expect(team.state.sourceScope).toBe("")
  expect(await team.connect("https://team.example", "alice", "test-only")).toBe(true)
  expect(team.state.sourceScope).not.toBe(first)
  const second = team.state.sourceScope
  team.disconnect()
  expect(await team.connect("https://team.example", "bob", "test-only")).toBe(true)
  expect(team.state.sourceScope).not.toBe(second)
  team.dispose()
})

test("tool_approval_is_unavailable_without_reviewable_permission_details", async () => {
  const mutations: string[] = []
  const team = await connected(
    service((path, init) => {
      if (init.method === "POST") {
        mutations.push(path)
        return Response.json(approval)
      }
    }),
  )
  team.selectThread("a")
  await settle()
  await team.control("approve", approval)
  expect(mutations).toEqual([])
  team.dispose()
})
