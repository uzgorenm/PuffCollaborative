import type { Delivery, DeliverySource, EvidenceRef, ProjectSnapshot, Worker } from "./project-api"

export function workerOnline(worker: Worker | undefined, now: number) {
  if (!worker || worker.state !== "online") return false
  const age = now - Date.parse(worker.lastSeenAt)
  return Number.isFinite(age) && age >= -5_000 && age <= 30_000
}
export function sessionViews(snapshot: ProjectSnapshot, now: number) {
  return snapshot.sessions.map((session) => {
    const worker = snapshot.workers.find((item) => item.workerId === session.workerId)
    const summary = snapshot.summaries
      .filter((item) => item.workerId === session.workerId && item.sessionId === session.sessionId)
      .sort((a, b) => b.revision - a.revision)[0]
    return {
      session,
      worker,
      summary,
      online: workerOnline(worker, now),
      stale: !!summary && summary.revision !== session.revision,
    }
  })
}
export function evidenceStale(snapshot: ProjectSnapshot, refs: EvidenceRef[]) {
  return (
    refs.length === 0 ||
    refs.some((ref) => {
      const session = snapshot.sessions.find((s) => s.workerId === ref.workerId && s.sessionId === ref.sessionId)
      return (
        session?.revision !== ref.revision ||
        !snapshot.events.some(
          (event) =>
            event.workerId === ref.workerId &&
            event.sessionId === ref.sessionId &&
            event.eventId === ref.eventId &&
            event.revision === ref.revision,
        )
      )
    })
  )
}
export function deliveryState(deliveries: Delivery[], source: DeliverySource) {
  const delivery = deliveries.find(
    (item) =>
      item.sourceKind === source.sourceKind &&
      item.sourceId === source.sourceId &&
      item.targetWorkerId === source.targetWorkerId &&
      item.targetSessionId === source.targetSessionId,
  )
  if (!delivery) return "pending" as const
  if (delivery.state === "delivered" && !delivery.messageId) return "pending" as const
  return delivery.state
}
export function evidenceText(content: Record<string, unknown>) {
  return ["text", "role", "toolName", "status"]
    .flatMap((key) => (typeof content[key] === "string" ? [content[key] as string] : []))
    .join(" · ")
}
