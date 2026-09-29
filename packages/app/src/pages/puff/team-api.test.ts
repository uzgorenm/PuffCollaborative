import { expect, test } from "bun:test"
import { createTeamApi } from "./team-api"

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
  const value = { thread: { id: "thread-a", projectId: "prj_test", sessionId: "ses_test", workerId: "worker", title: "Example", createdBy: "member", createdAt: "2026-09-29T20:00:00Z", activitySeq: 0 }, instructions: [], runs: [], approvals: [], workCard: null, cursor: 0 }
  const api = createTeamApi({ baseUrl: "https://team.example", username: "serdar", password: "test-only", transport: async () => Response.json(value) })
  expect((await api.thread("thread-a")).workCard).toBeNull()
})
