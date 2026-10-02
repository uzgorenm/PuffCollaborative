export * as CoordinationAnalysisExport from "./export"

import { Effect } from "effect"
import type { Coordination } from "@opencode-ai/schema/coordination"
import type { CoordinationContracts } from "../contracts"

export interface Grant {
  readonly ownerId: Coordination.UserID
  readonly projectId: Coordination.ProjectID
  readonly sessionId: Coordination.Thread["sessionId"]
  readonly workerId: Coordination.WorkerID
  readonly featureTopic: string
  readonly relationship: "alternative" | "unspecified"
  readonly expiresAt: string
  readonly muted: boolean
  readonly version?: number
  readonly textEnabled?: boolean
}

export interface Selection {
  // Must consult current server-owned consent, not the fact that a Thread was once shared.
  readonly current: (thread: Coordination.Thread) => Effect.Effect<Grant | undefined, CoordinationContracts.Failure>
}

export interface Input {
  readonly auth: Coordination.AuthContext
  readonly projectId: Coordination.ProjectID
  readonly sourceThreadId: Coordination.ThreadID
  readonly targetThreadId: Coordination.ThreadID
  readonly requestId: string
  readonly access: Pick<CoordinationContracts.Access, "getThread">
  readonly binding: CoordinationContracts.SessionBinding
  readonly selection: Selection
  readonly events: Pick<CoordinationContracts.Events, "replayThread">
}

const forbidden: CoordinationContracts.Failure = { code: "forbidden", message: "Current export selection is required" }
const conflict: CoordinationContracts.Failure = { code: "conflict", message: "Selected session changed during capture" }
const invalid: CoordinationContracts.Failure = { code: "invalid", message: "Invalid selected export" }
const unavailable: CoordinationContracts.Failure = {
  code: "unavailable",
  message: "Selected export source unavailable",
}
const contentKinds = new Set<Coordination.EventKind>([
  "comment.created",
  "run.tool",
  "run.output",
  "run.workspace",
  "run.diff",
])
const safeTools = new Set([
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Glob",
  "Grep",
  "Task",
  "read",
  "write",
  "edit",
  "bash",
  "glob",
  "grep",
])

// Builds the exact request/snapshot consumed by the OpenCode analysis agent in script/runtime/analysis.ts.
// Only separately consented owner instructions and redacted runner output can add bounded text.
export const captureSelected = (input: Input) =>
  Effect.gen(function* () {
    if (
      input.auth.kind !== "member" ||
      input.sourceThreadId === input.targetThreadId ||
      !/^[A-Za-z0-9_-]{1,160}$/.test(input.requestId)
    )
      return yield* Effect.fail(invalid)
    const at = new Date()
    if (!Number.isFinite(at.getTime()) || !input.selection) return yield* Effect.fail(unavailable)
    const threads = yield* Effect.forEach([input.sourceThreadId, input.targetThreadId], (id) =>
      input.access.getThread(input.auth, id, "read"),
    )
    if (threads.some((thread) => thread.projectId !== input.projectId) || threads[0].sessionId === threads[1].sessionId)
      return yield* Effect.fail(forbidden)
    const grants = yield* Effect.forEach(threads, (thread) => currentGrant(input, thread, at))
    if (grants[0].featureTopic !== grants[1].featureTopic) return yield* Effect.fail(forbidden)

    const selected = yield* Effect.forEach(threads, (thread, index) =>
      Effect.gen(function* () {
        const records: Coordination.Event[] = []
        let cursor = -1
        while (true) {
          const page = yield* input.events.replayThread(thread.id, cursor, 256)
          if (
            page.events.some(
              (event) => event.threadId !== thread.id || event.projectId !== input.projectId || event.seq <= cursor,
            )
          )
            return yield* Effect.fail(invalid)
          records.push(...page.events)
          if (records.length > 2000) return yield* Effect.fail(unavailable)
          if (!page.hasMore) break
          if (page.cursor <= cursor) return yield* Effect.fail(unavailable)
          cursor = page.cursor
        }
        const grant = grants[index]
        const eligible = records.filter((event) => evidenceEligible(event, grant))
        if (!eligible.length) return yield* Effect.fail(conflict)
        const recent = eligible.slice(-20)
        return {
          session: {
            workerId: thread.workerId,
            sessionId: thread.sessionId,
            ownerId: grants[index].ownerId,
            title: index === 0 ? "Selected source session" : "Selected target session",
            featureTopic: grants[index].featureTopic,
            relationship: grants[index].relationship,
            revision: recent.at(-1)!.seq,
            status: "unknown",
          },
          events: recent.map((event) => projectEvent(event, thread, grant)),
          provenance: recent.map((event) => ({
            threadId: thread.id,
            eventId: event.id,
            eventSeq: event.seq,
            threadActivitySeq: thread.activitySeq,
          })),
        }
      }),
    )

    // Recheck revocation and content freshness after replay, before exposing the envelope.
    const fresh = yield* Effect.forEach(threads, (thread) => input.access.getThread(input.auth, thread.id, "read"))
    if (
      fresh.some(
        (thread, index) =>
          thread.projectId !== threads[index].projectId ||
          thread.sessionId !== threads[index].sessionId ||
          thread.workerId !== threads[index].workerId ||
          thread.createdBy !== threads[index].createdBy ||
          thread.activitySeq !== threads[index].activitySeq,
      )
    )
      return yield* Effect.fail(conflict)
    const rechecked = yield* Effect.forEach(fresh, (thread) => currentGrant(input, thread, new Date()))
    if (
      rechecked.some(
        (grant, index) =>
          grant.ownerId !== grants[index].ownerId ||
          grant.projectId !== grants[index].projectId ||
          grant.sessionId !== grants[index].sessionId ||
          grant.workerId !== grants[index].workerId ||
          grant.featureTopic !== grants[index].featureTopic ||
          grant.relationship !== grants[index].relationship ||
          grant.expiresAt !== grants[index].expiresAt ||
          grant.muted !== grants[index].muted ||
          grant.version !== grants[index].version ||
          grant.textEnabled !== grants[index].textEnabled,
      )
    )
      return yield* Effect.fail(conflict)

    const sameOwner = selected[0].session.ownerId === selected[1].session.ownerId
    const workers = selected.map((item) => ({
      workerId: item.session.workerId,
      projectId: input.projectId,
      ...(sameOwner || selected[0].session.workerId !== selected[1].session.workerId
        ? { ownerId: item.session.ownerId }
        : {}),
    }))
    const request = {
      requestId: input.requestId,
      projectId: input.projectId,
      targetWorkerId: threads[1].workerId,
      targetSessionId: threads[1].sessionId,
      question: "What current work is relevant to the selected target session?",
      evidenceRefs: selected.map((item) => {
        const event = item.events.at(-1)!
        return {
          workerId: event.workerId,
          sessionId: event.sessionId,
          eventId: event.eventId,
          revision: event.revision,
        }
      }),
      createdAt: at.toISOString(),
    }
    const snapshot = {
      schemaVersion: 1,
      projectId: input.projectId,
      workers: workers[0].workerId === workers[1].workerId ? workers.slice(0, 1) : workers,
      sharedSessions: selected.map((item) => item.session),
      events: selected.flatMap((item) => item.events),
    }
    return { request, snapshot, provenance: selected.flatMap((item) => item.provenance) }
  })

