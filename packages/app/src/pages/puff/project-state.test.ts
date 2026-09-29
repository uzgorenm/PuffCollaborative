import { describe, expect, test } from "bun:test"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { createProjectApi, ProjectApiError, readSnapshot } from "./project-api"
import { deliveryState, evidenceStale, sessionViews, workerOnline } from "./project-state"

const now = Date.parse("2026-09-29T18:00:00Z")
const snapshot = {
  schemaVersion: 1,
  projectId: "puff",
  viewerId: "serdar",
  workers: [
    { workerId: "w1", projectId: "puff", ownerId: "serdar", lastSeenAt: "2026-09-29T17:59:50Z", state: "online" },
  ],
  sessions: [
    {
      workerId: "w1",
      sessionId: "a",
      ownerId: "serdar",
      title: "Compact",
      featureTopic: "Navigation",
      relationship: "alternative",
      revision: 2,
      status: "running",
    },
    {
      workerId: "w1",
      sessionId: "b",
      ownerId: "serdar",
      title: "Expanded",
      featureTopic: "Navigation",
      relationship: "alternative",
      revision: 1,
      status: "running",
    },
  ],
  events: [
    {
      eventId: "e1",
      projectId: "puff",
      workerId: "w1",
      sessionId: "a",
      revision: 2,
      kind: "message",
      occurredAt: "2026-09-29T17:59:50Z",
      content: { text: "A finding" },
    },
  ],
  summaries: [
    {
      summaryId: "sum1",
      projectId: "puff",
      workerId: "w1",
      sessionId: "a",
      revision: 2,
      task: "Navigation",
      approach: "Compact",
      workState: "planned",
      progress: "Ready to start",
      blockers: [],
      evidenceRefs: [],
      generatedAt: "2026-09-29T17:59:50Z",
      runId: "run1",
    },
  ],
  proposals: [],
  awarenessNotes: [],
  deliveries: [],
  decisions: [],
}

describe("Puff project state", () => {
  test("offline_worker_is_not_displayed_as_current", () => {
    const worker = readSnapshot(snapshot).workers[0]
    expect(workerOnline(worker, now)).toBe(true)
    expect(workerOnline(worker, now + 20_001)).toBe(false)
    expect(workerOnline({ ...worker, state: "offline" }, now)).toBe(false)
    expect(workerOnline({ ...worker, lastSeenAt: "bad" }, now)).toBe(false)
  })

  test("alternative_sessions_remain_distinct_and_planned_is_not_completed", () => {
    const views = sessionViews(readSnapshot(snapshot), now)
    expect(views.map((view) => view.session.sessionId)).toEqual(["a", "b"])
    expect(views[0].summary?.workState).toBe("planned")
    expect(views[1].summary).toBeUndefined()
  })

  test("new_or_missing_evidence_requires_a_fresh_proposal", () => {
    const project = readSnapshot(snapshot)
    expect(evidenceStale(project, [{ workerId: "w1", sessionId: "a", eventId: "e1", revision: 2 }])).toBe(false)
    expect(evidenceStale(project, [{ workerId: "w1", sessionId: "a", eventId: "e1", revision: 1 }])).toBe(true)
    expect(evidenceStale(project, [{ workerId: "w1", sessionId: "a", eventId: "missing", revision: 2 }])).toBe(true)
  })

  test("delivery_ack_required_for_success_and_target_must_match", () => {
    const source = {
      sourceKind: "awarenessNote" as const,
      sourceId: "note",
      targetWorkerId: "w1",
      targetSessionId: "b",
    }
    expect(deliveryState([], source)).toBe("pending")
    const ack = { ...source, deliveryId: "d1", messageId: "m1", state: "delivered" as const, error: null }
    expect(deliveryState([ack], source)).toBe("delivered")
    expect(deliveryState([{ ...ack, messageId: "" }], source)).toBe("pending")
    expect(deliveryState([{ ...ack, targetSessionId: "other" }], source)).toBe("pending")
    expect(deliveryState([{ ...ack, state: "failed" }], source)).toBe("failed")
  })

  test("invalid_or_cross_project_snapshots_are_rejected", () => {
    expect(() => readSnapshot({ ...snapshot, workers: null })).toThrow()
    expect(() => readSnapshot({ ...snapshot, schemaVersion: 2 })).toThrow()
    expect(() => readSnapshot({ ...snapshot, workers: [{ ...snapshot.workers[0], projectId: "private" }] })).toThrow()
    expect(() => readSnapshot({ ...snapshot, sessions: [{ ...snapshot.sessions[0], workerId: "unknown" }] })).toThrow()
    expect(() =>
      readSnapshot({ ...snapshot, summaries: [{ ...snapshot.summaries[0], workState: "invented" }] }),
    ).toThrow()
  })
})

describe("Puff API", () => {
  test("approval_sends_expected_version_and_exact_final_text_without_actor", async () => {
    const calls: { url: string; body: unknown; authorization: string | null }[] = []
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      calls.push({
        url: request.url!,
        body: JSON.parse(Buffer.concat(chunks).toString()),
        authorization: request.headers.authorization ?? null,
      })
      response.writeHead(200, { "Content-Type": "application/json" })
      response.end(JSON.stringify({ approvalId: "a1" }))
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    try {
      const api = createProjectApi({
        baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        token: "test-member",
        transport: Bun.fetch,
      })
      await api.approve("p/1", {
        approvalId: "a1",
        expectedVersion: 3,
        decision: "approve",
        finalText: " Keep this exact text. ",
        decidedAt: "2026-09-29T18:00:00Z",
      })
      expect(calls).toEqual([
        {
          url: "/puff/v1/proposals/p%2F1/approval",
          authorization: "Bearer test-member",
          body: {
            approvalId: "a1",
            proposalId: "p/1",
            expectedVersion: 3,
            decision: "approve",
            finalText: " Keep this exact text. ",
            decidedAt: "2026-09-29T18:00:00Z",
          },
        },
      ])
    } finally {
      server.closeAllConnections()
      server.close()
    }
  })

  test("stale_conflict_requires_refresh_without_retrying", async () => {
    let calls = 0
    const server = createServer((_request, response) => {
      calls++
      response.writeHead(409)
      response.end("conflict")
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    try {
      const api = createProjectApi({
        baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        token: "test-member",
        transport: Bun.fetch,
      })
      await expect(
        api.approve("p1", {
          approvalId: "a1",
          expectedVersion: 1,
          decision: "approve",
          finalText: "Text",
          decidedAt: "2026-09-29T18:00:00Z",
        }),
      ).rejects.toMatchObject({ status: 409, code: "conflict" })
      expect(calls).toBe(1)
    } finally {
      server.closeAllConnections()
      server.close()
    }
  })

  test("credentials_cannot_be_sent_to_insecure_remote_hosts_or_redirects", async () => {
    expect(() => createProjectApi({ baseUrl: "http://example.com", token: "secret" })).toThrow(ProjectApiError)
    expect(() => createProjectApi({ baseUrl: "https://user:secret@example.com", token: "secret" })).toThrow(
      ProjectApiError,
    )
    expect(() => createProjectApi({ baseUrl: "https://example.com/?token=secret", token: "secret" })).toThrow(
      ProjectApiError,
    )
  })
})
