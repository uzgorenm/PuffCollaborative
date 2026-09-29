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
