import type { Coordination } from "@opencode-ai/schema/coordination"
import type { SimulationManifest } from "./simulation-contract"

type TaskStart = NonNullable<SimulationManifest["taskStart"]>

export function matchesCompletedTask(text: string, start: TaskStart) {
  const normalized = text.trim().replace(/\s+/g, " ").toLocaleLowerCase()
  return !!normalized && start.completed.matchPhrases.some((phrase) =>
    phrase.trim().replace(/\s+/g, " ").toLocaleLowerCase() === normalized)
}

export function hasCurrentCompletedEvidence(start: TaskStart, overview: {
  project: Coordination.SharedProject
  threads: readonly Coordination.Thread[]
  cards: readonly Coordination.WorkCard[]
} | undefined) {
  if (overview?.project.id !== start.projectId) return false
  const thread = overview.threads.find((item) => item.id === start.completed.threadId && item.projectId === start.projectId)
  const card = overview.cards.find((item) => item.threadId === start.completed.threadId && item.projectId === start.projectId)
  const ref = start.completed.sourceRef
  return !!thread && !!card && card.status === "done" && card.sourceActivitySeq === thread.activitySeq &&
    card.recentVerifiedOutcome === start.completed.result &&
    card.contributors.includes(start.completed.reportedBy) &&
    card.evidenceRefs.some((item) => item.threadId === ref.threadId && item.eventId === ref.eventId && item.seq === ref.seq)
}
