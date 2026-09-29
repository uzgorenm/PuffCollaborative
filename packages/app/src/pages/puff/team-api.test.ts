import { expect, test } from "bun:test"
import { createTeamApi } from "./team-api"
import { Coordination } from "@opencode-ai/schema/coordination"

test("team_client_uses_current_basic_contract_and_never_supplies_an_actor", async () => {
  const calls: { url: string; body: unknown; auth: string | null }[] = []
  const api = createTeamApi({
    baseUrl: "http://127.0.0.1:4096",
    username: "serdar",
    password: "test-only",
    transport: async (url, init) => {
      calls.push({
        url: String(url),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        auth: new Headers(init?.headers).get("authorization"),
      })
      return Response.json([])
    },
  })
  expect(await api.projects()).toEqual([])
  expect(calls[0]?.url).toBe("http://127.0.0.1:4096/api/coordination/v1/projects")
  expect(calls[0]?.auth).toBe("Basic c2VyZGFyOnRlc3Qtb25seQ==")
  await expect(api.comment("thread/one", "A finding", "stable-id")).rejects.toMatchObject({ code: "invalid" })
  expect(calls[1]?.url).toEndWith("/threads/thread%2Fone/comments")
  expect(calls[1]?.body).toEqual({ requestId: "stable-id", body: "A finding" })
})

test("unavailable_or_malformed_team_service_never_becomes_example_data", async () => {
  const config = { baseUrl: "https://team.example", username: "serdar", password: "test-only" }
  await expect(
    createTeamApi({ ...config, transport: async () => new Response(null, { status: 503 }) }).projects(),
  ).rejects.toMatchObject({ code: "unavailable" })
  await expect(
    createTeamApi({ ...config, transport: async () => Response.json([{ id: "missing-fields" }]) }).projects(),
  ).rejects.toMatchObject({ code: "invalid" })
})

test("a_thread_without_a_work_card_uses_the_authoritative_null_response", async () => {
  const value = {
    thread: {
      id: "thread-a",
      projectId: "prj_test",
      sessionId: "ses_test",
      workerId: "worker",
      title: "Example",
      createdBy: "member",
      createdAt: "2026-09-29T20:00:00Z",
      activitySeq: 0,
    },
    instructions: [],
    runs: [],
    approvals: [],
    workCard: null,
    cursor: 0,
  }
  const api = createTeamApi({
    baseUrl: "https://team.example",
    username: "serdar",
    password: "test-only",
    transport: async () => Response.json(value),
  })
  expect((await api.thread("thread-a")).workCard).toBeNull()
})

test("cancelling_an_obsolete_read_aborts_its_transport", async () => {
  let received: AbortSignal | null | undefined
  const api = createTeamApi({
    baseUrl: "https://team.example",
    username: "serdar",
    password: "test-only",
    transport: async (_url, init) => {
      received = init?.signal
      return new Promise<Response>((_resolve, reject) => {
        received?.addEventListener("abort", () => reject(received?.reason), { once: true })
      })
    },
  })
  const controller = new AbortController()
  const reading = api.projects(controller.signal)
  controller.abort()
  expect(received?.aborted).toBe(true)
  await expect(reading).rejects.toBeDefined()
})

const sourceEvent = {
  id: "event-one",
  projectId: Coordination.ProjectID.make("project/one"),
  threadId: Coordination.ThreadID.make("thread-one"),
  seq: 7,
  kind: "comment.created",
  occurredAt: "2026-09-29T20:00:00Z",
  payload: { body: "Synthetic source finding" },
} satisfies Coordination.Event
const sourceRef = { threadId: sourceEvent.threadId, eventId: sourceEvent.id, seq: sourceEvent.seq }
const sourceConfig = { baseUrl: "https://team.example", username: "serdar", password: "test-only" }

test("project_overview_reads_exact_member_and_card_contracts", async () => {
  const calls: string[] = []
  const project = { id: Coordination.ProjectID.make("project/one"), name: "Puff", createdBy: Coordination.UserID.make("serdar"), createdAt: "2026-09-29T20:00:00Z" }
  const members = [{ projectId: project.id, userId: Coordination.UserID.make("serdar"), role: "owner" as const, joinedAt: project.createdAt }]
  const api = createTeamApi({
    ...sourceConfig,
    transport: async (url, init) => {
      calls.push(String(url))
      expect(init.method).toBe("GET")
      expect(new Headers(init.headers).get("authorization")).toBe("Basic c2VyZGFyOnRlc3Qtb25seQ==")
      if (String(url).endsWith("/projects/project%2Fone")) return Response.json({ project, members })
      if (String(url).endsWith("/projects/project%2Fone/work-cards")) return Response.json([])
      throw new Error("Unexpected route")
    },
  })
  expect(await api.project(project.id)).toEqual({ project, members })
  expect(await api.workCards(project.id)).toEqual([])
  expect(calls).toEqual([
    "https://team.example/api/coordination/v1/projects/project%2Fone",
    "https://team.example/api/coordination/v1/projects/project%2Fone/work-cards",
  ])
})

