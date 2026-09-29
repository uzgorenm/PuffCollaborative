import { Database } from "bun:sqlite"
import { mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

export const users = {
  alice: { password: "alice-fixture-secret", auth: { kind: "member", userId: "usr_alice" } },
  bob: { password: "bob-fixture-secret", auth: { kind: "member", userId: "usr_bob" } },
  carol: { password: "carol-fixture-secret", auth: { kind: "member", userId: "usr_carol" } },
  dan: { password: "dan-fixture-secret", auth: { kind: "member", userId: "usr_dan" } },
  eve: { password: "eve-fixture-secret", auth: { kind: "member", userId: "usr_eve" } },
  worker: {
    password: "worker-fixture-secret",
    auth: { kind: "runner", workerId: "wrk_e2e", instanceId: "fake-instance" },
  },
  staleWorker: {
    password: "stale-worker-fixture-secret",
    auth: { kind: "runner", workerId: "wrk_e2e", instanceId: "stale-instance" },
  },
  analysis: { password: "analysis-fixture-secret", auth: { kind: "analysis", serviceId: "fixture-analysis" } },
} as const

export type User = keyof typeof users
export type HttpResult<T = Record<string, unknown>> = { status: number; data: T; headers: Headers }
export type Snapshot = {
  thread: { id: string; projectId: string; sessionId: string; activitySeq: number }
  instructions: Array<{ id: string; threadId: string; runId: string; text: string; queueSeq: number; actorId: string }>
  runs: Array<{ id: string; instructionId: string; state: string; runnerMessageId: string }>
  approvals: Array<{ id: string; runId: string; version: number; state: string; decisionId?: string }>
  workCard?: { version: number; sourceActivitySeq: number }
  cursor: number
}
export type Event = {
  id: string
  seq: number
  kind: string
  threadId?: string
  runId?: string
  instructionId?: string
  actorId?: string
  payload: Record<string, unknown>
}
export type Replay = { events: Event[]; cursor: number; hasMore: boolean }
export type FakeState = {
  attempts: Array<{ runId: string; threadId: string; sessionId: string; runnerMessageId: string; text: string }>
  starts: Array<{ runId: string; threadId: string; sessionId: string; runnerMessageId: string; text: string }>
  executions: string[]
  callbacks: Array<{ runId: string; callbackId: string; status: number }>
  interrupts: Array<{ runId: string; sessionId: string }>
  decisions: Array<{ runId: string; decisionId: string; decision: string }>
  polls: Array<{ threadId: string; status: number; runId?: string }>
  runs: Array<{ id: string; status: string }>
}

async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") return reject(new Error("No local port"))
      server.close(() => resolve(address.port))
    })
  })
}

export async function until<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  label: string,
  timeoutMs = 8_000,
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await read()
    if (accept(value)) return value
    await Bun.sleep(25)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

