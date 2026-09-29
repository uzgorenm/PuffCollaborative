import type { Coordination } from "@opencode-ai/schema/coordination"

export type StatedFocus = { userId: string; text: string; statedAt: string }
export type Snapshot = {
  thread: Coordination.Thread
  runs: readonly Pick<Coordination.Run, "id" | "state" | "createdAt">[]
  approvals: readonly Pick<Coordination.Approval, "id" | "threadId" | "state" | "requestedAt" | "deliveryState">[]
}
export type OverviewSession = {
  thread: Coordination.Thread
  ownerId?: string
  card?: Coordination.WorkCard
  freshness: "missing" | "stale" | "current"
  execution: Coordination.RunState | "unknown"
}
export type PersonOverview = {
  userId: string
  role: Coordination.Membership["role"]
  statedFocus?: StatedFocus
  agentReports: OverviewSession[]
}
export type ProjectOverview = {
  project: Coordination.SharedProject
  sessions: OverviewSession[]
  people: PersonOverview[]
  attention: { kind: "tool-permission"; threadId: string; approvalId: string }[]
  reportedResults: { threadId: string; text: string; refs: Coordination.WorkCard["evidenceRefs"] }[]
}
export type SessionOwner = { threadId: string; sessionId: string; workerId: string; ownerId: string }
export type SessionIntent = {
  threadId: string
  topic: string
  relationship: "alternative" | "related" | "unspecified"
}
export type RelatedWork = {
  thread: Coordination.Thread
  kind: "deliberate-alternative" | "reported-completion" | "possible-overlap"
  card?: Coordination.WorkCard
}

export function buildProjectOverview(input: {
  project: Coordination.SharedProject
  members: readonly Coordination.Membership[]
  threads: readonly Coordination.Thread[]
  cards: readonly Coordination.WorkCard[]
  snapshots: readonly Snapshot[]
  statedFocus: readonly StatedFocus[]
  /** Trusted server binding only; never infer ownership from Thread.createdBy. */
  sessionOwners?: readonly SessionOwner[]
}): ProjectOverview {
  const threads = input.threads.filter((thread) => thread.projectId === input.project.id)
  const members = input.members.filter((member) => member.projectId === input.project.id)
  const memberIds = new Set(members.map((member) => member.userId))
  const cards = new Map(
    input.cards
      .filter((card) => card.projectId === input.project.id)
      .map((card) => [card.threadId, card]),
  )
  const snapshots = new Map(
    input.snapshots
      .filter((snapshot) => snapshot.thread.projectId === input.project.id)
      .map((snapshot) => [snapshot.thread.id, snapshot]),
  )
  const sessions = threads.map((thread): OverviewSession => {
    const card = cards.get(thread.id)
    const snapshot = snapshots.get(thread.id)
    const exact =
      snapshot?.thread.sessionId === thread.sessionId && snapshot.thread.workerId === thread.workerId
        ? snapshot
        : undefined
    const ordered = exact?.runs.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)) ?? []
    const latest = ordered.find((run) =>
      ["reserved", "running", "waiting_approval", "cancelling", "recovery_required"].includes(run.state),
    ) ?? ordered[0]
    const bindings = input.sessionOwners?.filter((owner) =>
      owner.threadId === thread.id && owner.sessionId === thread.sessionId &&
      owner.workerId === thread.workerId && memberIds.has(owner.ownerId as Coordination.UserID),
    ) ?? []
    return {
      thread,
      ownerId: bindings.length === 1 ? bindings[0]?.ownerId : undefined,
      card,
      freshness: !card ? "missing" : card.sourceActivitySeq !== thread.activitySeq ? "stale" : "current",
      execution: latest?.state ?? "unknown",
    }
  })
  const people = members
    .map((member): PersonOverview => ({
      userId: member.userId,
      role: member.role,
      statedFocus: input.statedFocus.find((focus) => focus.userId === member.userId && focus.text.trim()),
      agentReports: sessions.filter((session) => session.ownerId === member.userId),
    }))
  const attention = sessions.flatMap((session) => {
    const snapshot = snapshots.get(session.thread.id)
    if (
      snapshot?.thread.sessionId !== session.thread.sessionId ||
      snapshot.thread.workerId !== session.thread.workerId
    ) return []
    return snapshot.approvals
      .filter((approval) => approval.threadId === session.thread.id && ["pending", "claimed"].includes(approval.state))
      .map((approval) => ({
        kind: "tool-permission" as const,
        threadId: session.thread.id,
        approvalId: approval.id,
      }))
  })
  const reportedResults = sessions.flatMap((session) =>
    session.freshness === "current" && session.card && hasInspectableOutcome(session.card)
      ? [{ threadId: session.thread.id, text: session.card.recentVerifiedOutcome, refs: session.card.evidenceRefs }]
      : [],
  )
  return { project: input.project, sessions, people, attention, reportedResults }
}

export function relatedWork(
  topic: string,
  sessions: readonly OverviewSession[],
  intents: readonly SessionIntent[],
  excludeThreadId?: string,
): RelatedWork[] {
  if (!topic.trim()) return []
  const selected = new Map(intents.filter((intent) => intent.topic === topic).map((intent) => [intent.threadId, intent]))
  return sessions
    .filter((session) => session.thread.id !== excludeThreadId && selected.has(session.thread.id))
    .map((session) => ({
      thread: session.thread,
      card: session.card,
      kind: selected.get(session.thread.id)?.relationship === "alternative"
        ? "deliberate-alternative" as const
        : session.freshness === "current" && session.card?.status === "done" && hasInspectableOutcome(session.card)
          ? "reported-completion" as const
          : "possible-overlap" as const,
    }))
}

function hasInspectableOutcome(
  card: Coordination.WorkCard,
): card is Coordination.WorkCard & { recentVerifiedOutcome: string } {
  return !!card.recentVerifiedOutcome?.trim() &&
    card.evidenceRefs.length > 0 &&
    card.evidenceRefs.every((ref) => ref.threadId === card.threadId && ref.seq <= card.sourceActivitySeq)
}
