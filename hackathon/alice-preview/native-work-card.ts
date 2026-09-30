type Event = {
  id: string
  threadId: string
  seq: number
  kind: string
  instructionId?: string
  runId?: string
  actorId?: string
  payload: Record<string, unknown>
}
type Snapshot = {
  thread: { id: string; activitySeq: number; createdBy: string; title?: string }
  instructions: { id: string; text: string; runId: string }[]
  runs: { id: string; state: string }[]
  workCard?: { version: number; sourceActivitySeq: number; summaryJobId: string }
}

/** A literal projection of native queue/runtime evidence, without an invented model summary. */
export function nativeWorkCard(snapshot: Snapshot, events: Event[], generatedAt = new Date().toISOString()) {
  const run = snapshot.runs.at(-1)
  const instruction = run && snapshot.instructions.find((item) => item.runId === run.id)
  if (!run || !instruction) return undefined
  const current = events.filter(
    (event) => event.threadId === snapshot.thread.id && event.seq <= snapshot.thread.activitySeq,
  )
  const sourceInstruction = current.find(
    (event) =>
      event.kind === "instruction.submitted" && event.instructionId === instruction.id && event.runId === run.id,
  )
  // A queued/preparation-failed instruction can be newer than content activity.
  // Its identical owner-authored task comment remains an exact eligible source.
  const ownerTask = current.find(
    (event) =>
      event.kind === "comment.created" &&
      event.actorId === snapshot.thread.createdBy &&
      event.payload.body === instruction.text,
  )
  const outputs = current.filter(
    (event) => event.kind === "run.output" && event.runId === run.id && typeof event.payload.text === "string",
  )
  const output = outputs.at(-1)
  const state = current
    .filter(
      (event) =>
        event.runId === run.id &&
        ["run.started", "run.failed", "run.completed", "run.approval.requested"].includes(event.kind),
    )
    .at(-1)
  const refs = [sourceInstruction ?? ownerTask, output, state].filter((event): event is Event => Boolean(event))
  if (!refs.length) return undefined
  const status =
    run.state === "completed"
      ? "done"
      : ["failed", "waiting_approval", "recovery_required", "cancelling"].includes(run.state)
        ? "blocked"
        : ["running", "reserved"].includes(run.state)
          ? "active"
          : "queued"
  const blockers =
    run.state === "waiting_approval"
      ? ["Alice's edit is waiting for its owner's actual approval."]
      : run.state === "failed"
        ? ["The native Run failed. Its recorded result does not establish a successful source change."]
        : run.state === "recovery_required"
          ? ["The native runner requires recovery."]
          : []
  const summaryJobId = `native-run-projection:${run.id}:${run.state}:${snapshot.thread.activitySeq}`
  if (
    snapshot.workCard?.sourceActivitySeq === snapshot.thread.activitySeq &&
    snapshot.workCard.summaryJobId === summaryJobId
  )
    return undefined
  return {
    expectedVersion: snapshot.workCard?.version ?? 0,
    sourceActivitySeq: snapshot.thread.activitySeq,
    card: {
      currentTask: instruction.text.slice(0, 4000),
      progress: output
        ? String(output.payload.text).slice(-7000)
        : `Actual native Run state: ${run.state}. No assistant output has been recorded yet.`,
      blockers,
      status,
      summaryJobId,
      recentVerifiedOutcome:
        run.state === "completed" && output
          ? `The native Run completed. Recorded assistant report: ${String(output.payload.text).slice(-7000)}`
          : null,
      contributors: [snapshot.thread.createdBy],
      evidenceRefs: [
        ...new Map(
          refs.map((event) => [event.id, { threadId: event.threadId, eventId: event.id, seq: event.seq }]),
        ).values(),
      ],
      generatedAt,
    },
  }
}
