import type { Coordination } from "@opencode-ai/schema/coordination"
import type { SimulationManifest } from "@/pages/puff/project-overview/simulation-contract"

type Overview = {
  project: Coordination.SharedProject
  members: readonly Coordination.Membership[]
  cards: readonly Coordination.WorkCard[]
  snapshots: readonly {
    thread: Coordination.Thread
    runs: readonly Coordination.Run[]
  }[]
}

export function projectRail(input: {
  projectId: string
  threads: readonly Coordination.Thread[]
  overview?: Overview
  simulation?: SimulationManifest
  missing: string
  stale: string
  loading: string
  loadingReport: boolean
  t: (key: string) => string
}) {
  const overview = input.overview?.project.id === input.projectId ? input.overview : undefined
  const members = overview?.members.filter((member) => member.projectId === input.projectId) ?? []
  const cards = new Map(overview?.cards.map((card) => [card.threadId, card]) ?? [])
  const snapshots = new Map(overview?.snapshots.map((snapshot) => [snapshot.thread.id, snapshot]) ?? [])
  const scenario = input.simulation?.scenarios.find((item) => item.projectId === input.projectId)
  const rows = input.threads.filter((thread) => thread.projectId === input.projectId).map((thread) => {
    const card = cards.get(thread.id)
    const fresh = !!card && card.projectId === input.projectId && card.threadId === thread.id &&
      card.sourceActivitySeq === thread.activitySeq
    const snapshot = snapshots.get(thread.id)
    const exact = snapshot?.thread.projectId === input.projectId && snapshot.thread.sessionId === thread.sessionId &&
      snapshot.thread.workerId === thread.workerId && snapshot.thread.activitySeq === thread.activitySeq
    const ordered = exact ? snapshot.runs.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)) : []
    const run = ordered.find((item) => ["reserved", "running", "waiting_approval", "cancelling", "recovery_required"].includes(item.state)) ?? ordered[0]
    const simulated = scenario ? simulatedSummaryKey(thread.id, input.simulation?.wf02?.stage ?? 0) : undefined
    return {
      thread,
      summary: !overview && input.loadingReport ? input.loading : !card ? input.missing : !fresh ? input.stale :
        simulated ? input.t(simulated) : (card.progress.trim() || card.currentTask.trim() || input.missing),
      runState: run?.state,
      creatorIsMember: members.some((member) => member.userId === thread.createdBy),
      currentCard: fresh ? card : undefined,
    }
  })
  const groups = members.map((member) => {
    const sessions = rows.filter((row) => row.thread.createdBy === member.userId)
    const reports = rows.flatMap((row) => {
      const card = row.currentCard
      const sourceRef = card?.evidenceRefs.find((ref) => ref.threadId === row.thread.id && ref.eventId.trim())
      if (!card?.contributors.includes(member.userId) || !sourceRef) return []
      const text = card.progress.trim() || card.recentVerifiedOutcome?.trim() || card.currentTask.trim()
      return text ? [{ threadId: row.thread.id, threadTitle: row.thread.title, text, sourceRef }] : []
    })
    const reported = new Set(reports.map((report) => report.threadId))
    const startedTopics = [...new Set(sessions.filter((row) => !reported.has(row.thread.id))
      .map((row) => row.currentCard?.currentTask.trim()).filter((task): task is string => !!task))]
    const summary = [...new Set(reports.map((report) => report.text))].join(" ")
    return { member, sessions, startedTopics, reports, summary }
  })
  return { members, rows, groups, unknownRows: rows.filter((row) => !row.creatorIsMember) }
}

function simulatedSummaryKey(threadId: string, stage: number) {
  const fixed: Record<string, string> = {
    "wf01-A": "puff.simulation.rail.wf01A",
    "wf01-B": "puff.simulation.rail.wf01B",
    "wf02-A": "puff.simulation.rail.wf02A",
    "wf03-overlap-A": "puff.simulation.rail.wf03OverlapA",
    "wf03-overlap-B": "puff.simulation.rail.wf03OverlapB",
    "wf03-unrelated-db": "puff.simulation.rail.wf03Db",
    "wf03-unrelated-ui": "puff.simulation.rail.wf03Ui",
  }
  if (threadId === "wf02-B") return [
    "puff.simulation.rail.wf02BSource",
    "puff.simulation.rail.wf02BAdmitted",
    "puff.simulation.rail.wf02BPromoted",
    "puff.simulation.rail.wf02BUsed",
  ][stage]
  return fixed[threadId]
}
