import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { chmod, mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("a trusted bounded Session can be prepared after startup without executing a provider request", async () => {
  const directory = await mkdtemp(join(tmpdir(), "puff-bounded-selection-test-"))
  const port = await new Promise<number>((resolve, reject) => {
    const probe = createServer()
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address()
      if (!address || typeof address === "string") return reject(new Error("No isolated test port"))
      const boundPort = address.port
      probe.close(() => resolve(boundPort))
    })
  })
  const configPath = join(directory, "opencode.json")
  await Bun.write(
    configPath,
    JSON.stringify({
      model: "test-unavailable/model",
      provider: {
        "test-unavailable": {
          npm: "@puff/test-unsupported-native-api",
          options: { baseURL: "http://127.0.0.1:1", apiKey: "test-only" },
          models: { model: { name: "Unsupported negative test" } },
        },
      },
    }),
  )
  await chmod(configPath, 0o600)
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "run.ts")], {
    env: {
      ...process.env,
      PUFF_PREVIEW_SERVER_PORT: String(port),
      PUFF_PREVIEW_NATIVE_SCENARIO: "1",
      PUFF_MODEL_CONFIG_PATH: configPath,
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const reader = child.stdout.getReader()
  let stdout = ""
  let memberPath = ""
  try {
    while (!memberPath) {
      const next = await reader.read()
      if (next.done) throw new Error("Isolated native backend did not become ready")
      stdout += new TextDecoder().decode(next.value)
      memberPath = /Member file \(0600\): ([^\n]+)/.exec(stdout)?.[1] ?? ""
    }
    const initial = await Bun.file(memberPath).json()
    const helper = Bun.spawn([process.execPath, join(import.meta.dir, "prepare-bounded-serdar.ts"), "--select"], {
      env: { ...process.env, PUFF_BACKEND_MEMBER_PATH: memberPath },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [output, error, status] = await Promise.all([
      new Response(helper.stdout).text(),
      new Response(helper.stderr).text(),
      helper.exited,
    ])
    if (status !== 0) throw new Error(`Bounded helper failed (${status}): ${error}`)
    const receipt = JSON.parse(output)
    const member = await Bun.file(memberPath).json()
    expect(receipt.modelRequestSubmitted).toBe(false)
    expect(member.targetThreadId).toBe(receipt.boundedTargetThreadId)
    expect(member.originalFailedTargetThreadId).toBe(initial.targetThreadId)
    expect(member.sourceThreadId).toBe(initial.sourceThreadId)
    const credentials: { username: string; password: string }[] = await Bun.file(member.credentialsPath).json()
    const alice = credentials.find((person) => person.username === "alice")!
    const forbidden = await fetch(`${member.url}/api/coordination/v1/projects/${member.projectId}/threads`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${alice.username}:${alice.password}`)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: "ses_serdar_bounded",
        title: "Wrong owner",
        requestId: "alice-select-bounded-serdar",
      }),
    })
    expect(forbidden.status).toBe(403)
    const db = new Database(join(memberPath, "..", "opencode.sqlite"), { readonly: true })
    try {
      const thread = db
        .query("SELECT created_by, session_id FROM coordination_thread WHERE id = ?")
        .get(member.targetThreadId) as { created_by: string; session_id: string }
      expect(thread).toEqual({ created_by: "usr_serdar", session_id: "ses_serdar_bounded" })
      const run = db.query("SELECT state FROM coordination_run WHERE id = ?").get(receipt.retainedOriginalRunId) as {
        state: string
      }
      expect(run.state).toBe("cancelled")
      expect((db.query("SELECT count(*) AS count FROM session_message").get() as { count: number }).count).toBe(0)
      expect(
        (
          db.query("SELECT count(*) AS count FROM session_input WHERE session_id = 'ses_serdar_bounded'").get() as {
            count: number
          }
        ).count,
      ).toBe(0)
      expect(
        (db.query("SELECT count(*) AS count FROM runner_harness_execution").get() as { count: number }).count,
      ).toBe(2)
    } finally {
      db.close()
    }
  } finally {
    child.kill("SIGTERM")
    await child.exited
    await reader.cancel()
    await rm(directory, { recursive: true, force: true })
  }
}, 90_000)