test("project_overview_rejects_cross_project_and_malformed_reads", async () => {
  const api = createTeamApi({
    ...sourceConfig,
    transport: async (url) => String(url).endsWith("work-cards")
      ? Response.json([{ projectId: "other", threadId: "thread-a" }])
      : Response.json({
        project: { id: "other", name: "Other", createdBy: "serdar", createdAt: "2026-09-29T20:00:00Z" },
        members: [],
      }),
  })
  await expect(api.project("project/one")).rejects.toMatchObject({ code: "invalid" })
  await expect(api.workCards("project/one")).rejects.toMatchObject({ code: "invalid" })
})

test("source_resolves_only_the_exact_authenticated_project_event", async () => {
  const abort = new AbortController()
  const api = createTeamApi({
    ...sourceConfig,
    transport: async (url, init) => {
      expect(url).toBe("https://team.example/api/coordination/v1/projects/project%2Fone/events?after=6&limit=1")
      expect(init.method).toBe("GET")
      expect(new Headers(init.headers).get("authorization")).toBe("Basic c2VyZGFyOnRlc3Qtb25seQ==")
      expect(init.credentials).toBe("omit")
      expect(init.redirect).toBe("error")
      expect(init.body).toBeUndefined()
      expect(init.signal?.aborted).toBe(false)
      return Response.json({ events: [sourceEvent], cursor: 7, hasMore: true })
    },
  })
  expect(await api.source(sourceEvent.projectId, sourceRef, abort.signal)).toEqual(sourceEvent)
})

test.each([
  { projectId: "other-project" },
  { threadId: "other-thread" },
  { threadId: undefined },
  { id: "other-event" },
  { seq: 8 },
])("source_rejects_a_mismatched_event_%j", async (change) => {
  const api = createTeamApi({
    ...sourceConfig,
    transport: async () => Response.json({ events: [{ ...sourceEvent, ...change }], cursor: 7, hasMore: false }),
  })
  await expect(api.source(sourceEvent.projectId, sourceRef)).rejects.toMatchObject({ code: "invalid" })
})

test.each([{ events: [] }, { events: [sourceEvent, sourceEvent] }, { events: [{ ...sourceEvent, payload: null }] }])(
  "source_rejects_missing_extra_or_malformed_events_%j",
  async ({ events }) => {
    const api = createTeamApi({
      ...sourceConfig,
      transport: async () => Response.json({ events, cursor: 7, hasMore: false }),
    })
    await expect(api.source(sourceEvent.projectId, sourceRef)).rejects.toMatchObject({ code: "invalid" })
  },
)

test.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
  "source_rejects_invalid_sequence_before_transport_%s",
  async (seq) => {
    let calls = 0
    const api = createTeamApi({
      ...sourceConfig,
      transport: async () => {
        calls++
        return Response.json({ events: [sourceEvent], cursor: 7, hasMore: false })
      },
    })
    await expect(api.source(sourceEvent.projectId, { ...sourceRef, seq })).rejects.toMatchObject({ code: "invalid" })
    expect(calls).toBe(0)
  },
)

test.each([401, 403, 404, 503])("source_preserves_access_and_availability_errors_%s", async (status) => {
  const api = createTeamApi({ ...sourceConfig, transport: async () => new Response(null, { status }) })
  await expect(api.source(sourceEvent.projectId, sourceRef)).rejects.toMatchObject({
    code: status === 503 ? "unavailable" : status === 404 ? "request" : "unauthorized",
    status,
  })
})

test("source_forwards_abort_and_rejects_a_late_result_even_when_transport_ignores_it", async () => {
  const abort = new AbortController()
  const response = Promise.withResolvers<Response>()
  let signal: AbortSignal | null | undefined
  const api = createTeamApi({
    ...sourceConfig,
    transport: async (_url, init) => {
      signal = init.signal
      return response.promise
    },
  })
  const reading = api.source(sourceEvent.projectId, sourceRef, abort.signal)
  abort.abort()
  expect(signal?.aborted).toBe(true)
  response.resolve(Response.json({ events: [sourceEvent], cursor: 7, hasMore: false }))
  await expect(reading).rejects.toBeDefined()
})

test("source_checks_the_requested_citation_when_the_callers_reference_changes", async () => {
  const response = Promise.withResolvers<Response>()
  const api = createTeamApi({ ...sourceConfig, transport: async () => response.promise })
  const ref = { ...sourceRef }
  const reading = api.source(sourceEvent.projectId, ref)
  ref.eventId = "replacement"
  response.resolve(Response.json({ events: [{ ...sourceEvent, id: "replacement" }], cursor: 7, hasMore: false }))
  await expect(reading).rejects.toMatchObject({ code: "invalid" })
})
