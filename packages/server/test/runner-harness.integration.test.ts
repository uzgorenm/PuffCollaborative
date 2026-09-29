import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { Effect, Option } from "effect"
import { withCliFixture } from "../../opencode/test/lib/cli-process"
import { testProviderConfig } from "../../opencode/test/lib/test-provider"

const exec = promisify(execFile)
const gitExecutable = Bun.which("git") ?? "git"
const bunExecutable = Bun.which("bun") ?? "bun"

async function git(directory: string, ...args: string[]) {
  return (await exec(gitExecutable, args, { cwd: directory, encoding: "utf8" })).stdout.trim()
}

async function source(home: string) {
  const repository = path.join(home, "source")
  const workspaces = path.join(home, "workspaces")
  await fs.mkdir(repository)
  await fs.mkdir(workspaces)
  await git(repository, "init", "-q")
  await git(repository, "config", "user.name", "Runner Fixture")
  await git(repository, "config", "user.email", "runner@example.test")
  await fs.writeFile(path.join(repository, "shared.txt"), "base\n")
  await git(repository, "add", "shared.txt")
  await git(repository, "commit", "-qm", "base")
  const revision = await git(repository, "rev-parse", "HEAD")
  return { repository, workspaces, revision, projectId: revision }
}

async function workspace(repository: string, workspaces: string, name: string, revision: string) {
  const directory = path.join(workspaces, name)
  await git(repository, "worktree", "add", "-b", `r13/${name}`, directory, revision)
  return directory
}

