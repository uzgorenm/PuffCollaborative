import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { join } from "node:path"
import { startHarness, until, users } from "./harness"
import type { Harness, HttpResult, Replay, Snapshot, User } from "./harness"

type Submission = { instruction: { id: string; queueSeq: number; runId: string }; run: { id: string; state: string } }

function good<T>(result: HttpResult<T>) {
  expect(result.status, JSON.stringify(result.data)).toBe(200)
  return result.data
}

async function shared(testbed: Harness, count = 2, other = false) {
  const sessions = Array.from({ length: count }, (_, index) => `ses_e2e_${index}`)
  testbed.seed("prj_e2e_main", sessions)
  if (other) testbed.seed("prj_e2e_other", ["ses_e2e_other"])
  good(
    await testbed.request("/api/coordination/v1/projects", "alice", "POST", {
      projectId: "prj_e2e_main",
      name: "Main fixture",
      requestId: "create-main",
    }),
  )
  for (const userId of ["usr_bob", "usr_carol", "usr_dan"])
    good(
      await testbed.request("/api/coordination/v1/projects/prj_e2e_main/members", "alice", "POST", {
        targetUserId: userId,
        requestId: `grant-${userId}`,
      }),
    )
  const threads = [] as string[]
  for (const sessionId of sessions)
    threads.push(
      good(
        await testbed.request<{ id: string }>("/api/coordination/v1/projects/prj_e2e_main/threads", "alice", "POST", {
          sessionId,
          title: sessionId,
          requestId: `thread-${sessionId}`,
        }),
      ).id,
    )
  if (other) {
    good(
      await testbed.request("/api/coordination/v1/projects", "dan", "POST", {
        projectId: "prj_e2e_other",
        name: "Other fixture",
        requestId: "create-other",
      }),
    )
    good(
      await testbed.request("/api/coordination/v1/projects/prj_e2e_other/threads", "dan", "POST", {
        sessionId: "ses_e2e_other",
        title: "Other project thread",
        requestId: "thread-other",
      }),
    )
  }
  return threads
}

async function submit(testbed: Harness, threadId: string, user: User, requestId: string, text: string) {
  return good(
    await testbed.request<Submission>(`/api/coordination/v1/threads/${threadId}/instructions`, user, "POST", {
      requestId,
      text,
    }),
  )
}

async function running(testbed: Harness, threadId: string, runId: string, timeoutMs = 8_000) {
  return until(
    () => testbed.snapshot(threadId),
    (value) => value.runs.some((run) => run.id === runId && run.state === "running"),
    `run ${runId} running`,
    timeoutMs,
  )
}

async function allEvents(testbed: Harness, projectId = "prj_e2e_main", user: User = "alice") {
  const events: Replay["events"] = []
  let cursor = -1
  while (true) {
    const page = await testbed.replay(projectId, cursor, user)
    events.push(...page.events)
    if (!page.hasMore) return events
    cursor = page.cursor
  }
}

async function streamEvent(reader: ReadableStreamDefaultReader<Uint8Array>, kind: string) {
  const deadline = Date.now() + 8_000
  let frames = ""
  while (Date.now() < deadline) {
    const chunk = await Promise.race([
      reader.read(),
      Bun.sleep(8_000).then(() => {
        throw new Error(`SSE timeout waiting for ${kind}`)
      }),
    ])
    if (chunk.done) throw new Error(`SSE closed before ${kind}`)
    frames += new TextDecoder().decode(chunk.value)
    if (frames.includes(kind)) return frames
  }
  throw new Error(`SSE timeout waiting for ${kind}`)
}

