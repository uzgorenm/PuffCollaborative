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
  const project = {
    id: Coordination.ProjectID.make("project/one"),
    name: "Puff",
    createdBy: Coordination.UserID.make("serdar"),
    createdAt: "2026-09-29T20:00:00Z",
  }
  const members = [
    {
      projectId: project.id,
      userId: Coordination.UserID.make("serdar"),
      role: "owner" as const,
      joinedAt: project.createdAt,
    },
  ]
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
    transport: async (url) =>
      String(url).endsWith("work-cards")
        ? Response.json([{ projectId: "other", threadId: "thread-a" }])
        : Response.json({
            project: { id: "other", name: "Other", createdBy: "serdar", createdAt: "2026-09-29T20:00:00Z" },
            members: [],
          }),
  })
  await expect(api.project("project/one")).rejects.toMatchObject({ code: "invalid" })
  await expect(api.workCards("project/one")).rejects.toMatchObject({ code: "invalid" })
})