function currentGrant(input: Input, thread: Coordination.Thread, at: Date) {
  return Effect.gen(function* () {
    const binding = yield* input.binding.resolve(thread.sessionId)
    if (binding.projectId !== thread.projectId || binding.workerId !== thread.workerId)
      return yield* Effect.fail(forbidden)
    const grant = yield* input.selection.current(thread)
    if (
      !grant ||
      grant.muted ||
      grant.projectId !== thread.projectId ||
      grant.sessionId !== thread.sessionId ||
      grant.workerId !== thread.workerId ||
      !/^[A-Za-z][A-Za-z0-9 _-]{0,79}$/.test(grant.featureTopic) ||
      /\b(?:sk-|api[_-]?key|password|secret|token)\b/i.test(grant.featureTopic) ||
      !["alternative", "unspecified"].includes(grant.relationship) ||
      !Number.isFinite(Date.parse(grant.expiresAt)) ||
      Date.parse(grant.expiresAt) <= at.getTime()
    )
      return yield* Effect.fail(forbidden)
    return grant
  })
}

const safeText = (value: unknown): string | undefined => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    /(bearer\s+\S+|sk-[a-z0-9_-]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_-]?key|password|secret|(?:access[_-]?)?token|authorization)\s*[=:]|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\b(?:gh[pousr]_|github_pat_|xox[baprs]-)[a-z0-9_-]{16,}|\bAIza[a-z0-9_-]{30,}|\beyJ[a-z0-9_-]{15,}\.[a-z0-9_-]{15,}\.[a-z0-9_-]{15,}|https?:\/\/[^\s/]+:[^\s/@]+@)/i.test(
      value,
    )
  )
    return undefined
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, 2000)
}

export const evidenceEligible = (event: Coordination.Event, grant: Pick<Grant, "ownerId" | "textEnabled">) =>
  contentKinds.has(event.kind) ||
  (grant.textEnabled === true &&
    event.kind === "instruction.submitted" &&
    event.actorId === grant.ownerId &&
    safeText(event.payload.text) !== undefined)

function projectEvent(event: Coordination.Event, thread: Coordination.Thread, grant: Grant) {
  const text =
    grant.textEnabled === true &&
    (event.kind === "run.output" || (event.kind === "instruction.submitted" && event.actorId === grant.ownerId))
      ? safeText(event.payload.text)
      : undefined
  const content =
    text !== undefined
      ? { role: event.kind === "instruction.submitted" ? "user" : "assistant", text }
      : event.kind === "run.tool"
        ? {
            toolName: safeTools.has(event.payload.toolName as string) ? (event.payload.toolName as string) : "other",
            toolStatus: ["started", "completed", "failed"].includes(event.payload.status as string)
              ? (event.payload.status as string)
              : "unknown",
          }
        : { transition: "progress" }
  return {
    eventId: event.id,
    projectId: event.projectId,
    workerId: thread.workerId,
    sessionId: thread.sessionId,
    revision: event.seq,
    kind:
      text !== undefined
        ? ("message" as const)
        : event.kind === "run.tool"
          ? ("activity" as const)
          : ("status" as const),
    occurredAt: event.occurredAt,
    content,
  }
}