test("A/B: fresh schema, real credentials, project isolation, comments, and restart persistence", async () => {
  const testbed = await startHarness()
  try {
    const sqlite = new Database(testbed.dbPath, { readonly: true })
    const tables = sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
    for (const name of [
      "coordination_project",
      "coordination_membership",
      "coordination_thread",
      "coordination_comment",
      "coordination_instruction",
      "coordination_run",
      "coordination_run_callback",
      "coordination_approval",
      "coordination_work_card",
      "event",
    ])
      expect(
        tables.some((table) => table.name === name),
        name,
      ).toBe(true)
    sqlite.close()
    expect((await testbed.request("/api/health")).status).toBe(200)
    const openapi = good(await testbed.request<{ paths: Record<string, unknown> }>("/openapi.json"))
    const coordinationPaths = Object.keys(openapi.paths).filter((path) => path.startsWith("/api/coordination/v1/"))
    expect(coordinationPaths).toHaveLength(21)
    expect(coordinationPaths).toEqual(
      expect.arrayContaining([
        "/api/coordination/v1/status",
        "/api/coordination/v1/projects",
        "/api/coordination/v1/projects/{projectId}",
        "/api/coordination/v1/projects/{projectId}/members",
        "/api/coordination/v1/projects/{projectId}/contributions",
        "/api/coordination/v1/projects/{projectId}/threads",
        "/api/coordination/v1/threads/{threadId}",
        "/api/coordination/v1/threads/{threadId}/comments",
        "/api/coordination/v1/threads/{threadId}/instructions",
        "/api/coordination/v1/threads/{threadId}/instructions/{instructionId}/cancel",
        "/api/coordination/v1/runner/threads/{threadId}/reserve",
        "/api/coordination/v1/runner/runs/{runId}/events",
        "/api/coordination/v1/threads/{threadId}/approvals/{approvalId}/claim",
        "/api/coordination/v1/threads/{threadId}/approvals/{approvalId}/decision",
        "/api/coordination/v1/projects/{projectId}/events",
        "/api/coordination/v1/projects/{projectId}/events/stream",
        "/api/coordination/v1/threads/{threadId}/events",
        "/api/coordination/v1/threads/{threadId}/events/stream",
        "/api/coordination/v1/threads/{threadId}/work-card",
        "/api/coordination/v1/projects/{projectId}/work-cards",
        "/api/coordination/v1/projects/{projectId}/activity",
      ]),
    )
    expect((await testbed.request("/api/coordination/v1/projects")).status).toBe(401)
    expect((await testbed.request("/api/coordination/v1/projects", "worker")).status).toBe(403)
    expect((await testbed.request("/api/coordination/v1/projects", "analysis")).status).toBe(403)
    expect(
      (
        await testbed.request("/api/coordination/v1/projects", "eve", "POST", {
          projectId: "prj_e2e_main",
          name: "spoof",
          requestId: "spoof",
          userId: "usr_alice",
        })
      ).status,
    ).toBe(403)
    const [thread] = await shared(testbed, 1, true)
    expect((await testbed.request<Array<unknown>>("/api/coordination/v1/projects", "eve")).data).toEqual([])
    expect((await testbed.request("/api/coordination/v1/projects/prj_e2e_main", "eve")).status).toBe(403)
    expect((await testbed.request(`/api/coordination/v1/threads/${thread}`, "eve")).status).toBe(403)
    expect((await testbed.request("/api/coordination/v1/projects/prj_e2e_other", "bob")).status).toBe(403)
    expect(
      (
        await testbed.request("/api/coordination/v1/projects/prj_e2e_main/threads", "bob", "POST", {
          sessionId: "ses_e2e_other",
          title: "cross-project",
          requestId: "cross-binding",
        })
      ).status,
    ).toBe(404)
    expect((await testbed.request(`/api/coordination/v1/threads/${thread}/events/stream?after=-1`, "eve")).status).toBe(
      403,
    )
    expect(
      (
        await testbed.request(`/api/coordination/v1/threads/${thread}/instructions`, "eve", "POST", {
          requestId: "outsider",
          text: "do not run",
        })
      ).status,
    ).toBe(403)
    expect((await testbed.reserve(thread, "alice")).status).toBe(403)
    const comments = await Promise.all([
      testbed.request<{ authorId: string }>(`/api/coordination/v1/threads/${thread}/comments`, "alice", "POST", {
        requestId: "alice-comment",
        body: "Alice fixture",
        authorId: "usr_eve",
      }),
      testbed.request<{ authorId: string }>(`/api/coordination/v1/threads/${thread}/comments`, "bob", "POST", {
        requestId: "bob-comment",
        body: "Bob fixture",
        authorId: "usr_alice",
      }),
    ])
    expect(comments.map((item) => item.status)).toEqual([200, 200])
    expect(comments.map((item) => item.data.authorId).toSorted()).toEqual(["usr_alice", "usr_bob"])
    expect((await testbed.snapshot(thread)).runs).toHaveLength(0)
    expect((await testbed.request(`/api/coordination/v1/threads/${thread}/comments`, "eve")).status).toBe(403)
    const before = await testbed.snapshot(thread)
    await testbed.restartCoordinator()
    const after = await testbed.snapshot(thread)
    expect(after.thread.id).toBe(before.thread.id)
    expect(after.cursor).toBe(before.cursor)
    expect(
      good(await testbed.request<Array<{ authorId: string }>>(`/api/coordination/v1/threads/${thread}/comments`, "bob"))
        .map((comment) => comment.authorId)
        .toSorted(),
    ).toEqual(["usr_alice", "usr_bob"])
  } finally {
    await testbed.close()
  }
}, 120_000)

test("A: migrate the immediately preceding schema snapshot through registered coordination migrations", async () => {
  const { migrations } = await import("@opencode-ai/core/database/migration.gen")
  const testbed = await startHarness(async (dbPath) => {
    const sqlite = new Database(dbPath)
    sqlite.exec(await Bun.file(join(import.meta.dir, "previous-schema.sql")).text())
    sqlite.exec("CREATE TABLE migration (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)")
    const record = sqlite.query("INSERT INTO migration (id, time_completed) VALUES (?, ?)")
    migrations
      .filter((migration) => !migration.id.includes("coordination"))
      .forEach((migration) => record.run(migration.id, Date.now()))
    sqlite.close()
  })
  try {
    const sqlite = new Database(testbed.dbPath, { readonly: true })
    const migrated = sqlite
      .query("SELECT id FROM migration WHERE id LIKE '%coordination%' ORDER BY id")
      .all() as Array<{ id: string }>
    expect(migrated.map((item) => item.id)).toEqual([
      "20260929190000_coordination_runner_approval",
      "20260929190010_coordination_access",
      "20260929190020_coordination_work_card",
      "20260929193000_coordination_queue",
    ])
    const tables = sqlite
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'coordination_%'")
      .all() as Array<{ name: string }>
    expect(tables.length).toBeGreaterThanOrEqual(9)
    sqlite.close()
    testbed.seed("prj_e2e_main", ["ses_e2e_upgrade"])
    expect(
      good(
        await testbed.request<{ id: string }>("/api/coordination/v1/projects", "alice", "POST", {
          projectId: "prj_e2e_main",
          name: "Upgraded fixture",
          requestId: "upgraded-project",
        }),
      ).id,
    ).toBe("prj_e2e_main")
    expect(
      good(
        await testbed.request<{ id: string }>("/api/coordination/v1/projects/prj_e2e_main/threads", "alice", "POST", {
          sessionId: "ses_e2e_upgrade",
          title: "Upgraded thread",
          requestId: "upgraded-thread",
        }),
      ).id,
    ).toStartWith("thr_")
  } finally {
    await testbed.close()
  }
}, 120_000)

