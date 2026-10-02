export * as CoordinationAnalysisResults from "./results"

import { and, eq } from "drizzle-orm"
import { isDeepStrictEqual } from "node:util"
import { Effect } from "effect"
import type { Coordination } from "@opencode-ai/schema/coordination"
import { SessionV2 } from "../../session"
import { Database } from "../../database/database"
import { SessionMessage } from "../../session/message"
import { SessionAwareness } from "../../session/awareness"
import { SessionInput } from "../../session/input"
import { Prompt } from "../../session/prompt"
import type { AuthorizedRun } from "../../runner-harness/contracts"
import { CoordinationAccess } from "../access"
import type { CoordinationContracts } from "../contracts"
import type { CoordinationCooperation } from "../cooperation"
import { CoordinationProvisioning } from "../provisioning"
import { CoordinationAwarenessDelivery } from "../awareness/delivery"
import { AnalysisDeliveryTable, AnalysisResultTable } from "./results.sql"
import { evidenceEligible } from "./export"

const forbidden: CoordinationContracts.Failure = {
  code: "forbidden",
  message: "Trusted result and current owner consent required",
}
const conflict: CoordinationContracts.Failure = {
  code: "conflict",
  message: "Analysis result or selected source changed",
}
const invalid: CoordinationContracts.Failure = {
  code: "invalid",
  message: "Invalid bounded informational analysis result",
}
const stableId = (value: string) => /^[A-Za-z0-9_:-]{1,160}$/.test(value)
const informational = (text: string) =>
  text.trim().length > 0 &&
  text.length <= 2000 &&
  !/\b(stop|abandon|switch|must|should|please|instead|implement|replace|ignore|disregard|override|execute|delete)\b/i.test(
    text,
  ) &&
  !/(bearer\s+\S+|sk-[a-z0-9_-]{12,}|(?:api[_-]?key|password|secret|access[_-]?token)\s*[=:])/i.test(text)

/** Attribute only the exact durable informational note admitted through the owner delivery API. */
export const trustedPrompt = (db: Database.Interface["db"], run: AuthorizedRun, messageID: SessionMessage.ID) =>
  Effect.gen(function* () {
    const receipt = yield* db
      .select()
      .from(AnalysisDeliveryTable)
      .where(eq(AnalysisDeliveryTable.message_id, messageID))
      .get()
      .pipe(Effect.orDie)
    if (!receipt) return false
    const report = yield* db
      .select()
      .from(AnalysisResultTable)
      .where(eq(AnalysisResultTable.report_id, receipt.report_id))
      .get()
      .pipe(Effect.orDie)
    const note = report?.content.awarenessNoteCandidates.find((item) => item.noteId === receipt.note_id)
    if (
      !report ||
      !note ||
      report.project_id !== run.projectId ||
      note.targetThreadId !== run.command.threadId ||
      !informational(note.text)
    )
      return false
    const access = CoordinationAccess.make(db)
    const threads = yield* Effect.forEach([note.sourceThreadId, note.targetThreadId], (id) =>
      access.getThread({ kind: "analysis", serviceId: "analysis-attribution" }, id, "update_work_card"),
    )
    const [source, target] = threads
    if (
      source.projectId !== run.projectId ||
      target.projectId !== run.projectId ||
      target.sessionId !== run.command.sessionId ||
      target.workerId !== run.command.executionOwner.workerId ||
      run.session.id !== target.sessionId ||
      (yield* CoordinationProvisioning.ownerOf(db, target)) !== receipt.owner_id
    )
      return false
    const input = yield* SessionInput.find(db, messageID)
    const citation = note.evidenceRefs.filter((ref) => ref.threadId === source.id).sort((a, b) => b.seq - a.seq)[0]
    if (!input || !citation) return false
    const text = SessionAwareness.promptText({
      messageID,
      target: { sessionID: target.sessionId, projectID: target.projectId, location: run.session.location },
      source: { sessionID: source.sessionId, eventID: citation.eventId, revision: note.sourceActivitySeq },
      reportID: report.report_id,
      authorID: receipt.owner_id,
      finding: note.text,
    })
    return SessionInput.equivalent(input, {
      sessionID: target.sessionId,
      prompt: Prompt.make({ text }),
      delivery: "steer",
    })
  }).pipe(Effect.catch(() => Effect.succeed(false)))

