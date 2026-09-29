import type { Coordination } from "@opencode-ai/schema/coordination"

export interface SessionIdentityProps {
  title: string
  sessionId: string
  workerId?: string
  ownerId?: string
  threadId?: string
  run?: Pick<Coordination.Run, "threadId" | "state">
  labels: {
    session: string
    worker: string
    owner: string
    runState: (state: Coordination.RunState) => string
  }
  density?: "rail" | "header"
}

function shortId(id: string) {
  return id.length > 16 ? `${id.slice(0, 4)}…${id.slice(-10)}` : id
}

export function sessionIdentityView(input: SessionIdentityProps) {
  const title = input.title.trim() || input.sessionId
  const activeRun =
    input.threadId && input.run?.threadId === input.threadId &&
    !["completed", "failed", "cancelled"].includes(input.run.state)
      ? input.run
      : undefined
  const state = activeRun ? input.labels.runState(activeRun.state) : undefined
  return {
    title,
    session: shortId(input.sessionId),
    worker: input.workerId ? shortId(input.workerId) : undefined,
    owner: input.ownerId,
    state,
    accessibleLabel: [
      title,
      `${input.labels.session} ${input.sessionId}`,
      input.workerId ? `${input.labels.worker} ${input.workerId}` : undefined,
      input.ownerId ? `${input.labels.owner} ${input.ownerId}` : undefined,
      state,
    ].filter(Boolean).join(" · "),
  }
}