test("C/D/E: durable acceptance order, concurrent lanes, deduplication, SSE and replay", async () => {
  const testbed = await startHarness()
  try {
    const [one, two] = await shared(testbed)
    await testbed.admin("options", { autoStart: true, autoPoll: true })
    const first = await submit(testbed, one, "alice", "first", "Fixture first turn")
    const queued = await Promise.all([
      submit(testbed, one, "bob", "second", "Fixture second turn"),
      submit(testbed, one, "carol", "third", "Fixture third turn"),
    ])
    const independent = await submit(testbed, two, "dan", "independent", "Fixture independent turn")
    expect(queued.map((item) => item.instruction.queueSeq).toSorted()).toEqual([2, 3])
    const exact = await submit(testbed, one, "alice", "first", "Fixture first turn")
    expect(exact.instruction.id).toBe(first.instruction.id)
    expect(exact.run.id).toBe(first.run.id)
    const beforeConflict = (await allEvents(testbed)).length
    expect(
      (
        await testbed.request(`/api/coordination/v1/threads/${one}/instructions`, "alice", "POST", {
          requestId: "first",
          text: "Changed content",
        })
      ).status,
    ).toBe(409)
    expect((await allEvents(testbed)).length).toBe(beforeConflict)
    const claims = await Promise.all([testbed.reserve(one), testbed.reserve(one), testbed.reserve(two)])
    expect(claims[0].status).toBe(200)
    expect(claims[2].data.run?.id).toBe(independent.run.id)
    await Promise.all([running(testbed, one, first.run.id), running(testbed, two, independent.run.id)])
    expect((await testbed.state()).starts.filter((command) => command.threadId === one)).toHaveLength(1)
    expect((await testbed.snapshot(one)).runs.filter((run) => run.state === "running")).toHaveLength(1)
    const cursor = (await testbed.snapshot(one)).cursor
    const auth = (user: "alice" | "bob") => `Basic ${Buffer.from(`${user}:${users[user].password}`).toString("base64")}`
    const [aliceStream, bobStream] = await Promise.all([
      fetch(`${testbed.coordinatorUrl}/api/coordination/v1/threads/${one}/events/stream?after=${cursor}`, {
        headers: { authorization: auth("alice") },
      }),
      fetch(`${testbed.coordinatorUrl}/api/coordination/v1/threads/${one}/events/stream?after=${cursor}`, {
        headers: { authorization: auth("bob") },
      }),
    ])
    expect([aliceStream.status, bobStream.status]).toEqual([200, 200])
    const aliceReader = aliceStream.body!.getReader()
    const bobReader = bobStream.body!.getReader()
    const aliceFrame = streamEvent(aliceReader, "comment.created")
    const bobFrame = streamEvent(bobReader, "comment.created")
    good(
      await testbed.request(`/api/coordination/v1/threads/${one}/comments`, "alice", "POST", {
        requestId: "stream-comment",
        body: "Both clients see this fixture",
      }),
    )
    const [left, right] = await Promise.all([aliceFrame, bobFrame])
    const observed = good(
      await testbed.request<Replay>(`/api/coordination/v1/threads/${one}/events?after=${cursor}`, "alice"),
    )
    expect(observed.events.some((event) => event.kind === "comment.created")).toBe(true)
    expect(left).toContain(observed.events[0].id)
    expect(right).toContain(observed.events[0].id)
    await bobReader.cancel()
    const reconnectCursor = observed.cursor
    good(
      await testbed.request(`/api/coordination/v1/threads/${one}/comments`, "bob", "POST", {
        requestId: "offline-one",
        body: "Missed fixture one",
      }),
    )
    good(
      await testbed.request(`/api/coordination/v1/threads/${one}/comments`, "carol", "POST", {
        requestId: "offline-two",
        body: "Missed fixture two",
      }),
    )
    const missed = good(
      await testbed.request<Replay>(`/api/coordination/v1/threads/${one}/events?after=${reconnectCursor}`, "bob"),
    )
    expect(missed.events.map((event) => event.kind)).toEqual(["comment.created", "comment.created"])
    expect(missed.events[0].seq).toBeLessThan(missed.events[1].seq)
    expect((await testbed.request(`/api/coordination/v1/threads/${one}/events?after=-2`, "bob")).status).toBe(400)
    expect((await testbed.request(`/api/coordination/v1/threads/${one}/events?after=999999`, "bob")).status).toBe(400)
    expect((await testbed.request(`/api/coordination/v1/threads/${one}/events?after=-1&limit=257`, "bob")).status).toBe(
      400,
    )
    expect(
      (
        await testbed.callback(
          first.run.id,
          "output-once",
          {
            kind: "activity",
            state: "running",
            activity: { kind: "run.output", text: "Fixture committed output" },
          },
          true,
        )
      ).second?.status,
    ).toBe(200)
    expect(
      (
        await testbed.callback(
          first.run.id,
          "terminal-once",
          {
            kind: "state",
            expectedState: "running",
            nextState: "completed",
          },
          true,
        )
      ).second?.status,
    ).toBe(200)
    const next = queued.find((item) => item.instruction.queueSeq === 2)!
    await running(testbed, one, next.run.id)
    const state = await testbed.state()
    expect(state.starts.filter((command) => command.threadId === one).map((command) => command.runId)).toEqual([
      first.run.id,
      next.run.id,
    ])
    expect(state.starts.find((command) => command.runId === next.run.id)?.sessionId).toBe("ses_e2e_0")
    expect(state.starts.find((command) => command.runId === next.run.id)?.text).toBe(
      (await testbed.snapshot(one)).instructions.find((instruction) => instruction.runId === next.run.id)?.text,
    )
    const events = await allEvents(testbed)
    expect(events.filter((event) => event.kind === "run.output" && event.runId === first.run.id)).toHaveLength(1)
    expect(events.filter((event) => event.kind === "run.completed" && event.runId === first.run.id)).toHaveLength(1)
    expect(events.map((event) => event.seq)).toEqual(events.map((event) => event.seq).toSorted((a, b) => a - b))
    const snapshot = await testbed.snapshot(one)
    expect(
      new Set(
        events
          .filter((event) => event.kind === "instruction.submitted" && event.threadId === one)
          .map((event) => event.instructionId),
      ).size,
    ).toBe(snapshot.instructions.length)
    await aliceReader.cancel()
  } finally {
    await testbed.close()
  }
}, 120_000)

