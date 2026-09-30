import { Database } from "bun:sqlite"
import { chmod, stat } from "node:fs/promises"
import { dirname, join } from "node:path"
import { boundedReceiverConfig } from "./native-config"

const memberPath = process.env.PUFF_BACKEND_MEMBER_PATH
if (!memberPath) throw new Error("Supply PUFF_BACKEND_MEMBER_PATH for the owned isolated native scenario")
if ((await stat(memberPath)).mode & 0o077) throw new Error("Member file must be private")
const member = await Bun.file(memberPath).json()
if (!member.nativeScenario || !/^http:\/\/127\.0\.0\.1:\d+$/.test(member.url))
  throw new Error("Only the owned loopback native scenario is supported")
const directory = dirname(memberPath)
const credentials: { username: string; password: string }[] = await Bun.file(member.credentialsPath).json()
async function request<T>(
  path: string,
  username = "serdar",
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
) {
  const actor = credentials.find((person) => person.username === username)!
  const response = await fetch(`${member.url}/api/coordination/v1${path}`, {
    method,
    headers: {
      Authorization: `Basic ${btoa(`${actor.username}:${actor.password}`)}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  if (response.status !== 200) throw new Error(`Bounded preparation request failed: HTTP ${response.status}`)
  return (await response.json()) as T
}

const originalThreadId = member.originalFailedTargetThreadId ?? member.targetThreadId
const original = await request<{ thread: { createdBy: string }; instructions: { text: string }[] }>(
  `/threads/${originalThreadId}`,
)
if (original.thread.createdBy !== member.userId || member.userId !== "usr_serdar")
  throw new Error("Serdar must own the original task")
const originalTask = original.instructions[0]?.text
if (!originalTask) throw new Error("The original owner task must already be recorded")
const configPath = join(directory, "config", "opencode", "opencode.json")
const config = boundedReceiverConfig(await Bun.file(configPath).json())
await Bun.write(configPath, JSON.stringify(config))
await chmod(configPath, 0o600)
const workspace = join(directory, "workspaces", "serdar-bounded")
if (!(await Bun.file(join(workspace, "server.ts")).exists())) {
  const git = Bun.spawn(["git", "worktree", "add", "-q", "-b", "fixture/serdar-bounded", workspace, member.projectId], {
    cwd: join(directory, "source"),
    stdout: "ignore",
    stderr: "pipe",
  })
  if (await git.exited) throw new Error("Could not create the isolated bounded receiving workspace")
}
const separator = config.model.indexOf("/")
const db = new Database(join(directory, "opencode.sqlite"))
db.query(
  "INSERT INTO session (id, project_id, workspace_id, slug, directory, title, version, model, agent, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
).run(
  "ses_serdar_bounded",
  member.projectId,
  "wrk_serdar_bounded",
  "serdar-bounded",
  workspace,
  "Serdar · verify related startup work",
  "native-bounded-verification",
  JSON.stringify({ providerID: config.model.slice(0, separator), id: config.model.slice(separator + 1) }),
  "serdar-bounded",
  Date.now(),
  Date.now(),
)
db.close()
const thread = await request<{ id: string }>(`/projects/${member.projectId}/threads`, "serdar", {
  sessionId: "ses_serdar_bounded",
  title: "Verify related server startup work",
  requestId: "serdar-bounded-thread",
})
await request(`/threads/${thread.id}/comments`, "serdar", {
  requestId: "serdar-bounded-original-task",
  body: originalTask,
})
const submitted = await request<{ instruction: { id: string }; run: { id: string } }>(
  `/threads/${thread.id}/instructions`,
  "serdar",
  { requestId: "serdar-bounded-original-task", text: originalTask },
)
// Retain the original task in real history without executing it a second time.
await request(`/threads/${thread.id}/instructions/${submitted.instruction.id}/cancel`, "serdar", undefined, "POST")
const snapshot = await request<{ thread: { activitySeq: number }; workCard?: { version: number } }>(
  `/threads/${thread.id}`,
)
const replay = await request<{ events: { id: string; seq: number; kind: string }[] }>(
  `/threads/${thread.id}/events?after=-1&limit=256`,
)
const taskEvent = replay.events.find((event) => event.kind === "comment.created")!
await request(
  `/threads/${thread.id}/work-card`,
  "analysis",
  {
    expectedVersion: snapshot.workCard?.version ?? 0,
    sourceActivitySeq: snapshot.thread.activitySeq,
    card: {
      currentTask: originalTask,
      progress:
        "Original task retained. Native receiving verification waits for an owner-selected context instruction and explicit manual reservation.",
      blockers: [],
      status: "queued",
      summaryJobId: "bounded-receiving-prepared",
      recentVerifiedOutcome: null,
      contributors: [member.userId],
      evidenceRefs: [{ threadId: thread.id, eventId: taskEvent.id, seq: taskEvent.seq }],
      generatedAt: new Date().toISOString(),
    },
  },
  "PUT",
)
member.boundedTargetThreadId = thread.id
member.originalFailedTargetThreadId = originalThreadId
if (process.argv.includes("--select")) member.targetThreadId = thread.id
await Bun.write(memberPath, JSON.stringify(member, null, 2))
await chmod(memberPath, 0o600)
const receipt = {
  backendUrl: member.url,
  sourceThreadId: member.sourceThreadId,
  boundedTargetThreadId: thread.id,
  originalFailedTargetThreadId: originalThreadId,
  retainedOriginalRunId: submitted.run.id,
  retainedOriginalRunState: "cancelled",
  agent: "serdar-bounded",
  steps: 1,
  tools: "deny",
  requestMaxOutputTokens: 1024,
  modelRequestSubmitted: false,
  defaultTargetSelected: process.argv.includes("--select"),
}
await Bun.write(join(directory, "bounded-receiving-prepared.json"), JSON.stringify(receipt, null, 2))
await chmod(join(directory, "bounded-receiving-prepared.json"), 0o600)
console.log(JSON.stringify(receipt))
