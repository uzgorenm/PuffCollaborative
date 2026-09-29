import { randomUUID } from "node:crypto"
import { chmod, mkdir, mkdtemp } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

const repository = resolve(import.meta.dir, "../..")
const serverOnly = process.argv.includes("--server-only")
const port = Number(process.env.PUFF_PREVIEW_SERVER_PORT ?? 4467)
const rendererPort = Number(process.env.PUFF_PREVIEW_RENDERER_PORT ?? 5184)
const debugPort = Number(process.env.PUFF_PREVIEW_DEBUG_PORT ?? 9230)

if (![port, rendererPort, debugPort].every((value) => Number.isSafeInteger(value) && value > 0 && value < 65536))
  throw new Error("Preview ports must be integers between 1 and 65535")

await Promise.all(
  [port, ...(serverOnly ? [] : [rendererPort, debugPort])].map(
    (value) =>
      new Promise<void>((done, fail) => {
        const probe = createServer()
        probe.once("error", fail)
        probe.listen(value, "127.0.0.1", () => probe.close(() => done()))
      }),
  ),
)

const directory = await mkdtemp(join(tmpdir(), "puff-desktop-preview-"))
const workspace = join(directory, "workspace")
await mkdir(workspace)
const people = [
  { username: "alice", auth: { kind: "member", userId: "usr_alice" } },
  { username: "bob", auth: { kind: "member", userId: "usr_bob" } },
  { username: "cara", auth: { kind: "member", userId: "usr_cara" } },
  { username: "drew", auth: { kind: "member", userId: "usr_drew" } },
  { username: "worker", auth: { kind: "runner", workerId: "wrk_preview", instanceId: "desktop-preview" } },
  { username: "analysis", auth: { kind: "analysis", serviceId: "preview-summary" } },
].map((person) => ({ ...person, password: randomUUID() }))
await Bun.write(
  join(directory, "identities.json"),
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
await Bun.write(
  join(directory, "admissions.json"),
  JSON.stringify({
    allowed: [{ userId: "usr_alice", projectId: "global" }],
  }),
)
await Bun.write(
  join(directory, "member.json"),
  JSON.stringify({
    url: `http://127.0.0.1:${port}`,
    username: "alice",
    password: people[0]!.password,
  }),
)
await Promise.all(
  ["identities.json", "admissions.json", "member.json"].map((name) => chmod(join(directory, name), 0o600)),
)

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
  OPENCODE_COORDINATION_IDENTITIES_PATH: join(directory, "identities.json"),
  OPENCODE_COORDINATION_ADMISSIONS_PATH: join(directory, "admissions.json"),
  OPENCODE_COORDINATION_MOCK_RUNNER: "1",
  OPENCODE_COORDINATION_MOCK_WORKER_ID: "wrk_preview",
  OPENCODE_COORDINATION_MOCK_INSTANCE_ID: "desktop-preview",
  NO_PROXY: [process.env.NO_PROXY, "127.0.0.1", "localhost"].filter(Boolean).join(","),
}
const origin = `http://127.0.0.1:${port}`
const server = Bun.spawn(
  [
    process.execPath,
    "run",
    "./src/index.ts",
    "serve",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
    "--cors",
    `http://127.0.0.1:${rendererPort}`,
    "--pure",
  ],
  { cwd: join(repository, "packages/opencode"), env, stdout: "inherit", stderr: "inherit" },
)

