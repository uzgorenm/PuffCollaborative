import type { Coordination } from "@opencode-ai/schema/coordination"

export type Submission = { threadId: string; kind: "instruction" | "comment"; text: string; requestId: string }

export function mergeTeamEvents(
  current: readonly Coordination.Event[],
  incoming: readonly Coordination.Event[],
  threadId: string,
) {
  return [
    ...new Map(
      [...current, ...incoming].filter((event) => event.threadId === threadId).map((event) => [event.id, event]),
    ).values(),
  ].sort((a, b) => a.seq - b.seq)
}

export function submissionAttempt(
  current: Submission | undefined,
  input: Omit<Submission, "requestId">,
  id: () => string = () => crypto.randomUUID(),
): Submission {
  if (!current) return { ...input, requestId: id() }
  if (current.threadId !== input.threadId || current.kind !== input.kind || current.text !== input.text)
    throw new Error("Unresolved submission")
  return current
}

export function teamEventText(event: Coordination.Event) {
  const field =
    event.kind === "comment.created"
      ? "body"
      : event.kind === "run.output" || event.kind === "instruction.submitted"
        ? "text"
        : "summary"
  return typeof event.payload[field] === "string" ? event.payload[field] : ""
}