export async function startHarness(initialize?: (dbPath: string) => void | Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "puff-coordination-e2e-"))
  const dbPath = join(directory, "opencode.sqlite")
  const identitiesPath = join(directory, "identities.json")
  const admissionsPath = join(directory, "admissions.json")
  const coordinatorPort = await freePort()
  const runnerPort = await freePort()
  const coordinatorUrl = `http://127.0.0.1:${coordinatorPort}`
  const runnerUrl = `http://127.0.0.1:${runnerPort}`
  await Bun.write(
    identitiesPath,
    JSON.stringify({
      identities: await Promise.all(
        Object.entries(users).map(async ([username, user]) => ({
          username,
          passwordHash: await Bun.password.hash(user.password),
          auth: user.auth,
        })),
      ),
    }),
  )
  await Bun.write(
    admissionsPath,
    JSON.stringify({
      allowed: [
        { userId: "usr_alice", projectId: "prj_e2e_main" },
        { userId: "usr_dan", projectId: "prj_e2e_other" },
      ],
    }),
  )
  if (initialize) await initialize(dbPath)

  const childEnv = {
    ...process.env,
    PUFF_COORDINATION_E2E: "1",
    PUFF_E2E_COORDINATOR_PORT: String(coordinatorPort),
    PUFF_E2E_COORDINATOR_URL: coordinatorUrl,
    PUFF_E2E_RUNNER_PORT: String(runnerPort),
    PUFF_E2E_FAKE_URL: runnerUrl,
    PUFF_E2E_WORKER_ID: "wrk_e2e",
    PUFF_E2E_RUNNER_USER: "worker",
    PUFF_E2E_RUNNER_PASSWORD: users.worker.password,
    OPENCODE_DB: dbPath,
    OPENCODE_COORDINATION_IDENTITIES_PATH: identitiesPath,
    OPENCODE_COORDINATION_ADMISSIONS_PATH: admissionsPath,
  }
  const spawn = (script: string) =>
    Bun.spawn([process.execPath, join(import.meta.dir, script)], {
      cwd: join(import.meta.dir, "../.."),
      env: childEnv,
      stdout: "inherit",
      stderr: "inherit",
    })
  const fake = spawn("fake-runner.ts")
  let coordinator = spawn("coordinator.ts")
  const ready = async (url: string) => {
    await until(
      async () =>
        fetch(url)
          .then((response) => response.status)
          .catch(() => 0),
      (status) => status === 200,
      `server at ${url}`,
      20_000,
    )
  }
  try {
    await ready(`${runnerUrl}/health`)
    await ready(`${coordinatorUrl}/api/coordination/v1/status`)
  } catch (error) {
    fake.kill("SIGTERM")
    coordinator.kill("SIGTERM")
    await Promise.all([fake.exited, coordinator.exited])
    await rm(directory, { recursive: true, force: true })
    throw error
  }

  const request = async <T = Record<string, unknown>>(
    path: string,
    user?: User,
    method = "GET",
    payload?: unknown,
  ): Promise<HttpResult<T>> => {
    const headers = new Headers()
    if (user) headers.set("authorization", `Basic ${Buffer.from(`${user}:${users[user].password}`).toString("base64")}`)
    if (payload !== undefined) headers.set("content-type", "application/json")
    const response = await fetch(`${coordinatorUrl}${path}`, {
      method,
      headers,
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    })
    const data = response.headers.get("content-type")?.includes("json") ? await response.json() : await response.text()
    return { status: response.status, data: data as T, headers: response.headers }
  }
  const admin = async <T = Record<string, unknown>>(path: string, payload?: unknown): Promise<T> => {
    const response = await fetch(`${runnerUrl}/admin/${path}`, {
      method: payload === undefined ? "GET" : "POST",
      headers: payload === undefined ? undefined : { "content-type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    })
    if (!response.ok) throw new Error(`Fake control ${path}: ${response.status}`)
    return (await response.json()) as T
  }
  const seed = (projectId: string, sessionIds: string[]) => {
    const sqlite = new Database(dbPath)
    const now = Date.now()
    sqlite.run(
      "CREATE TABLE IF NOT EXISTS puff_e2e_session_selection (user_id TEXT NOT NULL, project_id TEXT NOT NULL, session_id TEXT NOT NULL, worker_id TEXT NOT NULL, PRIMARY KEY (user_id, project_id, session_id, worker_id))",
    )
    sqlite
      .query("INSERT INTO project (id, worktree, sandboxes, time_created, time_updated) VALUES (?, ?, ?, ?, ?)")
      .run(projectId, directory, "[]", now, now)
    sessionIds.forEach((id) =>
      sqlite
        .query(
          "INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(id, projectId, id, directory, id, "fixture", now, now),
    )
    sqlite.close()
  }
  const selectSession = (userId: string, projectId: string, sessionId: string) => {
    const sqlite = new Database(dbPath)
    sqlite
      .query(
        "INSERT OR IGNORE INTO puff_e2e_session_selection (user_id, project_id, session_id, worker_id) VALUES (?, ?, ?, ?)",
      )
      .run(userId, projectId, sessionId, "wrk_e2e")
    sqlite.close()
  }
  const snapshot = async (threadId: string, user: User = "alice") =>
    (await request<Snapshot>(`/api/coordination/v1/threads/${threadId}`, user)).data
  const replay = async (projectId: string, after = -1, user: User = "alice") =>
    (await request<Replay>(`/api/coordination/v1/projects/${projectId}/events?after=${after}&limit=256`, user)).data
  const state = () => admin<FakeState>("state")
  const callback = (runId: string, callbackId: string, value: unknown, duplicate = false) =>
    admin<{ first: HttpResult; second?: HttpResult }>("callback", { runId, callbackId, callback: value, duplicate })
  const reserve = (threadId: string, user: User = "worker") =>
    request<{ run?: { id: string; state: string } }>(
      `/api/coordination/v1/runner/threads/${threadId}/reserve`,
      user,
      "POST",
    )
  const stopCoordinator = async () => {
    coordinator.kill("SIGKILL")
    await coordinator.exited
  }
  const restartCoordinator = async () => {
    await stopCoordinator()
    coordinator = spawn("coordinator.ts")
    await ready(`${coordinatorUrl}/api/coordination/v1/status`)
  }
  const close = async () => {
    coordinator.kill("SIGTERM")
    fake.kill("SIGTERM")
    await Promise.all([coordinator.exited, fake.exited])
    if (process.env.PUFF_E2E_KEEP !== "1") await rm(directory, { recursive: true, force: true })
    else console.log(`Kept disposable fixture: ${directory}`)
  }

  return {
    directory,
    dbPath,
    coordinatorUrl,
    runnerUrl,
    request,
    admin,
    seed,
    selectSession,
    snapshot,
    replay,
    state,
    callback,
    reserve,
    stopCoordinator,
    restartCoordinator,
    close,
  }
}

export type Harness = Awaited<ReturnType<typeof startHarness>>
