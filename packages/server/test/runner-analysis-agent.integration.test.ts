import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { withCliFixture } from "../../opencode/test/lib/cli-process"
import { testProviderConfig } from "../../opencode/test/lib/test-provider"
import { analystAgent, runAnalysis } from "../../../script/runtime/analysis"

const binding = (threadId: string, sessionId: string, activitySeq: number) => ({
  projectId: "prj_analysis",
  threadId,
  workerId: "wrk_analysis",
  sessionId,
  ownerId: "usr_owner",
  title: `Selected ${threadId} session`,
  featureTopic: "navigation",
  relationship: "unspecified",
  activitySeq,
  evidenceRevision: activitySeq,
  expectedVersion: 0,
  shared: true,
  deterministicStatus: "active",
  contributors: [],
})
const event = (eventId: string, sessionId: string, seq: number, content: Record<string, unknown>) => ({
  eventId,
  projectId: "prj_analysis",
  workerId: "wrk_analysis",
  sessionId,
  revision: seq,
  kind: "message",
  occurredAt: "2026-10-01T12:00:00.000Z",
  content,
})
const envelope = {
  request: { requestId: "analysis-request", targetSessionId: "ses_target" },
  snapshot: {
    events: [
      event("evt_s1", "ses_source", 3, { role: "user", text: "Add keyboard navigation to the project list" }),
      event("evt_s2", "ses_source", 5, { role: "assistant", text: "Focus ring requires the outline token" }),
      event("evt_t1", "ses_target", 7, { role: "user", text: "Restyle the project list" }),
    ],
  },
  provenance: [
    { threadId: "thr_source", eventId: "evt_s1", eventSeq: 3, threadActivitySeq: 5 },
    { threadId: "thr_source", eventId: "evt_s2", eventSeq: 5, threadActivitySeq: 5 },
    { threadId: "thr_target", eventId: "evt_t1", eventSeq: 7, threadActivitySeq: 7 },
  ],
  bindings: [binding("thr_source", "ses_source", 5), binding("thr_target", "ses_target", 7)],
}
const answer = (note: string | null) =>
  JSON.stringify({
    source: {
      currentTask: "Keyboard navigation for the project list",
      progress: "Found that the focus ring depends on the outline token",
      blockers: [],
      recentOutcome: null,
      evidence: ["S2"],
    },
    target: {
      currentTask: "Restyle the project list",
      progress: "Requested",
      blockers: [],
      recentOutcome: null,
      evidence: [],
    },
    note,
  })

test("the OpenCode analyst agent maps a tool-less analysis into backend result shapes", async () => {
  await Effect.runPromise(
    Effect.scoped(
      withCliFixture(({ home, llm, opencode }) =>
        Effect.gen(function* () {
          const directory = path.join(home, "analysis")
          const agents = path.join(home, ".config/opencode/agents")
          yield* Effect.promise(async () => {
            await fs.mkdir(directory, { recursive: true })
            await fs.mkdir(agents, { recursive: true })
            await fs.copyFile(
              path.join(import.meta.dir, "../../../script/runtime/puff-analyst.md"),
              path.join(agents, `${analystAgent}.md`),
            )
            // Mirrors the launcher: provider and analyst agent both live in the global config directory.
            const modelConfig = testProviderConfig(llm.url)
            Reflect.deleteProperty(modelConfig.provider.test, "env")
            await Bun.write(path.join(agents, "../opencode.json"), JSON.stringify(modelConfig))
          })
          const server = yield* opencode.serve({
            // Earlier in-process server tests leave coordination settings in process.env.
            env: {
              OPENCODE_DB: path.join(home, "analysis.sqlite"),
              OPENCODE_SERVER_PASSWORD: "runtime-fixture-secret",
              OPENCODE_RUNNER_CONFIG_PATH: "",
              OPENCODE_COORDINATION_IDENTITIES_PATH: "",
              OPENCODE_COORDINATION_ADMISSIONS_PATH: "",
              OPENCODE_COORDINATION_DEV_SESSION_SELECTIONS_PATH: "",
              OPENCODE_COORDINATION_MOCK_RUNNER: "0",
            },
            readyTimeoutMs: 30_000,
          })
          const options = {
            backendUrl: server.url,
            authorization: `Basic ${Buffer.from("opencode:runtime-fixture-secret").toString("base64")}`,
            model: { providerID: "test", id: "test-model" },
            directory,
            envelope,
          }

          yield* llm.text(answer("The source Session found that the focus ring depends on the outline token."))
          const mapped = yield* Effect.promise(() => runAnalysis(options))
          expect(mapped.coordinationRunId).toStartWith("ses_")
          expect(mapped.workCardUpdates.map((update) => update.card)).toMatchObject([
            {
              currentTask: "Keyboard navigation for the project list",
              summaryJobId: "analysis-request",
              evidenceRefs: [{ threadId: "thr_source", eventId: "evt_s2", seq: 5 }],
            },
            // Uncited summaries fall back to the latest exported event of that Session.
            {
              currentTask: "Restyle the project list",
              evidenceRefs: [{ threadId: "thr_target", eventId: "evt_t1", seq: 7 }],
            },
          ])
          expect(mapped.awarenessNoteCandidates).toMatchObject([
            {
              sourceThreadId: "thr_source",
              targetThreadId: "thr_target",
              featureTopic: "navigation",
              evidenceRefs: [
                { threadId: "thr_source", eventId: "evt_s2", seq: 5 },
                { threadId: "thr_target", eventId: "evt_t1", seq: 7 },
              ],
            },
          ])

          const [input] = yield* llm.inputs
          const messages = input.messages as { role: string; content: unknown }[]
          expect(input.tools ?? []).toEqual([])
          expect(JSON.stringify(messages[0])).toContain("You analyze two coding Sessions")
          expect(JSON.stringify(messages.at(-1))).toContain('\\"ref\\":\\"S2\\"')

          // A directive note would be refused by the server, so it is dropped before registration.
          yield* llm.text(answer("You should switch to the outline token instead."))
          const directive = yield* Effect.promise(() => runAnalysis(options))
          expect(directive.awarenessNoteCandidates).toEqual([])
          expect(directive.workCardUpdates).toHaveLength(2)
        }),
      ),
    ),
  )
}, 120_000)
