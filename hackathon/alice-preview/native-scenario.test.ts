import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { chmod, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer } from "node:net"

test("native scenario records actual two-owner tasks and truthful preparation failure without a provider call", async () => {
  const directory = await mkdtemp(join(tmpdir(), "puff-native-scenario-test-"))
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
  try {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "run.ts"), "--check-only"], {
      env: {
        ...process.env,
        PUFF_PREVIEW_SERVER_PORT: String(port),
        PUFF_PREVIEW_NATIVE_SCENARIO: "1",
        PUFF_MODEL_CONFIG_PATH: configPath,
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    if (status !== 0) throw new Error(`Native scenario failed (${status}): ${stderr}\n${stdout}`)
    const memberPath = /Member file \(0600\): ([^\n]+)/.exec(stdout)![1]
    const member = await Bun.file(memberPath).json()
    const db = new Database(join(memberPath, "..", "opencode.sqlite"), { readonly: true })
    try {
      const instruction = db
        .query<
          { actor_id: string; text: string },
          [string]
        >("SELECT actor_id, text FROM coordination_instruction WHERE run_id = ?")
        .get(member.aliceInitialRunId)!
      const row = db
        .query<
          { data: string; activity_seq: number },
          [string]
        >("SELECT c.data, t.activity_seq FROM coordination_work_card c JOIN coordination_thread t ON t.id = c.thread_id WHERE c.thread_id = ?")
        .get(member.sourceThreadId)!
      const card = JSON.parse(row.data)
      expect(instruction.actor_id).toBe("usr_alice")
      expect(card.currentTask).toBe(instruction.text)
      expect(card.status).toBe("blocked")
      expect(card.sourceActivitySeq).toBe(row.activity_seq)
      expect(card.recentVerifiedOutcome).toBeNull()
      expect(card.evidenceRefs.length).toBeGreaterThan(0)
      expect(card.summaryJobId).toContain("native-run-projection:")
      expect(card.progress).toContain("No assistant output")
      expect(
        db.query<{ count: number }, []>("SELECT count(*) AS count FROM runner_harness_execution").get()!.count,
      ).toBe(2)
      expect(db.query<{ count: number }, []>("SELECT count(*) AS count FROM session_message").get()!.count).toBe(0)
      expect(
        db
          .query<{ actor_id: string }, [string]>("SELECT actor_id FROM coordination_instruction WHERE thread_id = ?")
          .get(member.targetThreadId)!.actor_id,
      ).toBe("usr_serdar")
    } finally {
      db.close()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 60_000)
