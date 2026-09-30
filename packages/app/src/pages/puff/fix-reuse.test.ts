import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Coordination } from "@opencode-ai/schema/coordination"
import { activeFailure, verifiedFix, fixInstruction, fixApplicationState } from "./fix-reuse"

const error = "TypeError: Cannot read properties of undefined (reading 'map') at ProjectList"
const source = Schema.decodeUnknownSync(Coordination.Event)({
  id: "alya-fix",
  projectId: "project",
  threadId: "alya-session",
  seq: 5,
  kind: "run.output",
  actorId: "usr_alya",
  occurredAt: "2026-09-29T00:00:00Z",
  payload: {
    fix: {
      error,
      summary: "Default missing projects to an empty list.",
      patch: "--- a/project-list.ts\n+++ b/project-list.ts\n- projects.map(render)\n+ (projects ?? []).map(render)",
      verification: { command: "bun test", exitCode: 0, output: "2 pass, 0 fail" },
    },
  },
})
const failure = Schema.decodeUnknownSync(Coordination.Event)({
  ...source,
  id: "my-error",
  threadId: "mine",
  seq: 8,
  kind: "run.failed",
  runId: "broken-run",
  payload: { summary: error },
})
const thread = Schema.decodeUnknownSync(Coordination.Thread)({
  id: "alya-session",
  projectId: "project",
  activitySeq: 5,
  sessionId: "ses_alya",
  workerId: "worker",
  createdBy: "usr_alya",
  createdAt: source.occurredAt,
  title: "Fix projects list",
})
const card = Schema.decodeUnknownSync(Coordination.WorkCard)({
  id: "card",
  version: 1,
  currentTask: "Fix projects list",
  progress: "Passed",
  blockers: [],
  generatedAt: source.occurredAt,
  updatedAt: source.occurredAt,
  submittedBy: "analysis",
  summaryJobId: "job",
  projectId: "project",
  threadId: thread.id,
  sourceActivitySeq: 5,
  status: "done",
  recentVerifiedOutcome: "2 tests pass",
  contributors: ["usr_alya"],
  evidenceRefs: [{ threadId: thread.id, eventId: source.id, seq: 5 }],
})
const input = { failure, thread, card, source, memberIds: ["usr_alya"] }

test("a current failed session automatically matches Alya's verified source fix", () => {
  const current = activeFailure([failure], "mine")
  expect(current?.id).toBe("my-error")
  const fix = verifiedFix({ ...input, failure: current! })
  expect(fix?.actorId).toBe("usr_alya")
  expect(fix?.patch).toContain("projects ?? []")
})

test("unrelated error, unverified patch, stale card and inaccessible actor never suggest reuse", () => {
  expect(
    verifiedFix({
      ...input,
      failure: {
        ...failure,
        payload: { summary: "TypeError: Cannot read properties of undefined (reading 'map') at BillingList" },
      },
    }),
  ).toBeUndefined()
  expect(verifiedFix({ ...input, card: { ...card, sourceActivitySeq: 4 } })).toBeUndefined()
  expect(verifiedFix({ ...input, card: { ...card, status: "active" } })).toBeUndefined()
  expect(verifiedFix({ ...input, memberIds: [] })).toBeUndefined()
  const fix = source.payload.fix as Record<string, unknown>
  expect(
    verifiedFix({
      ...input,
      source: {
        ...source,
        payload: { fix: { ...fix, verification: { command: "bun test", exitCode: 1, output: "1 fail" } } },
      },
    }),
  ).toBeUndefined()
  expect(
    verifiedFix({ ...input, source: { ...source, projectId: "private" as Coordination.ProjectID } }),
  ).toBeUndefined()
  expect(verifiedFix({ ...input, source: { ...source, seq: 4 } })).toBeUndefined()
  expect(
    verifiedFix({ ...input, card: { ...card, contributors: ["usr_other" as Coordination.UserID] } }),
  ).toBeUndefined()
})

test("a later successful run clears the obsolete error; comments never trigger lookup", () => {
  expect(activeFailure([failure, { ...failure, id: "done", seq: 9, kind: "run.completed" }], "mine")).toBeUndefined()
  expect(activeFailure([{ ...failure, kind: "comment.created" }], "mine")).toBeUndefined()
})

test("approved instruction identifies both exact source and error, with reviewable patch", () => {
  const fix = verifiedFix(input)!
  const instruction = fixInstruction(fix)
  expect(instruction).toContain("alya-fix@5")
  expect(instruction).toContain("my-error@8")
  expect(instruction).toContain(fix.patch)
  expect(instruction).toContain("existing workspace")
})

test("completion alone is not application; diff and a passed target check are required", () => {
  const completed = {
    ...failure,
    id: "complete",
    kind: "run.completed" as const,
    runId: "apply-run" as Coordination.RunID,
  }
  const diff = { ...completed, id: "diff", kind: "run.diff" as const, payload: { patch: "+ fixed" } }
  const check = {
    ...completed,
    id: "check",
    kind: "run.tool" as const,
    payload: { status: "completed", verification: { command: "bun test", exitCode: 0, output: "2 pass" } },
  }
  expect(fixApplicationState("apply-run", [completed])).toBe("verification")
  expect(fixApplicationState("apply-run", [diff, check, completed])).toBe("applied")
  expect(
    fixApplicationState("apply-run", [{ ...check, runId: "other-run" as Coordination.RunID }, diff, completed]),
  ).toBe("verification")
  expect(fixApplicationState("apply-run", [{ ...completed, kind: "run.failed" }])).toBe("failed")
})