async function request(path: string, username?: string, method = "GET", body?: unknown): Promise<unknown> {
  const person = people.find((item) => item.username === username)
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(person ? { Authorization: `Basic ${btoa(`${person.username}:${person.password}`)}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status} ${await response.text()}`)
  if (response.status === 204) return undefined
  return response.json()
}

let desktop: ReturnType<typeof Bun.spawn> | undefined
let scheduler: ReturnType<typeof setInterval> | undefined
const stop = () => {
  if (scheduler) clearInterval(scheduler)
  desktop?.kill()
  server.kill()
}
process.once("SIGINT", stop)
process.once("SIGTERM", stop)

try {
  let ready = false
  for (let attempt = 0; attempt < 120; attempt++) {
    ready = await fetch(`${origin}/api/coordination/v1/status`, { signal: AbortSignal.timeout(1_000) })
      .then((response) => response.ok)
      .catch(() => false)
    if (ready) break
    await Bun.sleep(500)
  }
  if (!ready) throw new Error("Coordination service did not become ready")

  const local = (await request(`/project/current?directory=${encodeURIComponent(workspace)}`)) as { id: string }
  if (local.id !== "global") throw new Error(`Expected isolated global project, received ${local.id}`)
  const sessions = await Promise.all(
    ["Compact navigation", "Expanded navigation"].map(
      (title) =>
        request(`/session?directory=${encodeURIComponent(workspace)}`, undefined, "POST", { title }) as Promise<{
          id: string
          projectID: string
        }>,
    ),
  )
  if (sessions.some((session) => session.projectID !== local.id)) throw new Error("Session project binding differs")

  const project = (await request("/api/coordination/v1/projects", "alice", "POST", {
    projectId: local.id,
    name: "Desktop preview · SIMULATED mock runner",
    requestId: randomUUID(),
  })) as { id: string }
  await Promise.all(
    ["usr_bob", "usr_cara", "usr_drew"].map((userId) =>
      request(`/api/coordination/v1/projects/${project.id}/members`, "alice", "POST", {
        targetUserId: userId,
        requestId: randomUUID(),
      }),
    ),
  )
  const threads = await Promise.all(
    sessions.map(
      (session, index) =>
        request(`/api/coordination/v1/projects/${project.id}/threads`, "alice", "POST", {
          sessionId: session.id,
          title: index === 0 ? "Compact navigation experiment" : "Expanded navigation experiment",
          requestId: randomUUID(),
        }) as Promise<{ id: string }>,
    ),
  )

  for (const [index, thread] of threads.entries()) {
    const finding = await request(
      `/api/coordination/v1/threads/${thread.id}/comments`,
      index ? "bob" : "alice",
      "POST",
      {
        requestId: randomUUID(),
        body: index
          ? "SIMULATED preview: exploring a full navigation layout. This is a separate alternative."
          : "SIMULATED preview: exploring a compact navigation layout with keyboard access.",
      },
    )
    const instruction = (await request(`/api/coordination/v1/threads/${thread.id}/instructions`, "alice", "POST", {
      requestId: randomUUID(),
      text: index ? "Mock run: inspect expanded navigation" : "Mock run: inspect compact navigation",
    })) as { run: { id: string } }
    await request(`/api/coordination/v1/runner/threads/${thread.id}/reserve`, "worker", "POST", {})
    let snapshot: { thread: { activitySeq: number }; runs: { id: string; state: string }[] } | undefined
    for (let attempt = 0; attempt < 100; attempt++) {
      snapshot = (await request(`/api/coordination/v1/threads/${thread.id}`, "alice")) as typeof snapshot
      if (snapshot?.runs.some((run) => run.id === instruction.run.id && run.state === "completed")) break
      await Bun.sleep(50)
    }
    if (!snapshot?.runs.some((run) => run.id === instruction.run.id && run.state === "completed"))
      throw new Error(`Mock run for thread ${thread.id} did not complete`)
    const replay = (await request(`/api/coordination/v1/threads/${thread.id}/events?after=-1`, "alice")) as {
      events: { id: string; seq: number; kind: string }[]
    }
    const source = replay.events.find((event) => event.kind === "comment.created")
    if (!source) throw new Error(`Missing source event for thread ${thread.id}`)
    await request(`/api/coordination/v1/threads/${thread.id}/work-card`, "analysis", "PUT", {
      expectedVersion: 0,
      sourceActivitySeq: snapshot.thread.activitySeq,
      card: {
        currentTask: index ? "Explore expanded navigation" : "Explore compact navigation",
        progress: "SIMULATED mock run completed; no model or Flower analysis was used.",
        blockers: [],
        status: "active",
        summaryJobId: `preview-${index}`,
        recentVerifiedOutcome: "The registered mock runner produced a test output.",
        contributors: index ? ["usr_alice", "usr_bob"] : ["usr_alice"],
        evidenceRefs: [{ threadId: thread.id, eventId: source.id, seq: source.seq }],
        generatedAt: new Date().toISOString(),
      },
    })
  }

  scheduler = setInterval(() => {
    threads.forEach((thread) => {
      void request(`/api/coordination/v1/runner/threads/${thread.id}/reserve`, "worker", "POST", {}).catch((error) =>
        console.error(`Mock runner reserve failed for ${thread.id}:`, error),
      )
    })
  }, 1_000)
  console.log(`Preview ready at ${origin}; member credentials: ${join(directory, "member.json")}`)
  console.log(`Isolated data: ${directory}; mock runner only, no model or Flower execution.`)
  if (!serverOnly) {
    desktop = Bun.spawn(
      [process.execPath, "run", "--cwd", "packages/desktop", "dev", "--", "--remoteDebuggingPort", String(debugPort)],
      {
        cwd: repository,
        env: {
          ...env,
          OPENCODE_DESKTOP_SERVER_URL: origin,
          OPENCODE_DESKTOP_PROFILE: join(directory, "desktop"),
          OPENCODE_DESKTOP_RENDERER_PORT: String(rendererPort),
        },
        stdout: "inherit",
        stderr: "inherit",
      },
    )
  }
  await Promise.race([server.exited, ...(desktop ? [desktop.exited] : [])])
} finally {
  stop()
}
