import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Context } from "effect"

type TestData = {
  id: string
  userId: string
  instruction: { id: string; queueSeq: number }
  run: { id: string }
  thread: { activitySeq: number }
  workCard?: { version: number }
  runs: Array<{ state: string }>
  approvals: Array<{ id: string; version: number }>
  events: Array<{ id: string; seq: number; kind: string }>
  cursor: number
  workingNow: ReadonlyArray<unknown>
  upNext: ReadonlyArray<unknown>
  version: number
  length: number
}

test("two members share queued turns, replay, approval, activity, and stale-card rejection with the mock runner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-coordination-http-"))
  const dbPath = join(directory, "opencode.sqlite")
  const identitiesPath = join(directory, "identities.json")
  const admissionsPath = join(directory, "admissions.json")
  const projectId = "prj_coordination_http"
  const workerId = "wrk_coordination_http"
  const instanceId = "local-mock"
  const people = [
    { username: "alice", password: "alice-secret", auth: { kind: "member", userId: "usr_alice" } },
    { username: "bob", password: "bob-secret", auth: { kind: "member", userId: "usr_bob" } },
    { username: "eve", password: "eve-secret", auth: { kind: "member", userId: "usr_eve" } },
    { username: "worker", password: "worker-secret", auth: { kind: "runner", workerId, instanceId } },
    { username: "analysis", password: "analysis-secret", auth: { kind: "analysis", serviceId: "jev-test" } },
  ]
  await Bun.write(
    identitiesPath,
    JSON.stringify({
      identities: await Promise.all(
        people.map(async (person) => ({
          username: person.username,
          passwordHash: await Bun.password.hash(person.password),
          auth: person.auth,
        })),
      ),
    }),
  )
  await Bun.write(admissionsPath, JSON.stringify({ allowed: [{ userId: "usr_alice", projectId }] }))
  process.env.OPENCODE_DB = dbPath
  process.env.OPENCODE_COORDINATION_IDENTITIES_PATH = identitiesPath
  process.env.OPENCODE_COORDINATION_ADMISSIONS_PATH = admissionsPath
  process.env.OPENCODE_COORDINATION_MOCK_RUNNER = "1"
  process.env.OPENCODE_COORDINATION_MOCK_WORKER_ID = workerId
  process.env.OPENCODE_COORDINATION_MOCK_INSTANCE_ID = instanceId

  const { webHandler } = await import("../src/routes")
  let app = webHandler()
  const context = Context.empty() as Parameters<typeof app.handler>[1]
  const request = async (path: string, person?: string, method = "GET", payload?: unknown) => {
    const account = people.find((item) => item.username === person)
    const headers = new Headers()
    if (account)
      headers.set("authorization", `Basic ${Buffer.from(`${account.username}:${account.password}`).toString("base64")}`)
    if (payload !== undefined) headers.set("content-type", "application/json")
    const response = await app.handler(
      new Request(`http://localhost${path}`, {
        method,
        headers,
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      }),
      context,
    )
    const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : undefined
    return { response, data: data as TestData | undefined }
  }

  try {
    expect((await request("/api/health")).response.status).toBe(200)
    const sqlite = new Database(dbPath)
    const now = Date.now()
    sqlite
      .query("INSERT INTO project (id, worktree, sandboxes, time_created, time_updated) VALUES (?, ?, ?, ?, ?)")
      .run(projectId, directory, "[]", now, now)
    for (const id of ["ses_coordination_one", "ses_coordination_two"])
      sqlite
        .query(
          "INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(id, projectId, id, directory, id, "test", now, now)
    sqlite.close()

    expect((await request("/api/coordination/v1/status")).response.status).toBe(200)
    const withoutIdentity = await request("/api/coordination/v1/projects")
    expect(withoutIdentity.response.status).toBe(401)
    expect(withoutIdentity.response.headers.get("www-authenticate")).toContain("Coordination")
    const sharedAccount = await app.handler(
      new Request("http://localhost/api/coordination/v1/projects", {
        headers: { authorization: `Basic ${Buffer.from("opencode:shared-secret").toString("base64")}` },
      }),
      context,
    )
    expect(sharedAccount.status).toBe(401)
    const impersonated = await request("/api/coordination/v1/projects", "eve", "POST", {
      projectId,
      name: "shared",
      requestId: "claim-eve",
      userId: "usr_alice",
    })
    expect(impersonated.response.status).toBe(403)
    const created = await request("/api/coordination/v1/projects", "alice", "POST", {
      projectId,
      name: "shared",
      requestId: "create-project",
    })
    expect(created.response.status).toBe(200)
    expect(created.data?.id).toBe(projectId)
    const member = await request(`/api/coordination/v1/projects/${projectId}/members`, "alice", "POST", {
      targetUserId: "usr_bob",
      requestId: "add-bob",
    })
    expect(member.response.status).toBe(200)
    expect(member.data?.userId).toBe("usr_bob")
    const threads = [] as string[]
    for (const [index, sessionId] of ["ses_coordination_one", "ses_coordination_two"].entries()) {
      const result = await request(`/api/coordination/v1/projects/${projectId}/threads`, "alice", "POST", {
        sessionId,
        title: `Thread ${index + 1}`,
        requestId: `share-${index + 1}`,
      })
      expect(result.response.status).toBe(200)
      threads.push(result.data!.id)
    }
    expect((await request(`/api/coordination/v1/threads/${threads[0]}`, "bob")).response.status).toBe(200)
    expect((await request(`/api/coordination/v1/threads/${threads[0]}`, "eve")).response.status).toBe(403)
    expect(
      (await request(`/api/coordination/v1/threads/${threads[0]}/events/stream?after=-1`, "eve")).response.status,
    ).toBe(403)
    expect(
      (await request(`/api/coordination/v1/threads/${threads[0]}/events/stream?after=-2`, "bob")).response.status,
    ).toBe(400)

    const submissions = await Promise.all([
      request(`/api/coordination/v1/threads/${threads[0]}/instructions`, "alice", "POST", {
        requestId: "first",
        text: "First turn [approval]",
      }),
      request(`/api/coordination/v1/threads/${threads[0]}/instructions`, "bob", "POST", {
        requestId: "second",
        text: "Second turn",
      }),
    ])
    expect(submissions.map((item) => item.response.status)).toEqual([200, 200])
    expect(submissions.map((item) => item.data!.instruction.queueSeq).toSorted()).toEqual([1, 2])
    const other = await request(`/api/coordination/v1/threads/${threads[1]}/instructions`, "bob", "POST", {
      requestId: "other",
      text: "Other thread [approval]",
    })
    expect(other.response.status).toBe(200)
    const first = submissions.find((item) => item.data!.instruction.queueSeq === 1)!
    const reserved = await request(`/api/coordination/v1/runner/threads/${threads[0]}/reserve`, "worker", "POST")
    expect(reserved.response.status).toBe(200)
    expect(reserved.data?.run?.id).toBe(first.data?.run.id)
    const reservedOther = await request(`/api/coordination/v1/runner/threads/${threads[1]}/reserve`, "worker", "POST")
    expect(reservedOther.response.status).toBe(200)
    expect(reservedOther.data?.run?.id).toBe(other.data?.run.id)

    const snapshot = async (threadId: string) =>
      (await request(`/api/coordination/v1/threads/${threadId}`, "alice")).data!
    const waitFor = async (threadId: string, state: string) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const value = await snapshot(threadId)
        if (value.runs?.some((run: { state: string }) => run.state === state)) return value
        await Bun.sleep(20)
      }
      throw new Error(`Run did not reach ${state}`)
    }
    const [waiting, waitingOther] = await Promise.all([
      waitFor(threads[0], "waiting_approval"),
      waitFor(threads[1], "waiting_approval"),
    ])
    expect(waiting.approvals.length).toBe(1)
    expect(waitingOther.approvals.length).toBe(1)
    const activity = await request(`/api/coordination/v1/projects/${projectId}/activity`, "bob")
    expect(activity.response.status).toBe(200)
    expect(activity.data?.workingNow.length).toBe(2)
    expect(activity.data?.upNext.length).toBe(1)

    const replay = await request(`/api/coordination/v1/threads/${threads[0]}/events?after=-1`, "bob")
    expect(replay.response.status).toBe(200)
    expect(replay.data?.events.some((event: { kind: string }) => event.kind === "run.tool")).toBe(true)
    const cursor = replay.data!.cursor
    const live = await request(`/api/coordination/v1/threads/${threads[0]}/events/stream?after=${cursor}`, "bob")
    expect(live.response.status).toBe(200)
    const reader = live.response.body!.getReader()
    const nextEvent = reader.read()
    const comment = await request(`/api/coordination/v1/threads/${threads[0]}/comments`, "bob", "POST", {
      requestId: "comment-one",
      body: "I can see the tool step",
    })
    expect(comment.response.status).toBe(200)
    let frames = ""
    for (let attempt = 0; attempt < 5 && !frames.includes("comment.created"); attempt++) {
      const chunk = await Promise.race([
        attempt === 0 ? nextEvent : reader.read(),
        Bun.sleep(2_000).then(() => {
          throw new Error("SSE event did not arrive")
        }),
      ])
      frames += new TextDecoder().decode(chunk.value)
    }
    expect(frames).toContain("comment.created")
    expect(frames).toContain("id:")
    await reader.cancel()
    const reconnect = await request(`/api/coordination/v1/threads/${threads[0]}/events?after=${cursor}`, "alice")
    expect(reconnect.response.status).toBe(200)
    expect(reconnect.data?.events[0].kind).toBe("comment.created")

    const evidence = reconnect.data!.events[0]
    const current = await snapshot(threads[0])
    const card = {
      currentTask: "Finish shared thread",
      progress: "Approval pending",
      blockers: [],
      status: "blocked",
      summaryJobId: "summary-1",
      recentVerifiedOutcome: "Bob saw the tool step",
      contributors: ["usr_alice", "usr_bob"],
      evidenceRefs: [{ threadId: threads[0], eventId: evidence.id, seq: evidence.seq }],
      generatedAt: new Date().toISOString(),
    }
    const updated = await request(`/api/coordination/v1/threads/${threads[0]}/work-card`, "analysis", "PUT", {
      expectedVersion: 0,
      sourceActivitySeq: current.thread.activitySeq,
      card,
    })
    expect(updated.response.status).toBe(200)
    expect(updated.data?.version).toBe(1)
    expect((await request(`/api/coordination/v1/projects/${projectId}/work-cards`, "bob")).data?.length).toBe(1)

    const approvalId = waiting.approvals[0].id
    const decision = await request(
      `/api/coordination/v1/threads/${threads[0]}/approvals/${approvalId}/decision`,
      "bob",
      "POST",
      {
        expectedVersion: waiting.approvals[0].version,
        decisionId: "decision-1",
        decision: "approve",
      },
    )
    expect(decision.response.status).toBe(200)
    await waitFor(threads[0], "completed")
    expect(
      (
        await request(`/api/coordination/v1/threads/${threads[0]}/comments`, "alice", "POST", {
          requestId: "comment-after-card",
          body: "The approval is complete",
        })
      ).response.status,
    ).toBe(200)
    const stale = await request(`/api/coordination/v1/threads/${threads[0]}/work-card`, "analysis", "PUT", {
      expectedVersion: 1,
      sourceActivitySeq: current.thread.activitySeq,
      card: { ...card, summaryJobId: "summary-stale" },
    })
    expect(stale.response.status).toBe(409)

    const cancelled = await request(
      `/api/coordination/v1/threads/${threads[1]}/instructions/${other.data!.instruction.id}/cancel`,
      "bob",
      "POST",
    )
    expect(cancelled.response.status).toBe(200)
    await waitFor(threads[1], "cancelled")
    const secondReserve = await request(`/api/coordination/v1/runner/threads/${threads[0]}/reserve`, "worker", "POST")
    expect(secondReserve.response.status).toBe(200)
    await waitFor(threads[0], "completed")
    await app.dispose()
    app = webHandler()
    const restored = await snapshot(threads[0])
    expect(restored.runs.filter((run: { state: string }) => run.state === "completed").length).toBe(2)
    expect(restored.workCard?.version).toBe(1)
    const restoredReplay = await request(`/api/coordination/v1/threads/${threads[0]}/events?after=${cursor}`, "bob")
    expect(restoredReplay.response.status).toBe(200)
    expect(restoredReplay.data?.events.some((event) => event.kind === "comment.created")).toBe(true)
  } finally {
    await app.dispose()
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
