import { expect, test } from "bun:test"
import { createTeamController } from "./team-state"
import type { ProjectTransport } from "./project-api"

const at = "2026-09-29T00:00:00Z"
const error = "TypeError: Cannot read properties of undefined (reading 'map') at ProjectList"

function fixture() {
  const project = { id: "project", name: "Team project", createdBy: "usr_me", createdAt: at }
  const source = {
    id: "alya-fix",
    threadId: "alya",
    projectId: project.id,
    seq: 5,
    kind: "run.output",
    actorId: "usr_alya",
    occurredAt: at,
    payload: {
      fix: {
        error,
        summary: "Default missing projects to an empty list.",
        patch: "--- a/list.ts\n+++ b/list.ts\n- projects.map(render)\n+ (projects ?? []).map(render)",
        verification: { command: "bun test", exitCode: 0, output: "2 pass, 0 fail" },
      },
    },
  }
  const failure = {
    id: "my-error",
    threadId: "mine",
    projectId: project.id,
    seq: 8,
    kind: "run.failed",
    occurredAt: at,
    payload: { summary: error },
  }
  const thread = (id: string) => ({
    id,
    projectId: project.id,
    sessionId: `ses_${id}`,
    workerId: `worker_${id}`,
    title: id,
    createdBy: id === "mine" ? "usr_me" : "usr_alya",
    createdAt: at,
    activitySeq: id === "mine" ? 8 : 5,
  })
  const card = {
    id: "card",
    projectId: project.id,
    threadId: "alya",
    version: 1,
    sourceActivitySeq: 5,
    currentTask: "Fix empty projects",
    progress: "Fixed and checked",
    blockers: [],
    status: "done",
    recentVerifiedOutcome: "2 tests passed",
    contributors: ["usr_alya"],
    evidenceRefs: [{ threadId: "alya", eventId: source.id, seq: 5 }],
    generatedAt: at,
    updatedAt: at,
    submittedBy: "analysis",
    summaryJobId: "job",
  }
  const posts: { requestId: string; text: string }[] = []
  const controls = { stale: false, loseResponse: false }
  const transport: ProjectTransport = async (url, init) => {
    const path = new URL(url).pathname.replace("/api/coordination/v1", "")
    if (path === "/status") return Response.json({ ready: true, simulated: false })
    if (path === "/simulation") return new Response(null, { status: 404 })
    if (path === "/projects") return Response.json([project])
    if (path === "/projects/project")
      return Response.json({
        project,
        members: ["usr_me", "usr_alya"].map((userId) => ({
          projectId: project.id,
          userId,
          role: "member",
          joinedAt: at,
        })),
      })
    if (path === "/projects/project/threads") return Response.json([thread("mine"), thread("alya")])
    if (path === "/projects/project/work-cards")
      return Response.json([{ ...card, sourceActivitySeq: controls.stale ? 4 : 5 }])
    if (path === "/projects/project/events") return Response.json({ events: [source], cursor: 5, hasMore: false })
    const id = /^\/threads\/(mine|alya)$/.exec(path)?.[1]
    if (id)
      return Response.json({
        thread: thread(id),
        instructions: [],
        runs: [],
        approvals: [],
        workCard: id === "alya" ? card : null,
        cursor: id === "mine" ? 8 : 5,
      })
    const replay = /^\/threads\/(mine|alya)\/events$/.exec(path)?.[1]
    if (replay) {
      const item = replay === "mine" ? failure : source
      return Response.json({
        events: Number(new URL(url).searchParams.get("after")) < item.seq ? [item] : [],
        cursor: item.seq,
        hasMore: false,
      })
    }
    if (path === "/threads/mine/instructions") {
      const body = JSON.parse(String(init.body)) as { requestId: string; text: string }
      posts.push(body)
      if (controls.loseResponse) {
        controls.loseResponse = false
        throw new Error("Lost response after admission")
      }
      return Response.json({
        instruction: {
          id: "instruction",
          requestId: body.requestId,
          text: body.text,
          threadId: "mine",
          actorId: "usr_me",
          queueSeq: 1,
          submittedAt: at,
          runId: "apply-run",
        },
        run: {
          id: "apply-run",
          threadId: "mine",
          instructionId: "instruction",
          state: "queued",
          attempt: 0,
          runnerMessageId: "message",
          createdAt: at,
        },
      })
    }
    throw new Error(`Unexpected request ${path}`)
  }
  return { transport, posts, controls }
}

async function settle() {
  for (let i = 0; i < 400; i++) await Promise.resolve()
}
async function connect(data: ReturnType<typeof fixture>) {
  const team = createTeamController(data.transport)
  expect(await team.connect("https://team.example", "me", "test-only")).toBe(true)
  await team.refreshOverview()
  team.selectThread("mine")
  await team.refresh()
  await settle()
  return team
}

test("a failed session automatically receives a verified fix without a task-name query", async () => {
  const data = fixture(),
    team = await connect(data)
  expect(team.state.fixProposal?.actorId).toBe("usr_alya")
  expect(data.posts).toHaveLength(0)
  team.dismissFix()
  await team.refresh()
  await team.refreshOverview()
  await settle()
  expect(team.state.fixProposal).toBeUndefined()
  expect(data.posts).toHaveLength(0)
  team.dispose()
})

test("Apply rechecks the source revision and refuses a stale fix before sending", async () => {
  const data = fixture(),
    team = await connect(data)
  data.controls.stale = true
  await team.applyFix()
  expect(data.posts).toHaveLength(0)
  expect(team.state.fixError).toBe("conflict")
  team.dispose()
})

test("a lost Apply response retries the exact source-linked request once", async () => {
  const data = fixture(),
    team = await connect(data)
  data.controls.loseResponse = true
  await team.applyFix()
  await settle()
  expect(team.state.fixAttempts.mine?.uncertain).toBe(true)
  await team.applyFix()
  await settle()
  expect(data.posts).toHaveLength(2)
  expect(data.posts[0]).toEqual(data.posts[1])
  expect(data.posts[0]?.text).toContain("alya-fix@5")
  expect(team.state.fixAttempts.mine?.runId).toBe("apply-run")
  await team.applyFix()
  expect(data.posts).toHaveLength(2)
  team.dispose()
})
