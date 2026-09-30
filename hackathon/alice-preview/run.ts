import { Database } from "bun:sqlite"
import { randomUUID } from "node:crypto"
import { chmod, mkdir, mkdtemp, realpath } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { provisionNativeConfig } from "./native-config"

const repository = resolve(import.meta.dir, "../..")
const checkOnly = process.argv.includes("--check-only")
const port = Number(process.env.PUFF_PREVIEW_SERVER_PORT ?? 4478)
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("Invalid preview server port")
const probe = createServer()
await new Promise<void>((done, fail) => {
  probe.once("error", fail)
  probe.listen(port, "127.0.0.1", () => probe.close(() => done()))
})

const directory = await realpath(await mkdtemp(join(tmpdir(), "puff-alice-preview-")))
const source = join(directory, "source")
const workspaces = join(directory, "workspaces")
await Promise.all([mkdir(source), mkdir(workspaces)])
const fixtureServer = `const server = Bun.serve({ hostname: "127.0.0.1", port: Number(process.env.PORT), fetch: () => Response.json({ ok: true }) }); console.log("listening=" + server.port);\n`
await Bun.write(join(source, "server.ts"), fixtureServer)
await Bun.write(
  join(source, "README.md"),
  "Isolated Alice server-port fixture. Scenario inputs are authored by the preview launcher; no model history is fabricated.\n",
)
async function git(...args: string[]) {
  const child = Bun.spawn(["git", ...args], { cwd: source, stdout: "pipe", stderr: "pipe" })
  const [output, error, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (status) throw new Error(`Disposable fixture Git command failed: ${error}`)
  return output.trim()
}
await git("init", "-q")
await git("config", "user.name", "Puff Alice Fixture")
await git("config", "user.email", "alice-fixture@example.test")
await git("add", "server.ts", "README.md")
await git("commit", "-qm", "Fixture server for measured port collision")
const projectId = await git("rev-parse", "HEAD")
const aliceWorkspace = join(workspaces, "alice")
const serdarWorkspace = join(workspaces, "serdar")
await git("worktree", "add", "-q", "-b", "fixture/alice", aliceWorkspace, projectId)
await git("worktree", "add", "-q", "-b", "fixture/serdar", serdarWorkspace, projectId)

// The finding below is grounded in actual OS/network behavior, not scripted runner callbacks.
const occupied = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("occupied") })
const occupiedPort = occupied.port
const collision = Bun.spawn([process.execPath, join(source, "server.ts")], {
  env: { ...process.env, PORT: String(occupiedPort) },
  stdout: "pipe",
  stderr: "pipe",
})
const [collisionOutput, collisionError, collisionStatus] = await Promise.all([
  new Response(collision.stdout).text(),
  new Response(collision.stderr).text(),
  collision.exited,
])
const recovery = Bun.spawn([process.execPath, join(source, "server.ts")], {
  env: { ...process.env, PORT: "0" },
  stdout: "pipe",
  stderr: "pipe",
})
const recoveryReader = recovery.stdout.getReader()
const recoveredOutput = new TextDecoder().decode((await recoveryReader.read()).value)
const recoveredPort = Number(/listening=(\d+)/.exec(recoveredOutput)?.[1])
const recoveryResponse = await fetch(`http://127.0.0.1:${recoveredPort}/health`)
const recovered = recoveryResponse.ok && (await recoveryResponse.json()).ok === true
recovery.kill()
await recovery.exited
occupied.stop(true)
if (collisionStatus === 0 || !collisionError.includes("EADDRINUSE") || !recovered)
  throw new Error("The real server-port collision/recovery measurement failed")
const measuredAt = new Date().toISOString()
const capture = {
  scenario: "human-authored isolated Alice finding",
  measuredAt,
  error: "EADDRINUSE",
  occupiedPort,
  collisionExitCode: collisionStatus,
  stderr: collisionError,
  stdout: collisionOutput,
  recoveryPort: recoveredPort,
  recoveryHttpStatus: recoveryResponse.status,
  recovered,
  modelExecution: false,
}
await Bun.write(join(directory, "capture.json"), JSON.stringify(capture, null, 2))