export function make(deps: {
  readonly database: Database.Interface
  readonly sessions: SessionV2.Interface
  readonly access: CoordinationContracts.Access
  readonly events: CoordinationContracts.Events
  readonly binding: CoordinationContracts.SessionBinding
  readonly cooperation: CoordinationCooperation.Interface
}) {
  const db = deps.database.db
  const read = (reportId: string) =>
    db.select().from(AnalysisResultTable).where(eq(AnalysisResultTable.report_id, reportId)).get().pipe(Effect.orDie)
  const validate = (projectId: Coordination.ProjectID, content: Coordination.AnalysisResultContent) =>
    Effect.gen(function* () {
      if (
        !stableId(content.reportId) ||
        !stableId(content.requestId) ||
        content.sourceThreadId === content.targetThreadId ||
        !Number.isSafeInteger(content.sourceActivitySeq) ||
        content.sourceActivitySeq < 0 ||
        !Number.isSafeInteger(content.targetActivitySeq) ||
        content.targetActivitySeq < 0 ||
        content.awarenessNoteCandidates.length > 1 ||
        Object.keys(content.cooperationVersions).length !== 2
      )
        return yield* Effect.fail(invalid)
      const threads = yield* Effect.forEach([content.sourceThreadId, content.targetThreadId], (id) =>
        deps.access.getThread({ kind: "analysis", serviceId: "analysis-validation" }, id, "update_work_card"),
      )
      if (threads.some((thread) => thread.projectId !== projectId) || threads[0].sessionId === threads[1].sessionId)
        return yield* Effect.fail(forbidden)
      const settings = yield* Effect.forEach(threads, (thread, index) =>
        Effect.gen(function* () {
          const ownerId = yield* CoordinationProvisioning.ownerOf(db, thread)
          const binding = yield* deps.binding.resolve(thread.sessionId)
          if (!ownerId || binding.projectId !== projectId || binding.workerId !== thread.workerId)
            return yield* Effect.fail(forbidden)
          const consent = yield* deps.cooperation.get({ kind: "member", userId: ownerId }, thread.id)
          if (!consent.analysisEnabled || consent.ownerId !== ownerId) return yield* Effect.fail(forbidden)
          if (
            consent.version !== content.cooperationVersions[thread.id] ||
            thread.activitySeq !== (index === 0 ? content.sourceActivitySeq : content.targetActivitySeq)
          )
            return yield* Effect.fail(conflict)
          return consent
        }),
      )
      if (settings[0].featureTopic !== settings[1].featureTopic) return yield* Effect.fail(forbidden)
      let cursor = -1
      let latestSourceSeq = -1
      let sourceRecords = 0
      while (true) {
        const page = yield* deps.events.replayThread(content.sourceThreadId, cursor, 256)
        sourceRecords += page.events.length
        if (sourceRecords > 2000)
          return yield* Effect.fail({
            code: "unavailable" as const,
            message: "Source evidence exceeds bounded analysis limit",
          })
        for (const event of page.events)
          if (evidenceEligible(event, { ownerId: settings[0].ownerId!, textEnabled: settings[0].analysisTextEnabled }))
            latestSourceSeq = Math.max(latestSourceSeq, event.seq)
        if (!page.hasMore) break
        if (page.cursor <= cursor) return yield* Effect.fail(invalid)
        cursor = page.cursor
      }
      for (const note of content.awarenessNoteCandidates) {
        if (
          !stableId(note.noteId) ||
          !informational(note.text) ||
          note.featureTopic !== settings[0].featureTopic ||
          note.sourceThreadId !== content.sourceThreadId ||
          note.targetThreadId !== content.targetThreadId ||
          note.sourceActivitySeq !== content.sourceActivitySeq ||
          note.targetActivitySeq !== content.targetActivitySeq ||
          note.candidateState !== "pending" ||
          note.deliveryState !== "not_attempted" ||
          note.evidenceRefs.length < 2 ||
          note.evidenceRefs.length > 40 ||
          new Set(note.evidenceRefs.map((ref) => ref.threadId)).size !== 2
        )
          return yield* Effect.fail(invalid)
        for (const ref of note.evidenceRefs) {
          if (
            ![content.sourceThreadId, content.targetThreadId].includes(ref.threadId) ||
            !Number.isSafeInteger(ref.seq) ||
            ref.seq < 0
          )
            return yield* Effect.fail(invalid)
          if (ref.threadId === content.sourceThreadId && ref.seq !== latestSourceSeq)
            return yield* Effect.fail(conflict)
          const event = (yield* deps.events.replayThread(ref.threadId, ref.seq - 1, 1)).events[0]
          const consent = settings[ref.threadId === content.sourceThreadId ? 0 : 1]
          if (
            !event ||
            event.id !== ref.eventId ||
            event.seq !== ref.seq ||
            event.threadId !== ref.threadId ||
            event.projectId !== projectId ||
            !evidenceEligible(event, { ownerId: consent.ownerId!, textEnabled: consent.analysisTextEnabled })
          )
            return yield* Effect.fail(invalid)
        }
      }
      return { threads, settings }
    })
  const receipt = (content: Coordination.AnalysisResultContent) => ({
    reportId: content.reportId,
    requestId: content.requestId,
    registered: true as const,
  })
  const delivery = CoordinationAwarenessDelivery.make({
    access: deps.access,
    events: deps.events,
    binding: deps.binding,
    policy: {
      validate: ({ principal, sourceThread, targetThread, sourceEvent, reportID, finding }) =>
        Effect.gen(function* () {
          const row = yield* read(reportID)
          if (!row || row.content.sourceThreadId !== sourceThread.id || row.content.targetThreadId !== targetThread.id)
            return false
          const current = yield* validate(row.project_id, row.content)
          return (
            current.settings[1].ownerId === principal.userId &&
            current.settings[1].awarenessMode === "notify" &&
            row.content.awarenessNoteCandidates.some(
              (note) =>
                note.text === finding &&
                note.evidenceRefs.some(
                  (ref) =>
                    ref.threadId === sourceThread.id && ref.eventId === sourceEvent.id && ref.seq === sourceEvent.seq,
                ),
            )
          )
        }),
    },
  })
  return {
    receipt: (principal: Coordination.AuthContext, threadId: Coordination.ThreadID, reportId: string, noteId: string) =>
      Effect.gen(function* () {
        if (principal.kind !== "member") return yield* Effect.fail(forbidden)
        const thread = yield* deps.access.getThread(principal, threadId, "read")
        if ((yield* CoordinationProvisioning.ownerOf(db, thread)) !== principal.userId)
          return yield* Effect.fail(forbidden)
        const row = yield* read(reportId)
        if (
          !row?.content.awarenessNoteCandidates.some(
            (note) => note.noteId === noteId && note.targetThreadId === threadId,
          )
        )
          return yield* Effect.fail({ code: "not_found" as const, message: "Awareness receipt was not found" })
        const reservation = yield* db
          .select()
          .from(AnalysisDeliveryTable)
          .where(and(eq(AnalysisDeliveryTable.report_id, reportId), eq(AnalysisDeliveryTable.note_id, noteId)))
          .get()
          .pipe(Effect.orDie)
        if (!reservation || reservation.owner_id !== principal.userId)
          return yield* Effect.fail({ code: "not_found" as const, message: "Awareness was not admitted" })
        const admitted = yield* SessionAwareness.receipt({
          sessionID: thread.sessionId,
          messageID: SessionMessage.ID.make(reservation.message_id),
        }).pipe(
          Effect.provideService(Database.Service, deps.database),
          Effect.mapError(() => forbidden),
        )
        if (!admitted) return yield* Effect.fail({ code: "not_found" as const, message: "Awareness was not admitted" })
        return {
          sessionID: admitted.sessionID,
          messageID: admitted.id,
          admittedSeq: admitted.admittedSeq,
          ...(admitted.promotedSeq === undefined ? {} : { promotedSeq: admitted.promotedSeq }),
          activeObserved: (yield* deps.sessions.active).has(thread.sessionId),
        }
      }),
    register: (
      principal: Coordination.AuthContext,
      projectId: Coordination.ProjectID,
      content: Coordination.AnalysisResultContent,
    ) =>
      Effect.gen(function* () {
        if (principal.kind !== "analysis") return yield* Effect.fail(forbidden)
        const prior = yield* read(content.reportId)
        if (
          prior &&
          (prior.project_id !== projectId ||
            prior.service_id !== principal.serviceId ||
            !isDeepStrictEqual(prior.content, content))
        )
          return yield* Effect.fail(conflict)
        yield* validate(projectId, content)
        if (prior) return receipt(prior.content)
        const inserted = yield* db
          .insert(AnalysisResultTable)
          .values({
            report_id: content.reportId,
            project_id: projectId,
            request_id: content.requestId,
            service_id: principal.serviceId,
            content,
            created_at: Date.now(),
          })
          .onConflictDoNothing()
          .returning()
          .get()
          .pipe(Effect.orDie)
        if (!inserted) {
          const raced = yield* read(content.reportId)
          if (
            !raced ||
            raced.project_id !== projectId ||
            raced.service_id !== principal.serviceId ||
            !isDeepStrictEqual(raced.content, content)
          )
            return yield* Effect.fail(conflict)
        }
        return receipt(content)
      }),
    deliver: (
      principal: Coordination.AuthContext,
      threadId: Coordination.ThreadID,
      request: { reportId: string; noteId: string; messageId: SessionMessage.ID },
    ) =>
      Effect.gen(function* () {
        if (principal.kind !== "member") return yield* Effect.fail(forbidden)
        const target = yield* deps.access.getThread(principal, threadId, "submit")
        const ownerId = yield* CoordinationProvisioning.ownerOf(db, target)
        if (!ownerId || principal.userId !== ownerId) return yield* Effect.fail(forbidden)
        const row = yield* read(request.reportId)
        const note = row?.content.awarenessNoteCandidates.find(
          (item) => item.noteId === request.noteId && item.targetThreadId === threadId,
        )
        if (!row || !note)
          return yield* Effect.fail({
            code: "not_found" as const,
            message: "Registered awareness candidate was not found",
          })
        const current = yield* validate(row.project_id, row.content)
        if (current.settings[1].awarenessMode !== "notify") return yield* Effect.fail(forbidden)
        const source = note.evidenceRefs
          .filter((ref) => ref.threadId === note.sourceThreadId)
          .sort((left, right) => right.seq - left.seq)[0]
        if (!source) return yield* Effect.fail(invalid)
        yield* db
          .insert(AnalysisDeliveryTable)
          .values({
            report_id: request.reportId,
            note_id: request.noteId,
            message_id: request.messageId,
            owner_id: ownerId,
            created_at: Date.now(),
          })
          .onConflictDoNothing()
          .run()
          .pipe(Effect.orDie)
        const reservation = yield* db
          .select()
          .from(AnalysisDeliveryTable)
          .where(
            and(eq(AnalysisDeliveryTable.report_id, request.reportId), eq(AnalysisDeliveryTable.note_id, request.noteId)),
          )
          .get()
          .pipe(Effect.orDie)
        if (!reservation || reservation.message_id !== request.messageId || reservation.owner_id !== ownerId)
          return yield* Effect.fail(conflict)
        return yield* delivery
          .deliver({
            principal,
            sourceThreadID: note.sourceThreadId,
            targetThreadID: threadId,
            source: { eventID: source.eventId, eventSeq: source.seq, activitySeq: note.sourceActivitySeq },
            reportID: request.reportId,
            messageID: request.messageId,
            finding: note.text,
          })
          .pipe(
            Effect.provideService(SessionV2.Service, deps.sessions),
            Effect.provideService(Database.Service, deps.database),
          )
      }),
  }
}