test("E: snapshot-to-stream handoff and a slow subscriber do not block another thread", async () => {
  const testbed = await startHarness()
  try {
    const [one, two] = await shared(testbed)
    const held = await submit(testbed, one, "alice", "slow-stream", "Fixture event stream")
    expect(good(await testbed.reserve(one)).run?.id).toBe(held.run.id)
    expect(
      (
        await testbed.callback(held.run.id, "slow-start", {
          kind: "state",
          expectedState: "reserved",
          nextState: "running",
        })
      ).first.status,
    ).toBe(200)
    const cursor = (await testbed.snapshot(one)).cursor
    const stream = fetch(`${testbed.coordinatorUrl}/api/coordination/v1/threads/${one}/events/stream?after=${cursor}`, {
      headers: { authorization: `Basic ${Buffer.from(`bob:${users.bob.password}`).toString("base64")}` },
    })
    const first = testbed.callback(held.run.id, "slow-output-0", {
      kind: "activity",
      state: "running",
      activity: { kind: "run.output", text: "Fixture handoff event" },
    })
    const [response, callback] = await Promise.all([stream, first])
    expect(response.status).toBe(200)
    expect(callback.first.status).toBe(200)
    const reader = response.body!.getReader()
    expect(await streamEvent(reader, "run.output")).toContain("slow-output-0")
    for (let index = 1; index <= 270; index++)
      expect(
        (
          await testbed.callback(held.run.id, `slow-output-${index}`, {
            kind: "activity",
            state: "running",
            activity: { kind: "run.output", text: `Fixture ${index}` },
          })
        ).first.status,
      ).toBe(200)
    const independent = await submit(testbed, two, "dan", "after-slow", "Fixture unaffected thread")
    expect(good(await testbed.reserve(two)).run?.id).toBe(independent.run.id)
    expect(
      (
        await testbed.callback(independent.run.id, "after-slow-start", {
          kind: "state",
          expectedState: "reserved",
          nextState: "running",
        })
      ).first.status,
    ).toBe(200)
    expect(
      (
        await testbed.callback(independent.run.id, "after-slow-complete", {
          kind: "state",
          expectedState: "running",
          nextState: "completed",
        })
      ).first.status,
    ).toBe(200)
    expect((await testbed.snapshot(two)).runs[0].state).toBe("completed")
    const events = await allEvents(testbed)
    expect(events.filter((event) => event.kind === "run.output" && event.runId === held.run.id)).toHaveLength(271)
    expect(events.at(-1)?.seq).toBe((await testbed.snapshot(one)).cursor)
    await reader.cancel()
  } finally {
    await testbed.close()
  }
}, 120_000)