const people = [
  { username: "alice", auth: { kind: "member", userId: "usr_alice" } },
  { username: "serdar", auth: { kind: "member", userId: "usr_serdar" } },
  { username: "outsider", auth: { kind: "member", userId: "usr_outsider" } },
  { username: "worker", auth: { kind: "runner", workerId: "wrk_alice_preview", instanceId: "alice-preview" } },
  { username: "stale-worker", auth: { kind: "runner", workerId: "wrk_alice_preview", instanceId: "retired" } },
  { username: "analysis", auth: { kind: "analysis", serviceId: "human-recorded-fixture" } },
].map((person) => ({ ...person, password: randomUUID() }))
const identityPath = join(directory, "identities.json")
const admissionPath = join(directory, "admissions.json")
const memberPath = join(directory, "member.json")
const credentialsPath = join(directory, "credentials.json")
const runnerPath = join(directory, "runner.json")
await Bun.write(
  identityPath,
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
await Bun.write(admissionPath, JSON.stringify({ allowed: [{ userId: "usr_alice", projectId }] }))
await Bun.write(credentialsPath, JSON.stringify(people))
await Bun.write(
  runnerPath,
  JSON.stringify({
    owner: { workerId: "wrk_alice_preview", instanceId: "alice-preview" },
    username: "worker",
    workspaceRoot: workspaces,
    projects: [{ projectId, repositoryRoot: source, baseRevision: projectId }],
    toolPath: `${dirname(process.execPath)}:/usr/bin:/bin`,
    deliveryIntervalMs: 100,
  }),
)
await Promise.all([identityPath, admissionPath, credentialsPath, runnerPath].map((path) => chmod(path, 0o600)))

const configPath = process.env.PUFF_MODEL_CONFIG_PATH
const config = configPath ? await Bun.file(configPath).json() : undefined
if (configPath && (!config?.model || typeof config.model !== "string" || !config.model.includes("/")))
  throw new Error("PUFF_MODEL_CONFIG_PATH must name an OpenCode JSON config with an explicit provider/model")
// The native Session runner reads Config.Service from files, while the legacy
// CLI reads OPENCODE_CONFIG_CONTENT. Provision both through their existing loaders.
const nativeConfig = await provisionNativeConfig(directory, config, configPath)
const model = config?.model
  ? {
      providerID: config.model.slice(0, config.model.indexOf("/")),
      id: config.model.slice(config.model.indexOf("/") + 1),
    }
  : { providerID: "puff-unconfigured", id: "configure-real-model" }
const worker = people.find((person) => person.username === "worker")!
const origin = `http://127.0.0.1:${port}`
const env = {
  ...process.env,
  PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
  XDG_DATA_HOME: join(directory, "data"),
  XDG_CONFIG_HOME: join(directory, "config"),
  XDG_CACHE_HOME: join(directory, "cache"),
  XDG_STATE_HOME: join(directory, "state"),
  OPENCODE_DB: join(directory, "opencode.sqlite"),
  OPENCODE_PURE: "1",
  OPENCODE_DISABLE_MODELS_FETCH: "1",
  OPENCODE_DISABLE_PROJECT_CONFIG: "1",
  OPENCODE_DISABLE_AUTOUPDATE: "1",
  OPENCODE_CONFIG_DIR: nativeConfig.directory,
  OPENCODE_CONFIG_CONTENT: JSON.stringify(config ?? { formatter: false, lsp: false }),
  OPENCODE_COORDINATION_IDENTITIES_PATH: identityPath,
  OPENCODE_COORDINATION_ADMISSIONS_PATH: admissionPath,
  OPENCODE_COORDINATION_MOCK_RUNNER: "0",
  OPENCODE_RUNNER_CONFIG_PATH: runnerPath,
  OPENCODE_RUNNER_PASSWORD: worker.password,
  OPENCODE_SERVER_PASSWORD: randomUUID(),
  NO_PROXY: [process.env.NO_PROXY, "127.0.0.1", "localhost"].filter(Boolean).join(","),
}
const logs = join(directory, "server.log")
await Bun.write(logs, "")
await chmod(logs, 0o600)
const server = Bun.spawn(
  [process.execPath, "run", "./src/index.ts", "serve", "--hostname", "127.0.0.1", "--port", String(port), "--pure"],
  {
    cwd: join(repository, "packages/opencode"),
    env,
    stdout: Bun.file(logs),
    stderr: Bun.file(logs),
  },
)
let scheduler: ReturnType<typeof setInterval> | undefined
const stop = () => {
  if (scheduler) clearInterval(scheduler)
  server.kill()
}
process.once("SIGINT", stop)
process.once("SIGTERM", stop)

type Event = { id: string; threadId: string; seq: number; kind: string; payload: Record<string, unknown> }
type Snapshot = {
  thread: { id: string; activitySeq: number }
  runs: { id: string; state: string }[]
  workCard?: { version: number; evidenceRefs: { threadId: string; eventId: string; seq: number }[] }
}
async function request<T>(route: string, username: string, method = "GET", body?: unknown) {
  const person = people.find((item) => item.username === username)!
  const response = await fetch(`${origin}${route}`, {
    method,
    headers: {
      Authorization: `Basic ${btoa(`${person.username}:${person.password}`)}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  const data = response.headers.get("content-type")?.includes("json") ? await response.json() : undefined
  return { status: response.status, data: data as T }
}
function requireOK<T>(result: { status: number; data: T }, label: string) {
  if (result.status !== 200) throw new Error(`${label}: HTTP ${result.status} ${JSON.stringify(result.data)}`)
  return result.data
}

try {
  const deadline = Date.now() + 45_000
  let ready = false
  while (Date.now() < deadline) {
    ready = await fetch(`${origin}/api/coordination/v1/status`, { signal: AbortSignal.timeout(500) })
      .then((value) => value.ok)
      .catch(() => false)
    if (ready) break
    if (server.exitCode !== null) throw new Error(`Backend exited: ${await Bun.file(logs).text()}`)
    await Bun.sleep(200)
  }
  if (!ready) throw new Error(`Real coordination runner did not become ready; log: ${logs}`)
  // Harness mode deliberately closes runtime HTTP. Provision existing Sessions exactly as its process integration does.
  const sqlite = new Database(env.OPENCODE_DB)
  const now = Date.now()
  sqlite
    .query("INSERT INTO project (id, worktree, sandboxes, time_created, time_updated) VALUES (?, ?, ?, ?, ?)")
    .run(projectId, source, "[]", now, now)
  for (const session of [
    {
      id: "ses_alice_preview",
      workspaceId: "wrk_alice_fixture",
      directory: aliceWorkspace,
      title: "Alice · solved server startup",
    },
    {
      id: "ses_serdar_preview",
      workspaceId: "wrk_serdar_fixture",
      directory: serdarWorkspace,
      title: "Serdar · server startup",
    },
    {
      id: "ses_private_preview",
      workspaceId: "wrk_private_fixture",
      directory: serdarWorkspace,
      title: "Private unshared session",
    },
  ])
    sqlite
      .query(
        "INSERT INTO session (id, project_id, workspace_id, slug, directory, title, version, model, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        session.id,
        projectId,
        session.workspaceId,
        session.id,
        session.directory,
        session.title,
        "alice-fixture",
        JSON.stringify(model),
        now,
        now,
      )
  sqlite.close()
  requireOK(
    await request("/api/coordination/v1/projects", "alice", "POST", {
      projectId,
      name: "Puff · shared server work",
      requestId: randomUUID(),
    }),
    "Create shared project",
  )
  requireOK(
    await request(`/api/coordination/v1/projects/${projectId}/members`, "alice", "POST", {
      targetUserId: "usr_serdar",
      requestId: randomUUID(),
    }),
    "Join Serdar",
  )
  const sourceThread = requireOK(
    await request<{ id: string }>(`/api/coordination/v1/projects/${projectId}/threads`, "alice", "POST", {
      sessionId: "ses_alice_preview",
      title: "Server startup · EADDRINUSE fixed",
      requestId: randomUUID(),
    }),
    "Share Alice thread",
  )
  const targetThread = requireOK(
    await request<{ id: string }>(`/api/coordination/v1/projects/${projectId}/threads`, "serdar", "POST", {
      sessionId: "ses_serdar_preview",
      title: "Start the server for the app",
      requestId: randomUUID(),
    }),
    "Share Serdar thread",
  )
  const sourceBody = `Recorded finding from the isolated Alice scenario.\n\nThe server failed to start with EADDRINUSE because the requested loopback port ${capture.occupiedPort} was already held by another process. I left that process running and started this server on a free port using PORT=0. The actual server listened on ${capture.recoveryPort}; GET /health returned HTTP ${capture.recoveryHttpStatus} with {"ok":true}.\n\nTo reuse: confirm your error is EADDRINUSE, choose an available PORT, then point your client at the new address and check /health. Changing ports addresses this collision; it does not establish that another server error has the same cause.\n\nMeasured ${measuredAt}. Human-authored fixture finding backed by real process/network measurements. No model produced this history.`
  requireOK(
    await request(`/api/coordination/v1/threads/${sourceThread.id}/comments`, "alice", "POST", {
      requestId: "alice-measured-finding",
      body: sourceBody,
    }),
    "Record measured finding",
  )
  requireOK(
    await request(`/api/coordination/v1/threads/${targetThread.id}/comments`, "serdar", "POST", {
      requestId: "serdar-task",
      body: "I am starting the app server and seeing EADDRINUSE. Find a related solved server-startup issue and let me review the exact source before I reuse it. Isolated scenario input, authored by the preview launcher.",
    }),
    "Record Serdar task",
  )
  const sourceReplay = requireOK(
    await request<{ events: Event[] }>(
      `/api/coordination/v1/threads/${sourceThread.id}/events?after=-1&limit=256`,
      "serdar",
    ),
    "Read source replay",
  )
  const finding = sourceReplay.events.find((event) => event.kind === "comment.created")!
  if (!finding) throw new Error("No exact persisted finding event")
  const sourceSnapshot = requireOK(
    await request<Snapshot>(`/api/coordination/v1/threads/${sourceThread.id}`, "serdar"),
    "Read source snapshot",
  )
  const cardBody = {
    expectedVersion: 0,
    sourceActivitySeq: sourceSnapshot.thread.activitySeq,
    card: {
      currentTask: "Fix server startup EADDRINUSE",
      progress:
        "Measured a port collision and verified healthy startup on an available port. Recorded human finding; no model execution.",
      blockers: [],
      status: "done",
      summaryJobId: "human-recorded-alice-measurement",
      recentVerifiedOutcome:
        "Actual process: EADDRINUSE on occupied port; alternate port returned HTTP 200 from /health.",
      contributors: ["usr_alice"],
      evidenceRefs: [{ threadId: sourceThread.id, eventId: finding.id, seq: finding.seq }],
      generatedAt: measuredAt,
    },
  }
  const wrongEvidence = await request(`/api/coordination/v1/threads/${sourceThread.id}/work-card`, "analysis", "PUT", {
    ...cardBody,
    card: { ...cardBody.card, evidenceRefs: [{ threadId: sourceThread.id, eventId: "event_wrong", seq: finding.seq }] },
  })
  const card = requireOK(
    await request<{ version: number }>(
      `/api/coordination/v1/threads/${sourceThread.id}/work-card`,
      "analysis",
      "PUT",
      cardBody,
    ),
    "Record Alice WorkCard",
  )
  const retriedCard = requireOK(
    await request<{ version: number }>(
      `/api/coordination/v1/threads/${sourceThread.id}/work-card`,
      "analysis",
      "PUT",
      cardBody,
    ),
    "Exact WorkCard retry",
  )
  const staleCard = await request(`/api/coordination/v1/threads/${sourceThread.id}/work-card`, "analysis", "PUT", {
    ...cardBody,
    card: { ...cardBody.card, progress: "Changed stale request" },
  })
  const targetReplay = requireOK(
    await request<{ events: Event[] }>(
      `/api/coordination/v1/threads/${targetThread.id}/events?after=-1&limit=256`,
      "serdar",
    ),
    "Read target replay",
  )
  const targetSnapshot = requireOK(
    await request<Snapshot>(`/api/coordination/v1/threads/${targetThread.id}`, "serdar"),
    "Read target snapshot",
  )
  const targetFinding = targetReplay.events.find((event) => event.kind === "comment.created")!
  requireOK(
    await request(`/api/coordination/v1/threads/${targetThread.id}/work-card`, "analysis", "PUT", {
      expectedVersion: 0,
      sourceActivitySeq: targetSnapshot.thread.activitySeq,
      card: {
        currentTask: "Start the server for the app",
        progress: "Inspecting EADDRINUSE and related solved work.",
        blockers: config ? [] : ["Real OpenCode model is not configured in this isolated preview."],
        status: config ? "active" : "blocked",
        summaryJobId: "human-recorded-serdar-task",
        recentVerifiedOutcome: null,
        contributors: ["usr_serdar"],
        evidenceRefs: [{ threadId: targetThread.id, eventId: targetFinding.id, seq: targetFinding.seq }],
        generatedAt: measuredAt,
      },
    }),
    "Record Serdar WorkCard",
  )
  const instructionBody = {
    requestId: "serdar-initial-task",
    text: "I am starting the app server and seeing EADDRINUSE. Inspect server.ts and explain a safe next step. Do not modify files or terminate other processes.",
  }
  const first = requireOK(
    await request<{ run: { id: string } }>(
      `/api/coordination/v1/threads/${targetThread.id}/instructions`,
      "serdar",
      "POST",
      instructionBody,
    ),
    "Submit actual queued task",
  )
  const retry = requireOK(
    await request<{ run: { id: string } }>(
      `/api/coordination/v1/threads/${targetThread.id}/instructions`,
      "serdar",
      "POST",
      instructionBody,
    ),
    "Retry actual queued task",
  )
  const changedRetry = await request(`/api/coordination/v1/threads/${targetThread.id}/instructions`, "serdar", "POST", {
    ...instructionBody,
    text: "Changed retry",
  })
  const memberReserve = await request(
    `/api/coordination/v1/runner/threads/${targetThread.id}/reserve`,
    "serdar",
    "POST",
  )
  const outsiderRead = await request(`/api/coordination/v1/threads/${sourceThread.id}`, "outsider")
  const historyClosed = await request("/api/session/ses_alice_preview/history", "serdar")
  const allThreads = requireOK(
    await request<{ sessionId: string }[]>(`/api/coordination/v1/projects/${projectId}/threads`, "serdar"),
    "List only shared threads",
  )
  const actualReserve = await request(
    `/api/coordination/v1/runner/threads/${targetThread.id}/reserve`,
    "worker",
    "POST",
  )
  const staleCallback = await request(
    `/api/coordination/v1/runner/runs/${first.run.id}/events`,
    "stale-worker",
    "POST",
    {
      callbackId: "stale-preview-callback",
      callback: { kind: "state", expectedState: "reserved", nextState: "running" },
    },
  )
  let afterReserve = requireOK(
    await request<Snapshot>(`/api/coordination/v1/threads/${targetThread.id}`, "serdar"),
    "Read actual runner state",
  )
  // Capture a settled native result when it arrives promptly. A configured
  // provider alone is never evidence of a successful model response.
  if (config && actualReserve.status === 200) {
    const settleDeadline = Date.now() + 20_000
    while (
      Date.now() < settleDeadline &&
      !["completed", "failed", "cancelled", "waiting_approval", "recovery_required"].includes(
        afterReserve.runs.find((run) => run.id === first.run.id)?.state ?? "",
      )
    ) {
      await Bun.sleep(200)
      afterReserve = requireOK(
        await request<Snapshot>(`/api/coordination/v1/threads/${targetThread.id}`, "serdar"),
        "Read receiving Run result",
      )
    }
  }
  const persisted = new Database(env.OPENCODE_DB, { readonly: true })
  const actualExecution = persisted
    .query<
      { phase: string; admitted_message_id: string | null },
      [string]
    >("SELECT phase, admitted_message_id FROM runner_harness_execution WHERE run_id = ?")
    .get(first.run.id)
  const admittedInputs = persisted.query<{ count: number }, []>("SELECT count(*) AS count FROM session_input").get()!
    .count
  const sessionMessages = persisted.query<{ count: number }, []>("SELECT count(*) AS count FROM session_message").get()!
    .count
  const assistant = persisted
    .query<
      { id: string; seq: number; data: string },
      []
    >("SELECT id, seq, data FROM session_message WHERE session_id = 'ses_serdar_preview' AND type = 'assistant' ORDER BY seq DESC LIMIT 1")
    .get()
  persisted.close()
  const assistantData = assistant ? JSON.parse(assistant.data) : undefined
  const providerHttpStatus =
    typeof assistantData?.error?.message === "string"
      ? Number(/HTTP (\d{3})\b/.exec(assistantData.error.message)?.[1]) || undefined
      : undefined
  const runState = afterReserve.runs.find((run) => run.id === first.run.id)?.state
  const modelOutcome = !assistant
    ? "not_observed"
    : assistantData.error
      ? "failed"
      : runState === "completed"
        ? "completed"
        : "pending"
  const runnerAvailability = {
    configured: Boolean(config),
    mock: false,
    runId: first.run.id,
    reserveHttpStatus: actualReserve.status,
    reserveResponse: actualReserve.data,
    runState,
    localPhase: actualExecution?.phase,
    admittedInputs,
    sessionMessages,
    modelOutcome,
    providerHttpStatus,
    assistantMessageId: assistant?.id,
    assistantSeq: assistant?.seq,
    message: config
      ? actualReserve.status !== 200
        ? "The model is configured, but the actual OpenCode adapter could not prepare execution. No model input was admitted."
        : modelOutcome === "failed"
          ? `Real OpenCode admitted the task, but the provider request failed${providerHttpStatus ? ` with HTTP ${providerHttpStatus}` : ""}. The failed native assistant receipt is preserved; no successful model output was observed.`
          : modelOutcome === "completed"
            ? "The real OpenCode receiving task completed with a native model response."
            : "Real OpenCode admitted the task using the configured model. Its successful completion has not been observed."
      : "No real model configuration was supplied. The actual OpenCode adapter rejected preparation; no model executed. Supply PUFF_MODEL_CONFIG_PATH and restart the isolated preview.",
  }
  const member = people.find((person) => person.username === "serdar")!
  await Bun.write(
    memberPath,
    JSON.stringify(
      {
        url: origin,
        username: member.username,
        password: member.password,
        userId: "usr_serdar",
        names: { usr_serdar: "Serdar", usr_alice: "Alice" },
        projectId,
        sourceThreadId: sourceThread.id,
        targetThreadId: targetThread.id,
        credentialsPath,
        capturePath: join(directory, "capture.json"),
        runnerAvailability: config
          ? [401, 403].includes(providerHttpStatus ?? 0)
            ? "provider_auth_failed"
            : "configured"
          : "model_configuration_missing",
        runnerDiagnostics: runnerAvailability,
      },
      null,
      2,
    ),
  )
  await chmod(memberPath, 0o600)
  const checks = {
    collision: "EADDRINUSE",
    recovered,
    exactEvidence: finding.payload.body === sourceBody,
    wrongEvidenceRejected: wrongEvidence.status === 400,
    staleWorkCardRejected: staleCard.status === 409,
    exactWorkCardRetry: card.version === retriedCard.version,
    exactInstructionRetry: first.run.id === retry.run.id,
    changedInstructionRetryRejected: changedRetry.status === 409,
    memberCannotReserve: memberReserve.status === 403,
    outsiderCannotRead: [403, 404].includes(outsiderRead.status),
    privateSessionNotExported: !allThreads.some((thread) => thread.sessionId === "ses_private_preview"),
    runtimeHistoryClosed: historyClosed.status === 403,
    staleRunnerRejected: staleCallback.status === 403,
    realRunner: env.OPENCODE_COORDINATION_MOCK_RUNNER === "0" && actualExecution !== null,
    noModelHistoryFabricated: config
      ? true
      : admittedInputs === 0 && sessionMessages === 0 && actualExecution?.admitted_message_id === null,
    runnerAvailability,
  }
  await Bun.write(join(directory, "checks.json"), JSON.stringify(checks, null, 2))
  if (
    Object.entries(checks).some(([key, value]) => typeof value === "boolean" && key !== "runnerAvailability" && !value)
  )
    throw new Error(`Integration check failed: ${JSON.stringify(checks)}`)
  console.log(`ALICE_CHECKS ${JSON.stringify(checks)}`)
  console.log(`Backend ready: ${origin}`)
  console.log(`Member file (0600): ${memberPath}`)
  console.log(`Isolated source/data and measurement receipts: ${directory}`)
  console.log(`Runner: ${runnerAvailability.message}`)
  console.log(
    `Start React product: PUFF_BACKEND_URL='${origin}' PUFF_BACKEND_MEMBER_PATH='${memberPath}' bun --cwd apps/web dev --hostname 127.0.0.1 --port 3010`,
  )
  if (checkOnly) process.exitCode = 0
  if (!checkOnly) {
    let busy = false
    if (config)
      scheduler = setInterval(() => {
        if (busy) return
        busy = true
        void Promise.all(
          [sourceThread.id, targetThread.id].map((threadId) =>
            request(`/api/coordination/v1/runner/threads/${threadId}/reserve`, "worker", "POST"),
          ),
        )
          .catch(() => console.error("Real runner reserve request failed; inspect the persisted backend state."))
          .finally(() => {
            busy = false
          })
      }, 2_000)
    await server.exited
  }
} finally {
  stop()
  await server.exited
}
