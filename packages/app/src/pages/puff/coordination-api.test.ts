import { expect, test } from "bun:test"
import { checkCoordination } from "./coordination-api"

test("uses_the_registered_coordination_status_route_and_basic_member_identity", async () => {
  const calls: { url: string; authorization: string | null; redirect: RequestRedirect | undefined }[] = []
  await expect(
    checkCoordination({
      baseUrl: "https://hub.example",
      username: "serdar",
      password: "test-only",
      transport: async (url, init) => {
        calls.push({
          url: String(url),
          authorization: new Headers(init?.headers).get("authorization"),
          redirect: init?.redirect,
        })
        return Response.json({ ready: true })
      },
    }),
  ).resolves.toBe(true)
  expect(calls).toEqual([
    {
      url: "https://hub.example/api/coordination/v1/status",
      authorization: "Basic c2VyZGFyOnRlc3Qtb25seQ==",
      redirect: "error",
    },
  ])
})

test("the_real_status_503_does_not_fall_back_to_live_fixture_data", async () => {
  await expect(
    checkCoordination({
      baseUrl: "https://hub.example",
      username: "serdar",
      password: "test-only",
      transport: async () => new Response(null, { status: 503 }),
    }),
  ).rejects.toMatchObject({ code: "unavailable", status: 503 })
})

test("ready_false_blocks_the_connection_even_when_status_is_200", async () => {
  await expect(
    checkCoordination({
      baseUrl: "https://hub.example",
      username: "serdar",
      password: "test-only",
      transport: async () => Response.json({ ready: false }),
    }),
  ).rejects.toMatchObject({ code: "unavailable" })
})
