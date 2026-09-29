import { expect, test } from "bun:test"
import type { Coordination } from "@opencode-ai/schema/coordination"
import type { SimulationManifest } from "./simulation-contract"
import { hasCurrentCompletedEvidence, matchesCompletedTask } from "./demo-task-match"

const start = {
  projectId: "sim-wf03",
  completed: {
    id: "migration-navigation-map", task: "Map database migration navigation",
    matchPhrases: ["map database migration navigation", "migration navigation map"],
    threadId: "wf03-unrelated-db", reportedBy: "usr_cara",
    result: "Mapped migration pages and links.",
    sourceRef: { threadId: "wf03-unrelated-db", eventId: "wf03-db-complete", seq: 8 },
  },
  remaining: [],
} as unknown as NonNullable<SimulationManifest["taskStart"]>
const overview = {
  project: { id: start.projectId } as Coordination.SharedProject,
  threads: [{ id: start.completed.threadId, projectId: start.projectId, activitySeq: 8 }] as Coordination.Thread[],
  cards: [{
    threadId: start.completed.threadId, projectId: start.projectId, status: "done", sourceActivitySeq: 8,
    recentVerifiedOutcome: start.completed.result, contributors: [start.completed.reportedBy],
    evidenceRefs: [start.completed.sourceRef],
  }] as unknown as Coordination.WorkCard[],
}

test("only explicit named demo tasks match completed work", () => {
  expect(matchesCompletedTask("  MAP   DATABASE MIGRATION NAVIGATION  ", start)).toBe(true)
  expect(matchesCompletedTask("migration navigation map", start)).toBe(true)
  expect(matchesCompletedTask("fix project navigation", start)).toBe(false)
  expect(matchesCompletedTask("map database migration navigation and UI", start)).toBe(false)
  expect(matchesCompletedTask("navigation", start)).toBe(false)
})

test("completed warning requires a fresh done card with exact source and contributor", () => {
  expect(hasCurrentCompletedEvidence(start, overview)).toBe(true)
  expect(hasCurrentCompletedEvidence(start, { ...overview, threads: [{ ...overview.threads[0]!, activitySeq: 9 }] })).toBe(false)
  expect(hasCurrentCompletedEvidence(start, { ...overview, cards: [{ ...overview.cards[0]!, status: "active" }] })).toBe(false)
  expect(hasCurrentCompletedEvidence(start, { ...overview, cards: [{ ...overview.cards[0]!, evidenceRefs: [] }] })).toBe(false)
  expect(hasCurrentCompletedEvidence(start, { ...overview, cards: [{ ...overview.cards[0]!, contributors: [] }] })).toBe(false)
})
