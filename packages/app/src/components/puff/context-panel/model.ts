import type { Coordination } from "@opencode-ai/schema/coordination"
import type { TeamThread } from "@/pages/puff/team-api"

export interface ContextSelection {
  target?: { sessionId: string; workerId?: string; threadId?: string }
  snapshot?: TeamThread
  related?: readonly Coordination.Thread[]
  connected: boolean
  loading: boolean
  error?: string
}

type WorkCard = NonNullable<TeamThread["workCard"]>
type SourceRef = NonNullable<WorkCard["evidenceRefs"]>[number]

export interface ContextView {
  state: "offline" | "unavailable" | "loading" | "unbound" | "ready"
  thread?: Coordination.Thread
  card?: WorkCard
  stale: boolean
  sources: SourceRef[]
  verifiedOutcome?: string
  // The current Thread record has no topic or relationship field. Other
  // project threads cannot be inferred to be alternative approaches.
  alternatives: Coordination.Thread[]
  activeRuns: Coordination.Run[]
  approvals: Coordination.Approval[]
}

function empty(state: ContextView["state"]): ContextView {
  return { state, stale: false, sources: [], alternatives: [], activeRuns: [], approvals: [] }
}

export function selectContext(input: ContextSelection): ContextView {
  if (!input.connected) return empty("offline")
  if (input.error) return empty("unavailable")
  if (input.loading) return empty("loading")

  const target = input.target
  const snapshot = input.snapshot
  if (!target?.threadId || !target.sessionId || !target.workerId || !snapshot) return empty("unbound")
  const thread = snapshot.thread
  if (thread.id !== target.threadId || thread.sessionId !== target.sessionId || thread.workerId !== target.workerId)
    return empty("unbound")

  const candidate = snapshot.workCard
  const card = candidate?.threadId === thread.id && candidate.sourceActivitySeq <= thread.activitySeq
    ? candidate : undefined
  const stale = !!card && card.sourceActivitySeq < thread.activitySeq
  const sourceSeq = card?.sourceActivitySeq ?? -1
  const accessible = new Set([
    thread.id,
    ...(input.related ?? []).filter((item) => item.projectId === thread.projectId).map((item) => item.id),
  ])
  const seen = new Set<string>()
  const sources = (card?.evidenceRefs ?? []).filter((ref) => {
    const key = `${ref.threadId}:${ref.eventId}:${ref.seq}`
    if (!accessible.has(ref.threadId) || !ref.eventId || ref.seq < 0 || ref.seq > sourceSeq || seen.has(key))
      return false
    seen.add(key)
    return true
  })
  return {
    state: "ready", thread, card, stale, sources,
    verifiedOutcome: !stale && sources.length ? card?.recentVerifiedOutcome ?? undefined : undefined,
    alternatives: [],
    activeRuns: snapshot.runs.filter((run) => run.threadId === thread.id && !["completed", "failed", "cancelled"].includes(run.state)),
    approvals: snapshot.approvals.filter((approval) => approval.threadId === thread.id && (approval.state === "pending" || approval.state === "claimed")),
  }
}