async function roster(home: string, projectId: string) {
  const identitiesPath = path.join(home, "identities.json")
  const admissionsPath = path.join(home, "admissions.json")
  const people = [
    { username: "alice", password: "alice-fixture-secret", auth: { kind: "member", userId: "usr_r13_alice" } },
    {
      username: "worker",
      password: "worker-fixture-secret",
      auth: { kind: "runner", workerId: "wrk_r13", instanceId: "r13-instance" },
    },
    {
      username: "stale-worker",
      password: "stale-fixture-secret",
      auth: { kind: "runner", workerId: "wrk_r13", instanceId: "retired-instance" },
    },
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
  await Bun.write(admissionsPath, JSON.stringify({ allowed: [{ userId: "usr_r13_alice", projectId }] }))
  return { identitiesPath, admissionsPath, people }
}

function request(base: string, username: string, password: string) {
  return async <T>(route: string, method = "GET", payload?: unknown) => {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: {
        authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        ...(payload === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    })
    const data = response.headers.get("content-type")?.includes("json") ? await response.json() : undefined
    return { status: response.status, data: data as T }
  }
}

async function until<T>(read: () => Promise<T>, matches: (value: T) => boolean, label: string) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const value = await read()
    if (matches(value)) return value
    await Bun.sleep(25)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function faultHost(
  root: string,
  modelUrl: string,
  dbPath: string,
  configPath: string,
  identity: Awaited<ReturnType<typeof roster>>,
  outagePath: string,
) {
  const readyPath = path.join(root, `ready-${crypto.randomUUID()}`)
  const child = Bun.spawn([bunExecutable, "run", path.join(import.meta.dir, "runner-harness.fixture.ts")], {
    cwd: root,
    env: {
      ...process.env,
      OPENCODE_TEST_HOME: root,
      HOME: root,
      XDG_CONFIG_HOME: path.join(root, ".config"),
      XDG_DATA_HOME: path.join(root, ".local/share"),
      XDG_STATE_HOME: path.join(root, ".local/state"),
      XDG_CACHE_HOME: path.join(root, ".cache"),
      OPENCODE_CONFIG_CONTENT: JSON.stringify(testProviderConfig(modelUrl)),
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_PURE: "1",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_DISABLE_AUTOCOMPACT: "1",
      OPENCODE_DISABLE_MODELS_FETCH: "1",
      OPENCODE_AUTH_CONTENT: "{}",
      OPENCODE_DB: dbPath,
      OPENCODE_RUNNER_CONFIG_PATH: configPath,
      OPENCODE_RUNNER_PASSWORD: "worker-fixture-secret",
      OPENCODE_SERVER_PASSWORD: "runtime-fixture-secret",
      OPENCODE_COORDINATION_IDENTITIES_PATH: identity.identitiesPath,
      OPENCODE_COORDINATION_ADMISSIONS_PATH: identity.admissionsPath,
      OPENCODE_COORDINATION_MOCK_RUNNER: "0",
      R13_RUNNER_FIXTURE: "1",
      R13_CALLBACK_OUTAGE_PATH: outagePath,
      R13_READY_PATH: readyPath,
    },
    stdout: "ignore",
    stderr: "pipe",
  })
  const stderr = new Response(child.stderr).text()
  const url = await until(
    async () => ((await Bun.file(readyPath).exists()) ? Bun.file(readyPath).text() : undefined),
    (value) => value !== undefined,
    "fault fixture server startup",
  ).catch(async (error) => {
    child.kill()
    await child.exited
    throw new Error(`${error}: ${await stderr}`)
  })
  return { child, url: url!, stderr }
}

test("an authorized coordinator Run completes through the embedded OpenCode runner", async () => {
  await Effect.runPromise(
    Effect.scoped(
      withCliFixture(({ home, llm, opencode }) =>
        Effect.gen(function* () {
          const root = yield* Effect.promise(() => fs.realpath(home))
          const prepared = yield* Effect.promise(() => source(root))
          const directory = yield* Effect.promise(() =>
            workspace(prepared.repository, prepared.workspaces, "first-thread", prepared.revision),
          )
          const otherDirectory = yield* Effect.promise(() =>
            workspace(prepared.repository, prepared.workspaces, "second-thread", prepared.revision),
          )
          const approvalDirectory = yield* Effect.promise(() =>
            workspace(prepared.repository, prepared.workspaces, "approval-thread", prepared.revision),
          )
          const modelConfig = testProviderConfig(llm.url)
          Reflect.deleteProperty(modelConfig.provider.test, "env")
          yield* Effect.promise(() => Bun.write(path.join(directory, "opencode.json"), JSON.stringify(modelConfig)))
          yield* Effect.promise(() =>
            Bun.write(path.join(otherDirectory, "opencode.json"), JSON.stringify(modelConfig)),
          )
          yield* Effect.promise(() =>
            Bun.write(
              path.join(approvalDirectory, "opencode.json"),
              JSON.stringify({
                ...modelConfig,
                permission: { edit: "ask" },
              }),
            ),
          )
          const identity = yield* Effect.promise(() => roster(root, prepared.projectId))
          const dbPath = path.join(root, "runner.sqlite")
          const configPath = path.join(root, "runner.json")
          yield* Effect.promise(() =>
            Bun.write(
              configPath,
              JSON.stringify({
                owner: { workerId: "wrk_r13", instanceId: "r13-instance" },
                username: "worker",
                workspaceRoot: prepared.workspaces,
                projects: [
                  {
                    projectId: prepared.projectId,
                    repositoryRoot: prepared.repository,
                    baseRevision: prepared.revision,
                  },
                ],
                toolPath: "/usr/bin:/bin",
                deliveryIntervalMs: 25,
              }),
            ),
          )
          yield* llm.text("R13 deterministic response")
          const processEnv = {
            OPENCODE_DB: dbPath,
            OPENCODE_RUNNER_CONFIG_PATH: configPath,
            OPENCODE_RUNNER_PASSWORD: "worker-fixture-secret",
            OPENCODE_SERVER_PASSWORD: "runtime-fixture-secret",
            OPENCODE_COORDINATION_IDENTITIES_PATH: identity.identitiesPath,
            OPENCODE_COORDINATION_ADMISSIONS_PATH: identity.admissionsPath,
            OPENCODE_COORDINATION_MOCK_RUNNER: "0",
          }
          const server = yield* opencode.serve({ env: processEnv, readyTimeoutMs: 30_000 })
          const alice = request(server.url, "alice", "alice-fixture-secret")
          const worker = request(server.url, "worker", "worker-fixture-secret")
          expect((yield* Effect.promise(() => alice("/api/coordination/v1/status"))).status).toBe(200)

          yield* Effect.promise(async () => {
            const sqlite = new Database(dbPath)
            const now = Date.now()
            sqlite
              .query("INSERT INTO project (id, worktree, sandboxes, time_created, time_updated) VALUES (?, ?, ?, ?, ?)")
              .run(prepared.projectId, prepared.repository, "[]", now, now)
            sqlite
              .query(
                "INSERT INTO session (id, project_id, workspace_id, slug, directory, title, version, model, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              )
              .run(
                "ses_r13_first",
                prepared.projectId,
                "wrk_r13_first",
                "ses_r13_first",
                directory,
                "R13 first",
                "fixture",
                JSON.stringify({ id: "test-model", providerID: "test" }),
                now,
                now,
              )
            sqlite
              .query(
                "INSERT INTO session (id, project_id, workspace_id, slug, directory, title, version, model, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              )
              .run(
                "ses_r13_approval",
                prepared.projectId,
                "wrk_r13_approval",
                "ses_r13_approval",
                approvalDirectory,
                "R13 approval",
                "fixture",
                JSON.stringify({ id: "test-model", providerID: "test" }),
                now,
                now,
              )
            sqlite
              .query(
                "INSERT INTO session (id, project_id, workspace_id, slug, directory, title, version, model, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              )
              .run(
                "ses_r13_second",
                prepared.projectId,
                "wrk_r13_second",
                "ses_r13_second",
                otherDirectory,
                "R13 second",
                "fixture",
                JSON.stringify({ id: "test-model", providerID: "test" }),
                now,
                now,
              )
            sqlite.close()
          })
          const project = yield* Effect.promise(() =>
            alice<{ id: string }>("/api/coordination/v1/projects", "POST", {
              projectId: prepared.projectId,
              name: "R13 fixture",
              requestId: "r13-project",
            }),
          )
          expect(project.status).toBe(200)
          const thread = yield* Effect.promise(() =>
            alice<{ id: string }>(`/api/coordination/v1/projects/${prepared.projectId}/threads`, "POST", {
              sessionId: "ses_r13_first",
              title: "R13 first",
              requestId: "r13-thread",
            }),
          )
          expect(thread.status).toBe(200)
          const instruction = yield* Effect.promise(() =>
            alice<{ run: { id: string; runnerMessageId: string } }>(
              `/api/coordination/v1/threads/${thread.data.id}/instructions`,
              "POST",
              { requestId: "r13-instruction", text: "Reply with the fixture response." },
            ),
          )
          expect(instruction.status).toBe(200)
          const reserved = yield* Effect.promise(() =>
            worker<{ run: { id: string } }>(`/api/coordination/v1/runner/threads/${thread.data.id}/reserve`, "POST"),
          )
          if (reserved.status !== 200) console.log("R13_RESERVE_FAILURE", reserved.status, reserved.data)
          expect(reserved.status).toBe(200)
          expect(reserved.data.run.id).toBe(instruction.data.run.id)
          const modelCalled = yield* llm.wait(1).pipe(Effect.timeoutOption("10 seconds"))
          if (Option.isNone(modelCalled)) {
            const diagnostic = yield* Effect.sync(() => {
              const sqlite = new Database(dbPath)
              const local = sqlite
                .query("SELECT phase, admitted_message_id, last_session_seq FROM runner_harness_execution")
                .all()
              const input = sqlite.query("SELECT id, admitted_seq, promoted_seq FROM session_input").all()
              const messages = sqlite.query("SELECT id, type, seq FROM session_message ORDER BY seq").all()
              const events = sqlite
                .query("SELECT aggregate_id, seq, type FROM event WHERE aggregate_id = ? ORDER BY seq")
                .all("ses_r13_first")
              const outbox = sqlite
                .query("SELECT ordinal, producer_key, acknowledged_at FROM runner_harness_outbox ORDER BY ordinal")
                .all()
              const epoch = sqlite.query("SELECT session_id, baseline_seq FROM session_context_epoch").all()
              const session = sqlite.query("SELECT id, model, agent FROM session WHERE id = ?").get("ses_r13_first")
              sqlite.close()
              return { local, input, messages, events, outbox, epoch, session }
            })
            const provider = yield* Effect.promise(async () => {
              const response = await fetch(`${server.url}/api/model`, {
                headers: {
                  authorization: `Basic ${Buffer.from("opencode:runtime-fixture-secret").toString("base64")}`,
                  "x-opencode-directory": directory,
                },
              })
              const body = response.headers.get("content-type")?.includes("json") ? await response.json() : undefined
              return {
                status: response.status,
                keys: body && typeof body === "object" ? Object.keys(body) : [],
                models:
                  body && typeof body === "object" && "data" in body && Array.isArray(body.data)
                    ? body.data.map((item: { id?: string; providerID?: string }) => ({
                        id: item.id,
                        providerID: item.providerID,
                      }))
                    : [],
              }
            })
            const logs = yield* Effect.promise(() =>
              fs.readFile(path.join(root, ".local/share/opencode/log/opencode.log"), "utf8").catch(() => ""),
            )
            console.log("R13_MODEL_WAIT_FAILURE", {
              ...diagnostic,
              provider,
              logs: logs
                .split("\n")
                .filter((line) => /Failed to drain|ModelUnavailable|SessionRunner|error/i.test(line))
                .slice(-16),
            })
            throw new Error("Embedded runner did not call the deterministic model")
          }
          const snapshot = yield* Effect.promise(() =>
            until(
              () =>
                alice<{ runs: Array<{ id: string; state: string }> }>(`/api/coordination/v1/threads/${thread.data.id}`),
              (value) => value.data.runs.some((run) => run.id === instruction.data.run.id && run.state === "completed"),
              "completed coordinator Run",
            ),
          )
          expect(snapshot.status).toBe(200)
          const replay = yield* Effect.promise(() =>
            alice<{ events: Array<{ kind: string; runId?: string; seq: number }> }>(
              `/api/coordination/v1/projects/${prepared.projectId}/events?after=-1&limit=256`,
            ),
          )
          const events = replay.data.events.filter((event) => event.runId === instruction.data.run.id)
          expect(events.map((event) => event.kind)).toContain("run.started")
          expect(events.map((event) => event.kind)).toContain("run.output")
          expect(events.at(-1)?.kind).toBe("run.completed")
          expect(events.findIndex((event) => event.kind === "run.started")).toBeLessThan(
            events.findIndex((event) => event.kind === "run.output"),
          )
          expect(events.findIndex((event) => event.kind === "run.output")).toBeLessThan(events.length - 1)
          expect(yield* llm.calls).toBe(1)
          expect(yield* Effect.promise(() => fs.readFile(path.join(directory, "shared.txt"), "utf8"))).toBe("base\n")
          expect(
            (yield* Effect.promise(() =>
              request(server.url, "opencode", "runtime-fixture-secret")("/api/session/ses_r13_first/prompt", "POST", {
                text: "bypass",
              }),
            )).status,
          ).toBe(403)
          const duplicate = yield* Effect.promise(() =>
            alice<{ run: { id: string } }>(`/api/coordination/v1/threads/${thread.data.id}/instructions`, "POST", {
              requestId: "r13-instruction",
              text: "Reply with the fixture response.",
            }),
          )
          expect(duplicate.status).toBe(200)
          expect(duplicate.data.run.id).toBe(instruction.data.run.id)
          const noPending = yield* Effect.promise(() =>
            worker<{ run?: { id: string } }>(`/api/coordination/v1/runner/threads/${thread.data.id}/reserve`, "POST"),
          )
          expect(noPending.status).toBe(200)
          expect(noPending.data.run).toBeNull()
          expect(yield* llm.calls).toBe(1)

          yield* Effect.promise(() => fs.writeFile(path.join(directory, "turn-marker.txt"), "retained\n"))
          yield* llm.text("R13 second response")
          const next = yield* Effect.promise(() =>
            alice<{ run: { id: string } }>(`/api/coordination/v1/threads/${thread.data.id}/instructions`, "POST", {
              requestId: "r13-second",
              text: "Continue the same session and acknowledge the earlier answer.",
            }),
          )
          expect(next.status).toBe(200)
          const second = yield* Effect.promise(() =>
            worker<{ run: { id: string } }>(`/api/coordination/v1/runner/threads/${thread.data.id}/reserve`, "POST"),
          )
          expect(second.status).toBe(200)
          expect(second.data.run.id).toBe(next.data.run.id)
          yield* Effect.promise(() =>
            until(
              () =>
                alice<{ runs: Array<{ id: string; state: string }> }>(`/api/coordination/v1/threads/${thread.data.id}`),
              (value) => value.data.runs.some((run) => run.id === next.data.run.id && run.state === "completed"),
              "second completed coordinator Run",
            ),
          )
          expect(yield* llm.calls).toBe(2)
          expect(yield* Effect.promise(() => fs.readFile(path.join(directory, "turn-marker.txt"), "utf8"))).toBe(
            "retained\n",
          )
          const inputs = yield* llm.inputs
          expect(JSON.stringify(inputs[1])).toContain("R13 deterministic response")
          expect(JSON.stringify(inputs[1])).toContain("Reply with the fixture response.")
          const continuity = yield* Effect.sync(() => {
            const sqlite = new Database(dbPath)
            const rows = sqlite
              .query("SELECT id, type, seq FROM session_message WHERE session_id = ? ORDER BY seq")
              .all("ses_r13_first") as Array<{ id: string; type: string; seq: number }>
            const bindings = sqlite.query("SELECT thread_id, session_id, directory FROM runner_harness_thread").all()
            sqlite.close()
            return { rows, bindings }
          })
          expect(continuity.rows.filter((row) => row.type === "user")).toHaveLength(2)
          expect(continuity.bindings).toHaveLength(1)

          const barrier = Promise.withResolvers<void>()
          yield* llm.hold("R13 held response", barrier.promise)
          const held = yield* Effect.promise(() =>
            alice<{ run: { id: string } }>(`/api/coordination/v1/threads/${thread.data.id}/instructions`, "POST", {
              requestId: "r13-held",
              text: "Hold this thread while another thread executes.",
            }),
          )
          expect(held.status).toBe(200)
          expect(
            (yield* Effect.promise(() =>
              worker<{ run: { id: string } }>(`/api/coordination/v1/runner/threads/${thread.data.id}/reserve`, "POST"),
            )).data.run.id,
          ).toBe(held.data.run.id)
          yield* llm.wait(3)
          const queued = yield* Effect.promise(() =>
            alice<{ run: { id: string } }>(`/api/coordination/v1/threads/${thread.data.id}/instructions`, "POST", {
              requestId: "r13-queued",
              text: "Wait behind the held turn.",
            }),
          )
          expect(queued.status).toBe(200)
          const occupied = yield* Effect.promise(() =>
            worker<{ run: { id: string } | null }>(
              `/api/coordination/v1/runner/threads/${thread.data.id}/reserve`,
              "POST",
            ),
          )
          expect(occupied.status).toBe(200)
          expect(occupied.data.run).toBeNull()

          const other = yield* Effect.promise(() =>
            alice<{ id: string }>(`/api/coordination/v1/projects/${prepared.projectId}/threads`, "POST", {
              sessionId: "ses_r13_second",
              title: "R13 second",
              requestId: "r13-other-thread",
            }),
          )
          expect(other.status).toBe(200)
          yield* llm.text("R13 independent response")
          const parallel = yield* Effect.promise(() =>
            alice<{ run: { id: string } }>(`/api/coordination/v1/threads/${other.data.id}/instructions`, "POST", {
              requestId: "r13-parallel",
              text: "Reply independently in this thread.",
            }),
          )
          expect(parallel.status).toBe(200)
          expect(
            (yield* Effect.promise(() =>
              worker<{ run: { id: string } }>(`/api/coordination/v1/runner/threads/${other.data.id}/reserve`, "POST"),
            )).data.run.id,
          ).toBe(parallel.data.run.id)
          yield* Effect.promise(() =>
            until(
              () =>
                alice<{ runs: Array<{ id: string; state: string }> }>(`/api/coordination/v1/threads/${other.data.id}`),
              (value) => value.data.runs.some((run) => run.id === parallel.data.run.id && run.state === "completed"),
              "parallel coordinator Run",
            ),
          )
          const firstWhileHeld = yield* Effect.promise(() =>
            alice<{ runs: Array<{ id: string; state: string }> }>(`/api/coordination/v1/threads/${thread.data.id}`),
          )
          expect(firstWhileHeld.data.runs.find((run) => run.id === held.data.run.id)?.state).toBe("running")
          expect(yield* llm.calls).toBe(4)
          expect(JSON.stringify((yield* llm.inputs)[3])).toContain("Reply independently in this thread.")
          expect(JSON.stringify((yield* llm.inputs)[3])).not.toContain("R13 deterministic response")
          yield* Effect.promise(() =>
            fs.writeFile(path.join(otherDirectory, "parallel-marker.txt"), "second workspace\n"),
          )
          expect(yield* Effect.promise(() => fs.readFile(path.join(directory, "turn-marker.txt"), "utf8"))).toBe(
            "retained\n",
          )
          expect(
            yield* Effect.promise(() => fs.readFile(path.join(otherDirectory, "parallel-marker.txt"), "utf8")),
          ).toBe("second workspace\n")
          yield* Effect.sync(() => barrier.resolve())
          yield* Effect.promise(() =>
            until(
              () =>
                alice<{ runs: Array<{ id: string; state: string }> }>(`/api/coordination/v1/threads/${thread.data.id}`),
              (value) => value.data.runs.some((run) => run.id === held.data.run.id && run.state === "completed"),
              "held coordinator Run",
            ),
          )
          yield* llm.text("R13 queued response")
          const afterHeld = yield* Effect.promise(() =>
            worker<{ run: { id: string } }>(`/api/coordination/v1/runner/threads/${thread.data.id}/reserve`, "POST"),
          )
          expect(afterHeld.status).toBe(200)
          expect(afterHeld.data.run.id).toBe(queued.data.run.id)
          yield* Effect.promise(() =>
            until(
              () =>
                alice<{ runs: Array<{ id: string; state: string }> }>(`/api/coordination/v1/threads/${thread.data.id}`),
              (value) => value.data.runs.some((run) => run.id === queued.data.run.id && run.state === "completed"),
              "queued coordinator Run",
            ),
          )
          expect(yield* llm.calls).toBe(5)

          const approvalThread = yield* Effect.promise(() =>
            alice<{ id: string }>(`/api/coordination/v1/projects/${prepared.projectId}/threads`, "POST", {
              sessionId: "ses_r13_approval",
              title: "R13 approval",
              requestId: "r13-approval-thread",
            }),
          )
          expect(approvalThread.status).toBe(200)
          yield* llm.tool("write", { path: "artifact.txt", content: "from runner\n" })
          yield* llm.text("R13 write complete")
          const approvalInstruction = yield* Effect.promise(() =>
            alice<{ run: { id: string } }>(
              `/api/coordination/v1/threads/${approvalThread.data.id}/instructions`,
              "POST",
              {
                requestId: "r13-approval-instruction",
                text: "Write a fixture artifact.",
              },
            ),
          )
          expect(approvalInstruction.status).toBe(200)
          expect(
            (yield* Effect.promise(() =>
              worker<{ run: { id: string } }>(
                `/api/coordination/v1/runner/threads/${approvalThread.data.id}/reserve`,
                "POST",
              ),
            )).data.run.id,
          ).toBe(approvalInstruction.data.run.id)
          const awaitingApproval = yield* Effect.promise(() =>
            until(
              () =>
                alice<{
                  runs: Array<{ id: string; state: string }>
                  approvals: Array<{ id: string; version: number }>
                }>(`/api/coordination/v1/threads/${approvalThread.data.id}`),
              (value) =>
                value.data.runs.some(
                  (run) => run.id === approvalInstruction.data.run.id && run.state === "waiting_approval",
                ) && value.data.approvals.length === 1,
              "real permission approval",
            ),
          )
          expect(awaitingApproval.data.approvals).toHaveLength(1)
          expect(yield* Effect.promise(() => Bun.file(path.join(approvalDirectory, "artifact.txt")).exists())).toBe(
            false,
          )
          const approval = awaitingApproval.data.approvals[0]
          const decisionRoute = `/api/coordination/v1/threads/${approvalThread.data.id}/approvals/${approval.id}/decision`
          const acceptedDecision = yield* Effect.promise(() =>
            alice(decisionRoute, "POST", {
              expectedVersion: approval.version,
              decisionId: "r13-approve-once",
              decision: "approve",
            }),
          )
          expect(acceptedDecision.status).toBe(200)
          yield* Effect.promise(() =>
            until(
              () =>
                alice<{ runs: Array<{ id: string; state: string }> }>(
                  `/api/coordination/v1/threads/${approvalThread.data.id}`,
                ),
              (value) =>
                value.data.runs.some((run) => run.id === approvalInstruction.data.run.id && run.state === "completed"),
              "approved Run completion",
            ),
          )
          expect(yield* Effect.promise(() => fs.readFile(path.join(approvalDirectory, "artifact.txt"), "utf8"))).toBe(
            "from runner\n",
          )
          expect(yield* Effect.promise(() => Bun.file(path.join(directory, "artifact.txt")).exists())).toBe(false)
          expect(yield* Effect.promise(() => Bun.file(path.join(otherDirectory, "artifact.txt")).exists())).toBe(false)
          const artifactReport = yield* Effect.sync(() => {
            const sqlite = new Database(dbPath)
            const row = sqlite
              .query("SELECT artifact_report FROM runner_harness_execution WHERE run_id = ?")
              .get(approvalInstruction.data.run.id) as { artifact_report: string | null }
            sqlite.close()
            return row.artifact_report
              ? (JSON.parse(row.artifact_report) as {
                  scopes: {
                    run: { changed: Array<{ path: string; dirtyBeforeRun: boolean }> }
                    beforeRun: { changed: Array<{ path: string }> }
                  }
                })
              : undefined
          })
          expect(
            artifactReport?.scopes.run.changed.some(
              (change) => change.path === "artifact.txt" && !change.dirtyBeforeRun,
            ),
          ).toBe(true)
          expect(artifactReport?.scopes.beforeRun.changed.some((change) => change.path === "opencode.json")).toBe(true)
          const approvalEvents = yield* Effect.promise(() =>
            alice<{ events: Array<{ kind: string; runId?: string }> }>(
              `/api/coordination/v1/projects/${prepared.projectId}/events?after=-1&limit=256`,
            ),
          )
          const approvalKinds = approvalEvents.data.events
            .filter((event) => event.runId === approvalInstruction.data.run.id)
            .map((event) => event.kind)
          expect(approvalKinds).toContain("run.approval.requested")
          expect(approvalKinds).toContain("run.approval.resolved")
          expect(approvalKinds.at(-1)).toBe("run.completed")
          expect(approvalKinds.indexOf("run.tool")).toBeLessThan(approvalKinds.indexOf("run.approval.requested"))
          expect(approvalKinds.indexOf("run.approval.requested")).toBeLessThan(approvalKinds.indexOf("run.output"))
          expect(approvalKinds.indexOf("run.output")).toBeLessThan(approvalKinds.length - 1)
          expect(
            (yield* Effect.promise(() =>
              request(server.url, "stale-worker", "stale-fixture-secret")(
                `/api/coordination/v1/runner/runs/${approvalInstruction.data.run.id}/events`,
                "POST",
                {
                  callbackId: "stale-owner",
                  callback: { kind: "state", expectedState: "running", nextState: "completed" },
                },
              ),
            )).status,
          ).toBe(403)
          expect(
            (yield* Effect.promise(() =>
              alice(`/api/coordination/v1/runner/threads/${thread.data.id}/reserve`, "POST"),
            )).status,
          ).toBe(403)

          yield* llm.hang
          const cancellable = yield* Effect.promise(() =>
            alice<{ instruction: { id: string }; run: { id: string } }>(
              `/api/coordination/v1/threads/${thread.data.id}/instructions`,
              "POST",
              {
                requestId: "r13-cancellable",
                text: "Stay active until cancelled.",
              },
            ),
          )
          expect(cancellable.status).toBe(200)
          expect(
            (yield* Effect.promise(() =>
              worker<{ run: { id: string } }>(`/api/coordination/v1/runner/threads/${thread.data.id}/reserve`, "POST"),
            )).data.run.id,
          ).toBe(cancellable.data.run.id)
          yield* llm.wait(8)
          const cancellation = yield* Effect.promise(() =>
            alice<{ state: string }>(
              `/api/coordination/v1/threads/${thread.data.id}/instructions/${cancellable.data.instruction.id}/cancel`,
              "POST",
            ),
          )
          expect(cancellation.status).toBe(200)
          expect(cancellation.data.state).not.toBe("completed")
          const cancellationState = yield* Effect.promise(() =>
            until(
              () =>
                alice<{ runs: Array<{ id: string; state: string }> }>(`/api/coordination/v1/threads/${thread.data.id}`),
              (value) =>
                value.data.runs.some(
                  (run) =>
                    run.id === cancellable.data.run.id &&
                    ["cancelled", "recovery_required", "failed"].includes(run.state),
                ),
              "observed cancellation outcome",
            ),
          )
          const cancelPhase = cancellationState.data.runs.find((run) => run.id === cancellable.data.run.id)?.state
          const stopEvidence = yield* Effect.sync(() => {
            const sqlite = new Database(dbPath)
            const row = sqlite
              .query(
                "SELECT phase, interrupt_abort, interrupt_state, terminal_at FROM runner_harness_execution WHERE run_id = ?",
              )
              .get(cancellable.data.run.id) as {
              phase: string
              interrupt_abort: string | null
              interrupt_state: string | null
              terminal_at: number | null
            }
            sqlite.close()
            return row
          })
          expect(cancelPhase).toBe("recovery_required")
          expect(stopEvidence.phase).toBe("recovery_required")
          expect(stopEvidence.terminal_at).toBeNull()
          const beforeRestart = yield* Effect.sync(() => {
            const sqlite = new Database(dbPath)
            const count = sqlite
              .query("SELECT COUNT(*) AS count FROM session_input WHERE session_id = ?")
              .get("ses_r13_first") as { count: number }
            sqlite.close()
            return count.count
          })
          yield* Effect.sync(() => server.kill())
          yield* Effect.promise(() => server.exited)
          const restarted = yield* opencode.serve({ env: processEnv, readyTimeoutMs: 30_000 })
          const afterRestart = request(restarted.url, "alice", "alice-fixture-secret")
          expect((yield* Effect.promise(() => afterRestart("/api/coordination/v1/status"))).status).toBe(200)
          const recovered = yield* Effect.promise(() =>
            afterRestart<{
              runs: Array<{ id: string; state: string }>
            }>(`/api/coordination/v1/threads/${thread.data.id}`),
          )
          expect(recovered.data.runs.find((run) => run.id === cancellable.data.run.id)?.state).toBe("recovery_required")
          expect(yield* llm.calls).toBe(8)
          const afterRestartCount = yield* Effect.sync(() => {
            const sqlite = new Database(dbPath)
            const count = sqlite
              .query("SELECT COUNT(*) AS count FROM session_input WHERE session_id = ?")
              .get("ses_r13_first") as { count: number }
            sqlite.close()
            return count.count
          })
          expect(afterRestartCount).toBe(beforeRestart)

          yield* llm.text("R13 independent after restart")
          const independentAfterRestart = yield* Effect.promise(() =>
            afterRestart<{ run: { id: string } }>(
              `/api/coordination/v1/threads/${other.data.id}/instructions`,
              "POST",
              {
                requestId: "r13-after-uncertain",
                text: "Continue the independent Thread after the other Thread was held.",
              },
            ),
          )
          expect(independentAfterRestart.status).toBe(200)
          const restartedWorker = request(restarted.url, "worker", "worker-fixture-secret")
          const independentReserve = yield* Effect.promise(() =>
            restartedWorker<{ run: { id: string } }>(
              `/api/coordination/v1/runner/threads/${other.data.id}/reserve`,
              "POST",
            ),
          )
          expect(independentReserve.status).toBe(200)
          expect(independentReserve.data.run.id).toBe(independentAfterRestart.data.run.id)
          yield* Effect.promise(() =>
            until(
              () =>
                afterRestart<{ runs: Array<{ id: string; state: string }> }>(
                  `/api/coordination/v1/threads/${other.data.id}`,
                ),
              (value) =>
                value.data.runs.some(
                  (run) => run.id === independentAfterRestart.data.run.id && run.state === "completed",
                ),
              "independent Thread completion after uncertain restart",
            ),
          )
          expect(yield* llm.calls).toBe(9)
          const heldAfterIndependent = yield* Effect.promise(() =>
            afterRestart<{
              runs: Array<{ id: string; state: string }>
            }>(`/api/coordination/v1/threads/${thread.data.id}`),
          )
          expect(heldAfterIndependent.data.runs.find((run) => run.id === cancellable.data.run.id)?.state).toBe(
            "recovery_required",
          )

          console.log(
            "R13_RUNNER_TRACE",
            JSON.stringify({
              commit: process.env.R13_TESTED_COMMIT ?? "see evidence receipt",
              events: events.map((event) => ({ seq: event.seq, kind: event.kind })),
              sessionId: "ses_r13_first",
              workspace: "first-thread",
              modelCalls: yield* llm.calls,
              parallel: { heldRun: held.data.run.id, independentRun: parallel.data.run.id },
              approval: approvalKinds,
              artifact: {
                during: artifactReport?.scopes.run.changed.map((change) => change.path),
                prior: artifactReport?.scopes.beforeRun.changed.map((change) => change.path),
              },
              cancellation: { acknowledged: cancellation.data.state, observed: cancelPhase, stopEvidence },
              restart: {
                inputRowsBefore: beforeRestart,
                inputRowsAfter: afterRestartCount,
                independentRunState: "completed",
                uncertainRunState: "recovery_required",
              },
              continuation: continuity.rows.map((row) => ({ type: row.type, seq: row.seq })),
            }),
          )
        }),
      ),
    ),
  )
}, 90_000)

test("a typed coordinator callback outage drains persisted output after a runner crash", async () => {
  await Effect.runPromise(
    Effect.scoped(
      withCliFixture(({ home, llm }) =>
        Effect.gen(function* () {
          const root = yield* Effect.promise(() => fs.realpath(home))
          const prepared = yield* Effect.promise(() => source(root))
          const directory = yield* Effect.promise(() =>
            workspace(prepared.repository, prepared.workspaces, "outage-thread", prepared.revision),
          )
          const modelConfig = testProviderConfig(llm.url)
          Reflect.deleteProperty(modelConfig.provider.test, "env")
          yield* Effect.promise(() => Bun.write(path.join(directory, "opencode.json"), JSON.stringify(modelConfig)))
          const identity = yield* Effect.promise(() => roster(root, prepared.projectId))
          const dbPath = path.join(root, "runner.sqlite")
          const configPath = path.join(root, "runner.json")
          const outagePath = path.join(root, "callbacks-offline")
          yield* Effect.promise(() =>
            Bun.write(
              configPath,
              JSON.stringify({
                owner: { workerId: "wrk_r13", instanceId: "r13-instance" },
                username: "worker",
                workspaceRoot: prepared.workspaces,
                projects: [
                  {
                    projectId: prepared.projectId,
                    repositoryRoot: prepared.repository,
                    baseRevision: prepared.revision,
                  },
                ],
                toolPath: "/usr/bin:/bin",
                deliveryIntervalMs: 25,
              }),
            ),
          )
          const first = yield* Effect.acquireRelease(
            Effect.promise(() => faultHost(root, llm.url, dbPath, configPath, identity, outagePath)),
            (host) =>
              Effect.promise(async () => {
                host.child.kill()
                await host.child.exited
              }).pipe(Effect.ignore),
          )
          const alice = request(first.url, "alice", "alice-fixture-secret")
          const worker = request(first.url, "worker", "worker-fixture-secret")
          yield* Effect.promise(() =>
            until(
              () => alice<{ ready: boolean }>("/api/coordination/v1/status"),
              (value) => value.status === 200 && value.data.ready,
              "fault fixture coordinator readiness",
            ),
          )
          yield* Effect.sync(() => {
            const sqlite = new Database(dbPath)
            const now = Date.now()
            sqlite
              .query("INSERT INTO project (id, worktree, sandboxes, time_created, time_updated) VALUES (?, ?, ?, ?, ?)")
              .run(prepared.projectId, prepared.repository, "[]", now, now)
            sqlite
              .query(
                "INSERT INTO session (id, project_id, workspace_id, slug, directory, title, version, model, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              )
              .run(
                "ses_r13_outage",
                prepared.projectId,
                "wrk_r13_outage",
                "ses_r13_outage",
                directory,
                "R13 outage",
                "fixture",
                JSON.stringify({ id: "test-model", providerID: "test" }),
                now,
                now,
              )
            sqlite.close()
          })
          const project = yield* Effect.promise(() =>
            alice<{ id: string }>("/api/coordination/v1/projects", "POST", {
              projectId: prepared.projectId,
              name: "R13 outage",
              requestId: "r13-outage-project",
            }),
          )
          expect(project.status).toBe(200)
          const thread = yield* Effect.promise(() =>
            alice<{ id: string }>(`/api/coordination/v1/projects/${prepared.projectId}/threads`, "POST", {
              sessionId: "ses_r13_outage",
              title: "R13 outage",
              requestId: "r13-outage-thread",
            }),
          )
          expect(thread.status).toBe(200)
          const barrier = Promise.withResolvers<void>()
          yield* llm.hold("R13 persisted callback output", barrier.promise)
          const instruction = yield* Effect.promise(() =>
            alice<{ run: { id: string } }>(`/api/coordination/v1/threads/${thread.data.id}/instructions`, "POST", {
              requestId: "r13-outage-instruction",
              text: "Return the deterministic output.",
            }),
          )
          expect(instruction.status).toBe(200)
          const reserved = yield* Effect.promise(() =>
            worker<{ run: { id: string } }>(`/api/coordination/v1/runner/threads/${thread.data.id}/reserve`, "POST"),
          )
          expect(reserved.status).toBe(200)
          expect(reserved.data.run.id).toBe(instruction.data.run.id)
          yield* llm.wait(1)
          yield* Effect.promise(() =>
            until(
              () =>
                alice<{ events: Array<{ kind: string; runId?: string }> }>(
                  `/api/coordination/v1/projects/${prepared.projectId}/events?after=-1&limit=256`,
                ),
              (value) =>
                value.data.events.some(
                  (event) => event.runId === instruction.data.run.id && event.kind === "run.started",
                ),
              "started callback before outage",
            ),
          )
          yield* Effect.promise(() => Bun.write(outagePath, "offline"))
          yield* Effect.sync(() => barrier.resolve())
          const pending = yield* Effect.promise(() =>
            until(
              async () => {
                const sqlite = new Database(dbPath)
                const execution = sqlite
                  .query("SELECT phase FROM runner_harness_execution WHERE run_id = ?")
                  .get(instruction.data.run.id) as { phase: string }
                const rows = sqlite
                  .query(
                    "SELECT ordinal, callback, acknowledged_at, attempt_count FROM runner_harness_outbox WHERE run_id = ? ORDER BY ordinal",
                  )
                  .all(instruction.data.run.id) as Array<{
                  ordinal: number
                  callback: string
                  acknowledged_at: number | null
                  attempt_count: number
                }>
                sqlite.close()
                return { execution, rows }
              },
              (value) =>
                value.execution.phase === "completed" &&
                value.rows.some(
                  (row) =>
                    JSON.parse(row.callback).activity?.kind === "run.output" &&
                    row.acknowledged_at === null &&
                    row.attempt_count > 0,
                ),
              "persisted output after typed callback failure",
            ),
          )
          expect(pending.rows.at(-1)?.acknowledged_at).toBeNull()
          expect(pending.rows[0]?.acknowledged_at).toBeNumber()
          const held = yield* Effect.promise(() =>
            alice<{ runs: Array<{ id: string; state: string }> }>(`/api/coordination/v1/threads/${thread.data.id}`),
          )
          expect(held.data.runs.find((run) => run.id === instruction.data.run.id)?.state).toBe("running")
          yield* Effect.sync(() => first.child.kill("SIGKILL"))
          yield* Effect.promise(() => first.child.exited)
          yield* Effect.promise(() => fs.rm(outagePath))
          const second = yield* Effect.acquireRelease(
            Effect.promise(() => faultHost(root, llm.url, dbPath, configPath, identity, outagePath)),
            (host) =>
              Effect.promise(async () => {
                host.child.kill()
                await host.child.exited
              }).pipe(Effect.ignore),
          )
          const recovered = request(second.url, "alice", "alice-fixture-secret")
          yield* Effect.promise(() =>
            until(
              () =>
                recovered<{ runs: Array<{ id: string; state: string }> }>(
                  `/api/coordination/v1/threads/${thread.data.id}`,
                ),
              (value) => value.data.runs.some((run) => run.id === instruction.data.run.id && run.state === "completed"),
              "callback delivery after runner restart",
            ),
          )
          const outcome = yield* Effect.sync(() => {
            const sqlite = new Database(dbPath)
            const rows = sqlite
              .query(
                "SELECT ordinal, callback, acknowledged_at FROM runner_harness_outbox WHERE run_id = ? ORDER BY ordinal",
              )
              .all(instruction.data.run.id) as Array<{
              ordinal: number
              callback: string
              acknowledged_at: number | null
            }>
            const input = sqlite
              .query("SELECT COUNT(*) AS count FROM session_input WHERE session_id = ?")
              .get("ses_r13_outage") as { count: number }
            sqlite.close()
            return { rows, input }
          })
          expect(outcome.rows.every((row) => row.acknowledged_at !== null)).toBe(true)
          expect(outcome.input.count).toBe(1)
          expect(yield* llm.calls).toBe(1)
          const replay = yield* Effect.promise(() =>
            recovered<{ events: Array<{ kind: string; runId?: string }> }>(
              `/api/coordination/v1/projects/${prepared.projectId}/events?after=-1&limit=256`,
            ),
          )
          const kinds = replay.data.events
            .filter((event) => event.runId === instruction.data.run.id)
            .map((event) => event.kind)
          expect(kinds).toEqual(["instruction.submitted", "run.reserved", "run.started", "run.output", "run.completed"])
          console.log(
            "R13_CALLBACK_RECOVERY_TRACE",
            JSON.stringify({
              events: kinds,
              pendingOutputAttempts: pending.rows.find(
                (row) => JSON.parse(row.callback).activity?.kind === "run.output",
              )?.attempt_count,
              acknowledgedAfterRestart: outcome.rows.length,
              inputRows: outcome.input.count,
              modelCalls: yield* llm.calls,
            }),
          )
        }),
      ),
    ),
  )
}, 90_000)
