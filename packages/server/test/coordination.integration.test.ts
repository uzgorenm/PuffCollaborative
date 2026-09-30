import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Context } from "effect"

type TestData = {
  ready?: boolean
  id: string
  userId: string
  ownerId?: string
  analysisEnabled?: boolean
  analysisTextEnabled?: boolean
  awarenessMode?: string
  snapshot?: {
    workers: Array<{ workerId: string; projectId: string; ownerId?: string }>
    sharedSessions: Array<{ ownerId: string }>
    events: Array<{ kind: string; content: Record<string, unknown> }>
  }
  cooperationVersions?: Record<string, number>
  sourceActivitySeq?: number
  provenance?: Array<{ threadId: string; eventId: string; eventSeq: number; threadActivitySeq: number }>
  instruction: { id: string; queueSeq: number }
  run: { id: string }
  thread: { activitySeq: number }
  workCard?: { version: number }
  runs: Array<{ id: string; state: string }>
  approvals: Array<{ id: string; version: number }>
  events: Array<{ id: string; seq: number; kind: string }>
  cursor: number
  workingNow: ReadonlyArray<unknown>
  upNext: ReadonlyArray<unknown>
  version: number
  length: number
  brief?: { version: number; goal: string; updatedBy: string }
  goal?: string
  text?: string | null
  updatedBy?: string
}