test("F/G: cancellation reservation and one authoritative approval decision", async () => {
  const testbed = await startHarness()
  try {
    const [one, two] = await shared(testbed)
    const first = await submit(testbed, one, "alice", "cancel-first", "Fixture held run")
    const next = await submit(testbed, one, "bob", "cancel-next", "Fixture queued run")
    expect(good(await testbed.reserve(one)).run?.id).toBe(first.run.id)
    expect(
      (
        await testbed.callback(first.run.id, "start-held", {
          kind: "state",
          expectedState: "reserved",
          nextState: "running",
        })
      ).first.status,
    ).toBe(200)
    expect(
      (
        await testbed.request(
          `/api/coordination/v1/threads/${one}/instructions/${first.instruction.id}/cancel`,
          "eve",
          "POST",
        )
      ).status,
    ).toBe(403)
    expect(
      good(
        await testbed.request(
          `/api/coordination/v1/threads/${one}/instructions/${first.instruction.id}/cancel`,
          "carol",
          "POST",
        ),
      ).state,
    ).toBe("cancelling")
    expect((await testbed.state()).interrupts.map((item) => item.runId)).toEqual([first.run.id])
    expect(good(await testbed.reserve(one)).run).toBeFalsy()
    expect((await testbed.snapshot(one)).runs.find((run) => run.id === next.run.id)?.state).toBe("queued")
    await testbed.admin("options", { connected: false })
    expect((await testbed.reserve(one)).status).toBe(503)
    expect((await testbed.snapshot(one)).runs.find((run) => run.id === next.run.id)?.state).toBe("queued")
    await testbed.admin("options", { connected: true })
    expect(
      (
        await testbed.callback(
          first.run.id,
          "confirm-cancel",
          {
            kind: "state",
            expectedState: "cancelling",
            nextState: "cancelled",
          },
          true,
        )
      ).second?.status,
    ).toBe(200)
    expect(good(await testbed.reserve(one)).run?.id).toBe(next.run.id)
    expect(
      (await allEvents(testbed)).filter((event) => event.kind === "run.cancelled" && event.runId === first.run.id),
    ).toHaveLength(1)

    const approvalRun = await submit(testbed, two, "dan", "needs-approval", "Fixture inert approval")
    const followup = await submit(testbed, two, "alice", "approval-followup", "Fixture after approval")
    expect(good(await testbed.reserve(two)).run?.id).toBe(approvalRun.run.id)
    expect(
      (
        await testbed.callback(approvalRun.run.id, "approval-start", {
          kind: "state",
          expectedState: "reserved",
          nextState: "running",
        })
      ).first.status,
    ).toBe(200)
    expect(
      (
        await testbed.callback(approvalRun.run.id, "approval-request", {
          kind: "state",
          expectedState: "running",
          nextState: "waiting_approval",
          approvalId: "approval_fixture",
          toolCallId: "inert_tool_fixture",
        })
      ).first.status,
    ).toBe(200)
    const waiting = await testbed.snapshot(two)
    const approval = waiting.approvals[0]
    expect(waiting.runs.find((run) => run.id === approvalRun.run.id)?.state).toBe("waiting_approval")
    expect(good(await testbed.reserve(two)).run).toBeFalsy()
    expect(waiting.runs.find((run) => run.id === followup.run.id)?.state).toBe("queued")
    const decisionPath = `/api/coordination/v1/threads/${two}/approvals/${approval.id}/decision`
    expect(
      (
        await testbed.request(decisionPath, "eve", "POST", {
          expectedVersion: approval.version,
          decisionId: "outsider",
          decision: "approve",
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await testbed.request(`/api/coordination/v1/threads/${one}/approvals/${approval.id}/decision`, "bob", "POST", {
          expectedVersion: approval.version,
          decisionId: "wrong-thread",
          decision: "approve",
        })
      ).status,
    ).not.toBe(200)
    const decisions = await Promise.all([
      testbed.request(decisionPath, "bob", "POST", {
        expectedVersion: approval.version,
        decisionId: "bob-approves",
        decision: "approve",
      }),
      testbed.request(decisionPath, "carol", "POST", {
        expectedVersion: approval.version,
        decisionId: "carol-rejects",
        decision: "reject",
      }),
    ])
    expect(decisions.map((item) => item.status).toSorted()).toEqual([200, 409])
    expect((await testbed.state()).decisions).toHaveLength(1)
    expect((await testbed.state()).decisions[0].runId).toBe(approvalRun.run.id)
    const winner = decisions.find((item) => item.status === 200)!
    const winnerId = (winner.data as { decisionId: string }).decisionId
    const decisionEvents = (await allEvents(testbed)).filter(
      (event) => event.kind === "run.approval.resolved" && event.payload.deliveryState === "pending",
    )
    expect(decisionEvents).toHaveLength(1)
    expect(decisionEvents[0].payload.decisionId).toBe(winnerId)
    expect(
      (
        await testbed.request(decisionPath, "alice", "POST", {
          expectedVersion: approval.version + 1,
          decisionId: "stale-decision",
          decision: "approve",
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await testbed.request(
          `/api/coordination/v1/threads/${two}/approvals/approval_missing/decision`,
          "alice",
          "POST",
          {
            expectedVersion: approval.version,
            decisionId: "wrong-action",
            decision: "approve",
          },
        )
      ).status,
    ).toBe(404)
    expect(
      (
        await testbed.request(decisionPath, winnerId === "bob-approves" ? "bob" : "carol", "POST", {
          expectedVersion: approval.version,
          decisionId: winnerId,
          decision: winnerId === "bob-approves" ? "approve" : "reject",
        })
      ).status,
    ).toBe(200)
    expect((await testbed.state()).decisions).toHaveLength(1)
    expect(
      (
        await testbed.callback(approvalRun.run.id, "approval-resume", {
          kind: "state",
          expectedState: "waiting_approval",
          nextState: "running",
        })
      ).first.status,
    ).toBe(200)
    expect(
      (
        await testbed.callback(approvalRun.run.id, "approval-complete", {
          kind: "state",
          expectedState: "running",
          nextState: "completed",
        })
      ).first.status,
    ).toBe(200)
    expect(good(await testbed.reserve(two)).run?.id).toBe(followup.run.id)
  } finally {
    await testbed.close()
  }
}, 120_000)

test("H: SIGKILL recovery, lost start acknowledgments, stable retry IDs, and stale owners", async () => {
  const testbed = await startHarness()
  try {
    const [one, two, three] = await shared(testbed, 3)
    const first = await submit(testbed, one, "alice", "crash-first", "Fixture held across crash")
    const second = await submit(testbed, one, "bob", "crash-second", "Fixture follows recovered run")
    const third = await submit(testbed, one, "carol", "crash-third", "Fixture accepted before dispatch")
    expect(good(await testbed.reserve(one)).run?.id).toBe(first.run.id)
    expect(
      (
        await testbed.callback(first.run.id, "crash-start", {
          kind: "state",
          expectedState: "reserved",
          nextState: "running",
        })
      ).first.status,
    ).toBe(200)
    const cursorBeforeCrash = (await testbed.snapshot(one)).cursor
    await testbed.restartCoordinator()
    expect((await testbed.snapshot(one)).runs.map((run) => run.state)).toEqual(["running", "queued", "queued"])
    expect(good(await testbed.reserve(one)).run).toBeFalsy()
    expect((await testbed.state()).starts.filter((command) => command.threadId === one)).toHaveLength(1)
    expect(
      (
        await testbed.request(`/api/coordination/v1/runner/runs/${first.run.id}/events`, "staleWorker", "POST", {
          callbackId: "stale-owner",
          callback: { kind: "state", expectedState: "running", nextState: "completed" },
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await testbed.callback(first.run.id, "crash-output", {
          kind: "activity",
          state: "running",
          activity: { kind: "run.output", text: "Fixture after restart" },
        })
      ).first.status,
    ).toBe(200)
    await testbed.admin("options", { dropCallbackAck: true })
    expect(
      (
        await testbed.callback(first.run.id, "crash-complete", {
          kind: "state",
          expectedState: "running",
          nextState: "completed",
        })
      ).first.status,
    ).toBe(503)
    expect(
      (
        await testbed.callback(first.run.id, "crash-complete", {
          kind: "state",
          expectedState: "running",
          nextState: "completed",
        })
      ).first.status,
    ).toBe(200)
    expect(
      (
        await testbed.callback(first.run.id, "stale-after-terminal", {
          kind: "state",
          expectedState: "running",
          nextState: "completed",
        })
      ).first.status,
    ).toBe(409)
    expect((await testbed.snapshot(one)).runs[0].state).toBe("completed")
    expect((await testbed.state()).callbacks.filter((item) => item.callbackId === "crash-complete")).toHaveLength(2)
    expect(
      (await allEvents(testbed)).filter((event) => event.kind === "run.completed" && event.runId === first.run.id),
    ).toHaveLength(1)
    expect(
      (await testbed.replay("prj_e2e_main", cursorBeforeCrash)).events.some(
        (event) => event.kind === "run.completed" && event.runId === first.run.id,
      ),
    ).toBe(true)
    expect(good(await testbed.reserve(one)).run?.id).toBe(second.run.id)
    expect(
      (
        await testbed.callback(second.run.id, "second-start", {
          kind: "state",
          expectedState: "reserved",
          nextState: "running",
        })
      ).first.status,
    ).toBe(200)
    expect(
      (
        await testbed.callback(second.run.id, "second-complete", {
          kind: "state",
          expectedState: "running",
          nextState: "completed",
        })
      ).first.status,
    ).toBe(200)
    await testbed.restartCoordinator()
    expect(good(await testbed.reserve(one)).run?.id).toBe(third.run.id)
    expect(
      (await testbed.state()).starts.filter((command) => command.threadId === one).map((command) => command.runId),
    ).toEqual([first.run.id, second.run.id, third.run.id])

    await testbed.admin("options", { dropStartAck: true })
    const ackLost = await submit(testbed, two, "dan", "ack-lost", "Fixture accepted start without ack")
    expect((await testbed.reserve(two)).status).toBe(503)
    expect((await testbed.state()).starts.filter((command) => command.runId === ackLost.run.id)).toHaveLength(1)
    await testbed.restartCoordinator()
    expect(good(await testbed.reserve(two)).run).toBeFalsy()
    expect((await testbed.state()).attempts.filter((command) => command.runId === ackLost.run.id)).toHaveLength(1)
    expect((await testbed.snapshot(two)).runs.find((run) => run.id === ackLost.run.id)?.state).toBe("reserved")

    await testbed.admin("options", { rejectStart: true })
    const rejected = await submit(testbed, three, "alice", "start-rejected", "Fixture retry with stable IDs")
    expect((await testbed.reserve(three)).status).toBe(503)
    expect((await testbed.state()).starts.filter((command) => command.runId === rejected.run.id)).toHaveLength(0)
    expect(good(await testbed.reserve(three)).run).toBeFalsy()
    const attempts = (await testbed.state()).attempts.filter((command) => command.runId === rejected.run.id)
    expect(attempts).toHaveLength(2)
    expect(new Set(attempts.map((command) => command.runnerMessageId)).size).toBe(1)
    expect((await testbed.state()).starts.filter((command) => command.runId === rejected.run.id)).toHaveLength(1)
  } finally {
    await testbed.close()
  }
}, 120_000)

test("I: versioned analysis cards and activity derive execution from Run state", async () => {
  const testbed = await startHarness()
  try {
    const [one, two, completedThread] = await shared(testbed, 3, true)
    const active = await submit(testbed, one, "alice", "card-active", "Fixture active turn")
    const queued = await submit(testbed, one, "bob", "card-queued", "Fixture queued turn")
    const otherActive = await submit(testbed, two, "dan", "card-other-active", "Fixture independent active turn")
    const old = await submit(testbed, completedThread, "carol", "card-old", "Fixture completed history")
    for (const [threadId, runId] of [
      [one, active.run.id],
      [two, otherActive.run.id],
      [completedThread, old.run.id],
    ]) {
      expect(good(await testbed.reserve(threadId)).run?.id).toBe(runId)
      expect(
        (
          await testbed.callback(runId, `${runId}:started`, {
            kind: "state",
            expectedState: "reserved",
            nextState: "running",
          })
        ).first.status,
      ).toBe(200)
    }
    expect(
      (
        await testbed.callback(active.run.id, "card-output", {
          kind: "activity",
          state: "running",
          activity: { kind: "run.output", text: "Fixture evidence" },
        })
      ).first.status,
    ).toBe(200)
    good(
      await testbed.request(`/api/coordination/v1/threads/${one}/comments`, "alice", "POST", {
        requestId: "card-source",
        body: "Fixture evidence for summary",
      }),
    )
    const evidence = (await allEvents(testbed)).findLast(
      (event) => event.kind === "comment.created" && event.threadId === one,
    )!
    const sourceActivitySeq = (await testbed.snapshot(one)).thread.activitySeq
    const card = {
      currentTask: "Fixture review",
      progress: "Summary says done while Run remains active",
      blockers: [],
      status: "done",
      summaryJobId: "fixture-job-1",
      recentVerifiedOutcome: "Fixture output cited",
      contributors: ["usr_alice", "usr_bob"],
      evidenceRefs: [{ threadId: one, eventId: evidence.id, seq: evidence.seq }],
      generatedAt: new Date().toISOString(),
    }
    const endpoint = `/api/coordination/v1/threads/${one}/work-card`
    const update = { expectedVersion: 0, sourceActivitySeq, card }
    expect(good(await testbed.request<{ version: number }>(endpoint, "analysis", "PUT", update)).version).toBe(1)
    expect(good(await testbed.request<{ version: number }>(endpoint, "analysis", "PUT", update)).version).toBe(1)
    expect(
      (
        await testbed.request(endpoint, "analysis", "PUT", {
          ...update,
          card: { ...card, progress: "Conflicting result" },
        })
      ).status,
    ).toBe(409)
    expect((await testbed.request(endpoint, "eve", "PUT", update)).status).toBe(403)
    expect((await testbed.request(endpoint, "alice", "PUT", update)).status).toBe(403)
    expect(
      (
        await testbed.request(endpoint, "analysis", "PUT", {
          expectedVersion: 1,
          sourceActivitySeq,
          card: {
            ...card,
            summaryJobId: "invalid-evidence",
            evidenceRefs: [{ threadId: one, eventId: "evt_missing", seq: evidence.seq }],
          },
        })
      ).status,
    ).toBe(400)
    const crossEvidence = (await allEvents(testbed, "prj_e2e_other", "dan")).find((event) => event.threadId)!
    expect(
      (
        await testbed.request(endpoint, "analysis", "PUT", {
          expectedVersion: 1,
          sourceActivitySeq,
          card: {
            ...card,
            summaryJobId: "cross-evidence",
            evidenceRefs: [{ threadId: one, eventId: crossEvidence.id, seq: crossEvidence.seq }],
          },
        })
      ).status,
    ).toBe(400)
    good(
      await testbed.request(`/api/coordination/v1/threads/${one}/comments`, "bob", "POST", {
        requestId: "new-card-evidence",
        body: "Newer source fixture",
      }),
    )
    const latest = (await allEvents(testbed)).findLast(
      (event) => event.kind === "comment.created" && event.threadId === one,
    )!
    const newerSeq = (await testbed.snapshot(one)).thread.activitySeq
    expect(
      good(
        await testbed.request<{ version: number }>(endpoint, "analysis", "PUT", {
          expectedVersion: 1,
          sourceActivitySeq: newerSeq,
          card: {
            ...card,
            status: "active",
            summaryJobId: "fixture-job-2",
            evidenceRefs: [{ threadId: one, eventId: latest.id, seq: latest.seq }],
          },
        }),
      ).version,
    ).toBe(2)
    expect(
      (
        await testbed.request(endpoint, "analysis", "PUT", {
          expectedVersion: 2,
          sourceActivitySeq,
          card: { ...card, summaryJobId: "older-source" },
        })
      ).status,
    ).toBe(409)
    const activity = good(
      await testbed.request<{
        workingNow: Array<{ runId: string | null; status: string; startedAt: string | null }>
        upNext: Array<{ id: string; status: string }>
        recent: Array<{ sourceThread: { threadId: string } | null }>
      }>("/api/coordination/v1/projects/prj_e2e_main/activity", "bob"),
    )
    expect(activity.workingNow.map((item) => item.runId)).toContain(active.run.id)
    expect(activity.workingNow.map((item) => item.runId)).toContain(otherActive.run.id)
    expect(activity.workingNow.find((item) => item.runId === active.run.id)?.status).toBe("running")
    expect(activity.workingNow.map((item) => item.runId)).not.toContain(queued.run.id)
    expect(activity.upNext.map((item) => item.id)).toContain(queued.instruction.id)

    expect(
      (
        await testbed.callback(old.run.id, "old-complete", {
          kind: "state",
          expectedState: "running",
          nextState: "completed",
        })
      ).first.status,
    ).toBe(200)
    // Only this disposable fixture's clock fields are moved. The HTTP read path and journal stay real.
    const sqlite = new Database(testbed.dbPath)
    const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    sqlite.query("UPDATE coordination_run SET started_at = ? WHERE id = ?").run(Date.parse(oldTime), active.run.id)
    sqlite
      .query("UPDATE event SET data = json_set(data, '$.occurredAt', ?) WHERE json_extract(data, '$.threadId') = ?")
      .run(oldTime, completedThread)
    sqlite.close()
    const later = good(
      await testbed.request<typeof activity>("/api/coordination/v1/projects/prj_e2e_main/activity", "bob"),
    )
    expect(later.workingNow.find((item) => item.runId === active.run.id)?.startedAt).toBe(oldTime)
    expect(later.recent.some((item) => item.sourceThread?.threadId === completedThread)).toBe(false)
  } finally {
    await testbed.close()
  }
}, 120_000)

test("I regression: runner output must advance the citable activity revision", async () => {
  const testbed = await startHarness()
  try {
    const [thread] = await shared(testbed, 1)
    const submitted = await submit(testbed, thread, "alice", "output-citation", "Fixture output citation")
    expect(good(await testbed.reserve(thread)).run?.id).toBe(submitted.run.id)
    expect(
      (
        await testbed.callback(submitted.run.id, "citation-start", {
          kind: "state",
          expectedState: "reserved",
          nextState: "running",
        })
      ).first.status,
    ).toBe(200)
    expect(
      (
        await testbed.callback(submitted.run.id, "citation-output", {
          kind: "activity",
          state: "running",
          activity: { kind: "run.output", text: "Fixture output to cite" },
        })
      ).first.status,
    ).toBe(200)
    const output = (await allEvents(testbed)).find(
      (event) => event.kind === "run.output" && event.runId === submitted.run.id,
    )!
    const activitySeq = (await testbed.snapshot(thread)).thread.activitySeq
    expect(output.seq).toBeLessThanOrEqual(activitySeq)
    const response = await testbed.request(`/api/coordination/v1/threads/${thread}/work-card`, "analysis", "PUT", {
      expectedVersion: 0,
      sourceActivitySeq: activitySeq,
      card: {
        currentTask: "Fixture citation",
        progress: "Runner output cited",
        blockers: [],
        status: "active",
        summaryJobId: "fixture-output-citation",
        recentVerifiedOutcome: "Fixture output to cite",
        contributors: ["usr_alice"],
        evidenceRefs: [{ threadId: thread, eventId: output.id, seq: output.seq }],
        generatedAt: new Date().toISOString(),
      },
    })
    expect(response.status).toBe(200)
  } finally {
    await testbed.close()
  }
}, 120_000)

test("J: seeded 4-user, 20-thread, 100-instruction drain with duplicate delivery", async () => {
  const seed = 0x00c0ffee
  console.log(`COORDINATION_STRESS_SEED ${seed}`)
  const testbed = await startHarness()
  try {
    const threads = await shared(testbed, 20)
    const tasks = threads.flatMap((threadId, threadIndex) =>
      Array.from({ length: 5 }, (_, turnIndex) => ({ threadId, threadIndex, turnIndex })),
    )
    let random = seed
    const nextRandom = () => {
      random ^= random << 13
      random ^= random >>> 17
      random ^= random << 5
      return random >>> 0
    }
    const shuffled = tasks
      .map((task) => ({ task, order: nextRandom() }))
      .toSorted((left, right) => left.order - right.order)
      .map((item) => item.task)
    const actors = ["alice", "bob", "carol", "dan"] as const
    const accepted: Array<{ threadId: string; requestId: string; text: string; user: User; instructionId: string }> = []
    for (let offset = 0; offset < shuffled.length; offset += 10) {
      const batch = await Promise.all(
        shuffled.slice(offset, offset + 10).map(async (task) => {
          const user = actors[(task.threadIndex + task.turnIndex) % actors.length]
          const requestId = `seed-${seed}-${task.threadIndex}-${task.turnIndex}`
          const text = `Fixture instruction ${task.threadIndex}/${task.turnIndex}`
          const result = await submit(testbed, task.threadId, user, requestId, text)
          return { threadId: task.threadId, requestId, text, user, instructionId: result.instruction.id }
        }),
      )
      accepted.push(...batch)
    }
    expect(accepted).toHaveLength(100)
    for (const item of accepted.slice(0, 10))
      expect((await submit(testbed, item.threadId, item.user, item.requestId, item.text)).instruction.id).toBe(
        item.instructionId,
      )
    const ordered = await Promise.all(threads.map((threadId) => testbed.snapshot(threadId)))
    expect(ordered.every((snapshot) => snapshot.instructions.length === 5)).toBe(true)
    const cancelled = ordered.slice(0, 5).map((snapshot) => snapshot.instructions.at(-1)!)
    const cancelledIds = new Set(cancelled.map((instruction) => instruction.runId))
    for (const instruction of cancelled)
      expect(
        good(
          await testbed.request(
            `/api/coordination/v1/threads/${instruction.threadId}/instructions/${instruction.id}/cancel`,
            "alice",
            "POST",
          ),
        ).state,
      ).toBe("cancelled")
    await testbed.admin("options", { autoStart: true, autoPoll: true })
    const initial = await Promise.all(threads.map((threadId) => testbed.reserve(threadId)))
    expect(initial.every((result) => result.status === 200 && result.data.run)).toBe(true)
    await Promise.all(threads.map((threadId, index) => running(testbed, threadId, ordered[index].runs[0].id, 25_000)))
    expect((await testbed.state()).starts).toHaveLength(20)
    expect((await testbed.state()).executions).toHaveLength(20)
    await testbed.admin("options", { connected: false })
    const disconnectedRun = ordered[0].runs[0].id
    expect(
      (
        await testbed.callback(disconnectedRun, `${disconnectedRun}:completed`, {
          kind: "state",
          expectedState: "running",
          nextState: "completed",
        })
      ).first.status,
    ).toBe(200)
    await until(
      () => testbed.state(),
      (state) => state.polls.some((poll) => poll.threadId === threads[0] && poll.status === 503),
      "failed worker poll after disconnect",
    )
    expect((await testbed.snapshot(threads[0])).runs[1].state).toBe("queued")
    await testbed.admin("options", { connected: true })
    expect(good(await testbed.reserve(threads[0])).run?.id).toBe(ordered[0].runs[1].id)
    await running(testbed, threads[0], ordered[0].runs[1].id, 25_000)
    for (let turn = 0; turn < 5; turn++) {
      const current = ordered.flatMap((snapshot, index) => {
        const run = snapshot.runs[turn]
        if (cancelledIds.has(run.id) || run.id === disconnectedRun) return []
        return [{ threadId: threads[index], runId: run.id, index }]
      })
      const results = await Promise.all(
        current.map((item) =>
          testbed.callback(
            item.runId,
            `${item.runId}:completed`,
            {
              kind: "state",
              expectedState: "running",
              nextState: "completed",
            },
            item.index % 10 === 0,
          ),
        ),
      )
      expect(results.every((result) => result.first.status === 200)).toBe(true)
      if (turn < 4)
        await Promise.all(
          ordered.flatMap((snapshot, index) => {
            const run = snapshot.runs[turn + 1]
            return cancelledIds.has(run.id) ? [] : [running(testbed, threads[index], run.id, 25_000)]
          }),
        )
    }
    const fake = await testbed.state()
    expect(fake.starts).toHaveLength(95)
    expect(new Set(fake.starts.map((command) => command.runId)).size).toBe(95)
    for (const [index, threadId] of threads.entries()) {
      const snapshot = await testbed.snapshot(threadId)
      expect(snapshot.runs.every((run) => ["completed", "cancelled"].includes(run.state))).toBe(true)
      const expected = snapshot.instructions
        .filter((instruction) => snapshot.runs.find((run) => run.id === instruction.runId)?.state === "completed")
        .map((instruction) => instruction.runId)
      expect(fake.starts.filter((command) => command.threadId === threadId).map((command) => command.runId)).toEqual(
        expected,
      )
      expect(fake.starts.filter((command) => command.threadId === threadId).length).toBe(index < 5 ? 4 : 5)
    }
    const events = await allEvents(testbed)
    expect(events.filter((event) => event.kind === "instruction.submitted")).toHaveLength(100)
    expect(events.filter((event) => event.kind === "run.completed")).toHaveLength(95)
    expect(events.filter((event) => event.kind === "instruction.cancelled")).toHaveLength(5)
    expect(new Set(events.map((event) => event.id)).size).toBe(events.length)
    const projected = new Map<string, string>()
    const occupied = new Map<string, string>()
    for (const event of events) {
      if (event.kind === "run.started" && event.threadId && event.runId) {
        expect(occupied.has(event.threadId), `overlap at event ${event.seq}`).toBe(false)
        occupied.set(event.threadId, event.runId)
        projected.set(event.runId, "running")
      }
      if (["run.completed", "run.failed", "run.cancelled"].includes(event.kind) && event.threadId && event.runId) {
        expect(occupied.get(event.threadId)).toBe(event.runId)
        occupied.delete(event.threadId)
        projected.set(event.runId, event.kind.slice(4))
      }
      if (event.kind === "instruction.cancelled" && event.runId) projected.set(event.runId, "cancelled")
    }
    expect(occupied.size).toBe(0)
    for (const threadId of threads) {
      const snapshot = await testbed.snapshot(threadId)
      expect(
        new Set(
          events
            .filter((event) => event.kind === "instruction.submitted" && event.threadId === threadId)
            .map((event) => event.instructionId),
        ),
      ).toEqual(new Set(snapshot.instructions.map((instruction) => instruction.id)))
      snapshot.runs.forEach((run) => expect(projected.get(run.id)).toBe(run.state))
    }
    expect((await testbed.request(`/api/coordination/v1/threads/${threads[0]}`, "eve")).status).toBe(403)
    console.log(
      `COORDINATION_STRESS_RESULT ${JSON.stringify({ seed, threads: threads.length, accepted: accepted.length, starts: fake.starts.length, events: events.length })}`,
    )
  } finally {
    await testbed.close()
  }
}, 180_000)
