import { expect, test } from "bun:test"
import { startHarness, until } from "./harness"

test("two members share a thread while another thread runs", async () => {
  const testbed = await startHarness()
  try {
    testbed.seed("prj_e2e_main", ["ses_e2e_one", "ses_e2e_two"])
    expect(
      (
        await testbed.request("/api/coordination/v1/projects", "eve", "POST", {
          projectId: "prj_e2e_main",
          name: "impostor",
          requestId: "spoof",
          userId: "usr_alice",
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await testbed.request("/api/coordination/v1/projects", "alice", "POST", {
          projectId: "prj_e2e_main",
          name: "Shared fixture",
          requestId: "share-main",
        })
      ).status,
    ).toBe(200)
    for (const userId of ["usr_bob", "usr_carol", "usr_dan"])
      expect(
        (
          await testbed.request("/api/coordination/v1/projects/prj_e2e_main/members", "alice", "POST", {
            targetUserId: userId,
            requestId: `grant-${userId}`,
          })
        ).status,
      ).toBe(200)
    expect(
      (
        await testbed.request("/api/coordination/v1/projects/prj_e2e_main/threads", "alice", "POST", {
          sessionId: "ses_e2e_one",
          title: "Unselected fixture session",
          requestId: "unselected-session",
        })
      ).status,
    ).toBe(403)
    for (const sessionId of ["ses_e2e_one", "ses_e2e_two"])
      testbed.selectSession("usr_alice", "prj_e2e_main", sessionId)
    const [one, two] = await Promise.all(
      ["ses_e2e_one", "ses_e2e_two"].map((sessionId) =>
        testbed.request<{ id: string }>("/api/coordination/v1/projects/prj_e2e_main/threads", "alice", "POST", {
          sessionId,
          title: sessionId,
          requestId: `thread-${sessionId}`,
        }),
      ),
    )
    expect([one.status, two.status]).toEqual([200, 200])
    const threadOne = one.data.id
    const threadTwo = two.data.id
    const comments = await Promise.all([
      testbed.request<{ authorId: string }>(`/api/coordination/v1/threads/${threadOne}/comments`, "alice", "POST", {
        requestId: "alice-comment",
        body: "I am working on the first approach",
      }),
      testbed.request<{ authorId: string }>(`/api/coordination/v1/threads/${threadOne}/comments`, "bob", "POST", {
        requestId: "bob-comment",
        body: "I can follow this thread",
      }),
    ])
    expect(comments.map((result) => result.status)).toEqual([200, 200])
    expect(comments.map((result) => result.data.authorId).toSorted()).toEqual(["usr_alice", "usr_bob"])
    expect((await testbed.snapshot(threadOne)).runs).toHaveLength(0)

    await testbed.admin("options", { autoStart: true, autoPoll: true })
    const first = await testbed.request<{ instruction: { id: string; queueSeq: number }; run: { id: string } }>(
      `/api/coordination/v1/threads/${threadOne}/instructions`,
      "alice",
      "POST",
      { requestId: "alice-first", text: "Fixture: first approach" },
    )
    const queued = await Promise.all([
      testbed.request<{ instruction: { id: string; queueSeq: number }; run: { id: string } }>(
        `/api/coordination/v1/threads/${threadOne}/instructions`,
        "bob",
        "POST",
        { requestId: "bob-second", text: "Fixture: second approach" },
      ),
      testbed.request<{ instruction: { id: string; queueSeq: number }; run: { id: string } }>(
        `/api/coordination/v1/threads/${threadOne}/instructions`,
        "carol",
        "POST",
        { requestId: "carol-third", text: "Fixture: check constraints" },
      ),
    ])
    const independent = await testbed.request<{ run: { id: string } }>(
      `/api/coordination/v1/threads/${threadTwo}/instructions`,
      "dan",
      "POST",
      { requestId: "dan-independent", text: "Fixture: independent thread" },
    )
    expect([first.status, ...queued.map((item) => item.status), independent.status]).toEqual([200, 200, 200, 200])
    expect(first.data.instruction.queueSeq).toBe(1)
    expect(queued.map((item) => item.data.instruction.queueSeq).toSorted()).toEqual([2, 3])
    expect((await testbed.reserve(threadOne)).data.run?.id).toBe(first.data.run.id)
    expect((await testbed.reserve(threadTwo)).data.run?.id).toBe(independent.data.run.id)
    await until(
      () => testbed.snapshot(threadOne),
      (value) => value.runs.some((run) => run.id === first.data.run.id && run.state === "running"),
      "first running",
    )
    await until(
      () => testbed.snapshot(threadTwo),
      (value) => value.runs.some((run) => run.id === independent.data.run.id && run.state === "running"),
      "independent running",
    )
    expect((await testbed.snapshot(threadOne)).runs.filter((run) => run.state === "running")).toHaveLength(1)
    expect((await testbed.snapshot(threadOne)).runs.filter((run) => run.state === "queued")).toHaveLength(2)
    expect(
      (
        await testbed.callback(first.data.run.id, "alice-output", {
          kind: "activity",
          state: "running",
          activity: { kind: "run.output", text: "Fixture output A committed" },
        })
      ).first.status,
    ).toBe(200)
    expect(
      (
        await testbed.callback(independent.data.run.id, "dan-tool", {
          kind: "activity",
          state: "running",
          activity: { kind: "run.tool", toolName: "fixture", status: "completed", summary: "Inert step" },
        })
      ).first.status,
    ).toBe(200)
    expect(
      (
        await testbed.callback(first.data.run.id, "alice-complete", {
          kind: "state",
          expectedState: "running",
          nextState: "completed",
        })
      ).first.status,
    ).toBe(200)
    const second = queued.find((item) => item.data.instruction.queueSeq === 2)!
    await until(
      () => testbed.snapshot(threadOne),
      (value) => value.runs.some((run) => run.id === second.data.run.id && run.state === "running"),
      "next accepted instruction running",
    )
    const fake = await testbed.state()
    expect(fake.starts.filter((command) => command.threadId === threadOne).map((command) => command.runId)).toEqual([
      first.data.run.id,
      second.data.run.id,
    ])
    expect(fake.starts[1].sessionId).toBe("ses_e2e_two")
    expect(fake.starts.find((command) => command.runId === second.data.run.id)?.sessionId).toBe("ses_e2e_one")
    const events = await testbed.replay("prj_e2e_main")
    const firstComplete = events.events.find(
      (event) => event.kind === "run.completed" && event.runId === first.data.run.id,
    )!
    const secondReserved = events.events.find(
      (event) => event.kind === "run.reserved" && event.runId === second.data.run.id,
    )!
    expect(firstComplete.seq).toBeLessThan(secondReserved.seq)
    console.log(
      "COORDINATION_TRACE",
      JSON.stringify(
        events.events
          .filter((event) =>
            [
              "comment.created",
              "instruction.submitted",
              "run.reserved",
              "run.started",
              "run.output",
              "run.tool",
              "run.completed",
            ].includes(event.kind),
          )
          .map((event) => ({
            seq: event.seq,
            kind: event.kind,
            threadId: event.threadId,
            actorId: event.actorId,
            runId: event.runId,
          })),
      ),
    )
  } finally {
    await testbed.close()
  }
}, 120_000)