test("two members share queued turns, replay, approval, activity, and stale-card rejection with the mock runner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-coordination-http-"))
  const dbPath = join(directory, "opencode.sqlite")
  const identitiesPath = join(directory, "identities.json")
  const admissionsPath = join(directory, "admissions.json")
  const selectionsPath = join(directory, "selections.json")
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
  await Bun.write(
    selectionsPath,
    JSON.stringify({
      allowed: ["ses_coordination_one", "ses_coordination_two"]
        .map((sessionId) => ({
          userId: "usr_alice",
          projectId,
          sessionId,
          workerId,
        }))
        .concat({ userId: "usr_alice", projectId, sessionId: "ses_coordination_three", workerId: "wrong-worker" }),
    }),
  )
  process.env.OPENCODE_DB = dbPath
  process.env.OPENCODE_COORDINATION_IDENTITIES_PATH = identitiesPath
  process.env.OPENCODE_COORDINATION_ADMISSIONS_PATH = admissionsPath
  process.env.OPENCODE_COORDINATION_DEV_SESSION_SELECTIONS_PATH = selectionsPath
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
    for (const id of ["ses_coordination_one", "ses_coordination_two", "ses_coordination_three"])
      sqlite
        .query(
          "INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(id, projectId, id, directory, id, "test", now, now)
    sqlite.close()

    expect((await request("/api/coordination/v1/status")).response.status).toBe(200)
    expect((await request("/api/coordination/v1/me", "alice")).data as unknown).toEqual({ userId: "usr_alice" })
    expect((await request("/api/coordination/v1/me", "worker")).response.status).toBe(403)
    expect((await request("/api/coordination/v1/provisioning", "alice")).data as unknown).toEqual({
      projects: [],
      privateSessions: false,
    })
    expect(
      (
        await request(`/api/coordination/v1/projects/${projectId}/sessions`, "alice", "POST", {
          requestId: "new-session",
          title: "No provider",
        })
      ).response.status,
    ).toBe(503)
    expect(
      (
        await request(`/api/coordination/v1/projects/${projectId}/sessions`, "worker", "POST", {
          requestId: "not-a-member",
          title: "Denied",
        })
      ).response.status,
    ).toBe(403)
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
    const briefPath = `/api/coordination/v1/projects/${projectId}/brief`
    const focusPath = `/api/coordination/v1/projects/${projectId}/focus`
    const brief = {
      goal: "Compare the two navigation approaches",
      successCriteria: ["Keyboard focus stays visible"],
      roles: [
        { userId: "usr_alice", label: "Coordinator" },
        { userId: "usr_bob", label: "Reviewer" },
      ],
      tools: ["OpenCode"],
      sharingDefault: "private",
      suggestedAwarenessMode: "review-each-note",
    }
    expect((await request(briefPath, "eve")).response.status).toBe(403)
    expect(
      (await request(briefPath, "bob", "PUT", { requestId: "non-owner", expectedVersion: 0, content: brief })).response
        .status,
    ).toBe(403)
    const savedBrief = await request(briefPath, "alice", "PUT", {
      requestId: "brief-1",
      expectedVersion: 0,
      content: brief,
    })
    expect(savedBrief.response.status).toBe(200)
    expect(savedBrief.data?.version).toBe(1)
    expect(savedBrief.data?.updatedBy).toBe("usr_alice")
    expect((await request(briefPath, "bob")).data?.brief?.goal).toBe(brief.goal)
    expect(
      (await request(briefPath, "alice", "PUT", { requestId: "brief-1", expectedVersion: 0, content: brief })).data
        ?.version,
    ).toBe(1)
    expect(
      (
        await request(briefPath, "alice", "PUT", {
          requestId: "brief-1",
          expectedVersion: 0,
          content: { ...brief, goal: "Changed" },
        })
      ).response.status,
    ).toBe(409)
    expect(
      (await request(briefPath, "alice", "PUT", { requestId: "brief-stale", expectedVersion: 0, content: brief }))
        .response.status,
    ).toBe(409)
    const savedFocus = await request(`${focusPath}/me`, "bob", "PUT", {
      requestId: "focus-1",
      expectedVersion: 0,
      text: "Reviewing focus behavior",
      userId: "usr_alice",
    })
    expect(savedFocus.response.status).toBe(200)
    expect(savedFocus.data?.userId).toBe("usr_bob")
    expect(savedFocus.data?.version).toBe(1)
    expect((await request(focusPath, "alice")).data as unknown).toEqual([savedFocus.data])
    expect((await request(focusPath, "eve")).response.status).toBe(403)
    expect(
      (
        await request(`${focusPath}/me`, "eve", "PUT", {
          requestId: "focus-eve",
          expectedVersion: 0,
          text: "Not a member",
        })
      ).response.status,
    ).toBe(403)
    expect(
      (
        await request(`${focusPath}/me`, "bob", "PUT", {
          requestId: "focus-1",
          expectedVersion: 0,
          text: "Reviewing focus behavior",
        })
      ).data?.version,
    ).toBe(1)
    expect(
      (await request(`${focusPath}/me`, "bob", "PUT", { requestId: "focus-stale", expectedVersion: 0, text: "Stale" }))
        .response.status,
    ).toBe(409)
    const contextEvents = await request(`/api/coordination/v1/projects/${projectId}/events?after=-1`, "alice")
    expect(contextEvents.data?.events.filter((event) => event.kind === "project.brief.updated")).toHaveLength(1)
    expect(contextEvents.data?.events.filter((event) => event.kind === "person.focus.updated")).toHaveLength(1)
    const unselected = await request(`/api/coordination/v1/projects/${projectId}/threads`, "bob", "POST", {
      sessionId: "ses_coordination_one",
      title: "Forged selection",
      requestId: "bob-share-unselected",
      selectedBy: "usr_alice",
      workerId,
    })
    expect(unselected.response.status).toBe(403)
    const wrongWorker = await request(`/api/coordination/v1/projects/${projectId}/threads`, "alice", "POST", {
      sessionId: "ses_coordination_three",
      title: "Wrong worker grant",
      requestId: "share-wrong-worker",
    })
    expect(wrongWorker.response.status).toBe(403)
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
        text: "Second turn [approval]",
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
    const second = submissions.find((item) => item.data!.instruction.queueSeq === 2)!
    const reserved = await request(`/api/coordination/v1/runner/threads/${threads[0]}/reserve`, "worker", "POST")
    expect(reserved.response.status).toBe(200)
    expect(reserved.data?.run?.id).toBe(first.data?.run.id)
    const reservedOther = await request(`/api/coordination/v1/runner/threads/${threads[1]}/reserve`, "worker", "POST")
    expect(reservedOther.response.status).toBe(200)
    expect(reservedOther.data?.run?.id).toBe(other.data?.run.id)

    const snapshot = async (threadId: string) =>
      (await request(`/api/coordination/v1/threads/${threadId}`, "alice")).data!
    const waitFor = async (threadId: string, state: string, runId: string) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const value = await snapshot(threadId)
        if (value.runs?.some((run) => run.id === runId && run.state === state)) return value
        await Bun.sleep(20)
      }
      throw new Error(`Run ${runId} did not reach ${state}`)
    }
    const [waiting, waitingOther] = await Promise.all([
      waitFor(threads[0], "waiting_approval", first.data!.run.id),
      waitFor(threads[1], "waiting_approval", other.data!.run.id),
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
    await waitFor(threads[0], "completed", first.data!.run.id)
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
    await waitFor(threads[1], "cancelled", other.data!.run.id)
    const secondReserve = await request(`/api/coordination/v1/runner/threads/${threads[0]}/reserve`, "worker", "POST")
    expect(secondReserve.response.status).toBe(200)
    expect(secondReserve.data?.run?.id).toBe(second.data?.run.id)
    const secondWaiting = await waitFor(threads[0], "waiting_approval", second.data!.run.id)
    const secondApproval = secondWaiting.approvals.find((item) => item.id !== approvalId)!
    expect(secondApproval).toBeDefined()
    const secondDecision = await request(
      `/api/coordination/v1/threads/${threads[0]}/approvals/${secondApproval.id}/decision`,
      "alice",
      "POST",
      {
        expectedVersion: secondApproval.version,
        decisionId: "decision-2",
        decision: "approve",
      },
    )
    expect(secondDecision.response.status).toBe(200)
    await waitFor(threads[0], "completed", second.data!.run.id)
    await app.dispose()
    delete process.env.OPENCODE_COORDINATION_DEV_SESSION_SELECTIONS_PATH
    app = webHandler()
    const statusWithoutSelection = await request("/api/coordination/v1/status")
    expect(statusWithoutSelection.response.status).toBe(200)
    expect(statusWithoutSelection.data?.ready).toBe(true)
    const restored = await snapshot(threads[0])
    expect(restored.runs.filter((run: { state: string }) => run.state === "completed").length).toBe(2)
    expect(restored.workCard?.version).toBe(1)
    expect((await request(briefPath, "bob")).data?.brief?.version).toBe(1)
    expect((await request(focusPath, "alice")).data as unknown).toEqual([savedFocus.data])
    const restoredReplay = await request(`/api/coordination/v1/threads/${threads[0]}/events?after=${cursor}`, "bob")
    expect(restoredReplay.response.status).toBe(200)
    expect(restoredReplay.data?.events.some((event) => event.kind === "comment.created")).toBe(true)
    expect((await request(`/api/coordination/v1/threads/${threads[0]}`, "bob")).response.status).toBe(200)
    expect(
      (
        await request(`/api/coordination/v1/projects/${projectId}/threads`, "alice", "POST", {
          sessionId: "ses_coordination_three",
          title: "No selection source",
          requestId: "share-after-grant-removed",
        })
      ).response.status,
    ).toBe(403)
    const ownerDb = new Database(dbPath)
    const ownerInsert = ownerDb.query(`INSERT INTO coordination_session_provisioning
      (id, project_id, owner_id, request_id, title, worker_id, session_id, workspace_id, directory,
       config_signature, model, phase, thread, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    for (const [index, ownerId] of ["usr_alice", "usr_bob"].entries()) {
      ownerInsert.run(
        `http-owner-proof-${index}`,
        projectId,
        ownerId,
        `http-owner-proof-${index}`,
        "Owned Session",
        workerId,
        index === 0 ? "ses_coordination_one" : "ses_coordination_two",
        `wrk_http_owner_${index}`,
        join(directory, `owned-${index}`),
        "fixture",
        JSON.stringify({ providerID: "fixture", id: "fixture-model" }),
        "session",
        null,
        now,
        now,
      )
    }
    ownerDb.close()
    expect((await snapshot(threads[0])).ownerId).toBe("usr_alice")
    expect(
      (
        await request(`/api/coordination/v1/threads/${threads[0]}/instructions`, "bob", "POST", {
          requestId: "denied-owner-work",
          text: "Another member's Session",
        })
      ).response.status,
    ).toBe(403)
    expect(
      (
        await request(
          `/api/coordination/v1/threads/${threads[0]}/instructions/${second.data!.instruction.id}/cancel`,
          "bob",
          "POST",
        )
      ).response.status,
    ).toBe(403)
    expect(
      (
        await request(
          `/api/coordination/v1/threads/${threads[0]}/approvals/${secondApproval.id}/claim`,
          "bob",
          "POST",
          {
            expectedVersion: secondApproval.version,
          },
        )
      ).response.status,
    ).toBe(403)
    expect(
      (
        await request(
          `/api/coordination/v1/threads/${threads[0]}/approvals/${secondApproval.id}/decision`,
          "bob",
          "POST",
          {
            expectedVersion: secondApproval.version,
            decisionId: "denied-owner-decision",
            decision: "approve",
          },
        )
      ).response.status,
    ).toBe(403)
    expect(
      (
        await request(`/api/coordination/v1/threads/${threads[0]}/comments`, "bob", "POST", {
          requestId: "owner-session-comment",
          body: "Shared discussion remains available",
        })
      ).response.status,
    ).toBe(200)
    const cooperationPath = `/api/coordination/v1/threads/${threads[0]}/cooperation`
    const defaults = await request(cooperationPath, "bob")
    expect(defaults.response.status).toBe(200)
    expect(defaults.data).toMatchObject({
      ownerId: "usr_alice",
      version: 0,
      featureTopic: "",
      relationship: "open",
      analysisEnabled: false,
      awarenessMode: "off",
    })
    expect((await request(cooperationPath, "analysis")).response.status).toBe(403)
    const consent = {
      requestId: "consent-one",
      expectedVersion: 0,
      featureTopic: "Navigation",
      relationship: "alternative",
      analysisEnabled: true,
      awarenessMode: "notify",
    }
    const exportPath = `/api/coordination/v1/projects/${projectId}/flower/export`
    const selectedExport = { requestId: "selected-export", sourceThreadId: threads[0], targetThreadId: threads[1] }
    expect((await request(exportPath, "alice", "POST", selectedExport)).response.status).toBe(403)
    expect((await request(cooperationPath, "bob", "PUT", consent)).response.status).toBe(403)
    const enabled = await request(cooperationPath, "alice", "PUT", consent)
    expect(enabled.response.status).toBe(200)
    expect(enabled.data?.version).toBe(1)
    expect(enabled.data?.analysisTextEnabled).toBe(false)
    expect((await request(exportPath, "alice", "POST", selectedExport)).response.status).toBe(403)
    const targetCooperationPath = `/api/coordination/v1/threads/${threads[1]}/cooperation`
    expect(
      (await request(targetCooperationPath, "bob", "PUT", { ...consent, requestId: "target-consent" })).response.status,
    ).toBe(200)
    expect((await request(exportPath, "analysis", "POST", selectedExport)).response.status).toBe(403)
    const exported = await request(exportPath, "alice", "POST", selectedExport)
    expect(exported.response.status).toBe(200)
    expect(exported.data?.snapshot?.workers).toEqual([{ workerId, projectId }])
    expect(exported.data?.snapshot?.sharedSessions.map((session) => session.ownerId)).toEqual(["usr_alice", "usr_bob"])
    expect(exported.data?.cooperationVersions).toEqual({ [threads[0]]: 1, [threads[1]]: 1 })
    for (const event of exported.data!.snapshot!.events) {
      const fields = event.kind === "activity" ? ["toolName", "toolStatus"] : ["transition"]
      expect(Object.keys(event.content).sort()).toEqual(fields.sort())
      expect(Object.values(event.content).every((value) => typeof value === "string")).toBe(true)
    }
    expect(JSON.stringify(exported.data)).not.toContain("Shared discussion remains available")
    const sourceCitation = exported.data!.provenance!.filter((item) => item.threadId === threads[0]).at(-1)!
    const targetCitation = exported.data!.provenance!.filter((item) => item.threadId === threads[1]).at(-1)!
    const note = {
      noteId: "selected-export:awareness",
      sourceThreadId: threads[0],
      targetThreadId: threads[1],
      sourceActivitySeq: sourceCitation.threadActivitySeq,
      targetActivitySeq: targetCitation.threadActivitySeq,
      featureTopic: "Navigation",
      text: "Related Navigation work has a current source citation.",
      evidenceRefs: [sourceCitation, targetCitation].map((ref) => ({
        threadId: ref.threadId,
        eventId: ref.eventId,
        seq: ref.eventSeq,
      })),
      candidateState: "pending",
      deliveryState: "not_attempted",
    }
    const report = {
      requestId: "selected-export",
      reportId: "report-coordination-one",
      sourceThreadId: threads[0],
      targetThreadId: threads[1],
      sourceActivitySeq: note.sourceActivitySeq,
      targetActivitySeq: note.targetActivitySeq,
      cooperationVersions: exported.data!.cooperationVersions,
      awarenessNoteCandidates: [note],
    }
    const resultPath = `/api/coordination/v1/projects/${projectId}/flower/results`
    expect((await request(resultPath, "alice", "POST", report)).response.status).toBe(403)
    const registered = await request(resultPath, "analysis", "POST", report)
    expect(registered.response.status).toBe(200)
    expect(registered.data).toMatchObject({ reportId: report.reportId, requestId: report.requestId, registered: true })
    expect((await request(resultPath, "analysis", "POST", report)).data).toEqual(registered.data)
    expect(
      (
        await request(resultPath, "analysis", "POST", {
          ...report,
          awarenessNoteCandidates: [{ ...note, text: "Changed finding" }],
        })
      ).response.status,
    ).toBe(409)
    expect(
      (
        await request(resultPath, "analysis", "POST", {
          ...report,
          requestId: "stale-result",
          reportId: "stale-result",
          sourceActivitySeq: report.sourceActivitySeq + 1,
        })
      ).response.status,
    ).toBe(409)
    expect(
      (
        await request(resultPath, "analysis", "POST", {
          ...report,
          requestId: "redirection-result",
          reportId: "redirection-result",
          awarenessNoteCandidates: [{ ...note, text: "Stop this task and implement another approach" }],
        })
      ).response.status,
    ).toBe(400)
    const awarenessPath = `/api/coordination/v1/threads/${threads[1]}/flower/awareness`
    const delivery = { reportId: report.reportId, noteId: note.noteId, messageId: "msg_awareness_selected_export" }
    expect((await request(awarenessPath, "alice", "POST", delivery)).response.status).toBe(403)
    expect((await request(awarenessPath, "bob", "POST", delivery)).response.status).toBe(503)
    expect(
      (await request(awarenessPath, "bob", "POST", { ...delivery, messageId: "msg_duplicate_awareness" })).response
        .status,
    ).toBe(409)
    expect((await request(cooperationPath, "alice", "PUT", consent)).data).toEqual(enabled.data)
    expect(
      (await request(cooperationPath, "alice", "PUT", { ...consent, featureTopic: "Changed" })).response.status,
    ).toBe(409)
    expect(
      (await request(cooperationPath, "alice", "PUT", { ...consent, requestId: "stale-consent" })).response.status,
    ).toBe(409)
    expect(
      (
        await request(cooperationPath, "alice", "PUT", {
          ...consent,
          requestId: "invalid-awareness",
          expectedVersion: 1,
          analysisEnabled: false,
        })
      ).response.status,
    ).toBe(400)
    expect(
      (
        await request(cooperationPath, "alice", "PUT", {
          ...consent,
          requestId: "invalid-text-consent",
          expectedVersion: 1,
          analysisEnabled: false,
          analysisTextEnabled: true,
          awarenessMode: "off",
        })
      ).response.status,
    ).toBe(400)
    const disabled = await request(cooperationPath, "alice", "PUT", {
      ...consent,
      requestId: "consent-revoked",
      expectedVersion: 1,
      analysisEnabled: false,
      awarenessMode: "off",
    })
    expect(disabled.response.status).toBe(200)
    expect(disabled.data?.version).toBe(2)
    expect(
      (await request(exportPath, "alice", "POST", { ...selectedExport, requestId: "after-revocation" })).response
        .status,
    ).toBe(403)
    expect((await request(awarenessPath, "bob", "POST", delivery)).response.status).toBe(403)
    expect(
      (
        await request(`/api/coordination/v1/threads/${threads[0]}/work-card`, "analysis", "PUT", {
          expectedVersion: 1,
          sourceActivitySeq: sourceCitation.threadActivitySeq,
          card,
        })
      ).response.status,
    ).toBe(403)
    await app.dispose()
    app = webHandler()
    expect((await request(cooperationPath, "bob")).data).toEqual(disabled.data)
  } finally {
    await app.dispose()
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
