export * as CoordinationAwarenessDelivery from "./delivery"

import { Effect } from "effect"
import type { Coordination } from "@opencode-ai/schema/coordination"
import { SessionV2 } from "../../session"
import { SessionAwareness } from "../../session/awareness"
import { SessionInput } from "../../session/input"
import type { SessionMessage } from "../../session/message"
import { Prompt } from "../../session/prompt"
import type { CoordinationContracts } from "../contracts"

export interface Input {
  readonly principal: Coordination.AuthContext
  readonly sourceThreadID: Coordination.ThreadID
  readonly targetThreadID: Coordination.ThreadID
  readonly source: {
    readonly eventID: string
    readonly eventSeq: number
    readonly activitySeq: number
  }
  readonly reportID: string
  readonly messageID: SessionMessage.ID
  readonly finding: string
}

/** Must validate the trusted report and current sharing, topic, mute, and redirection rules. */
export interface Policy {
  readonly validate: (input: {
    readonly principal: Extract<Coordination.AuthContext, { kind: "member" }>
    readonly sourceThread: Coordination.Thread
    readonly targetThread: Coordination.Thread
    readonly sourceEvent: Coordination.Event
    readonly reportID: string
    readonly finding: string
  }) => Effect.Effect<boolean, CoordinationContracts.Failure>
}

export interface Dependencies {
  readonly access: Pick<CoordinationContracts.Access, "getThread">
  readonly events: Pick<CoordinationContracts.Events, "replayThread">
  readonly binding: CoordinationContracts.SessionBinding
  readonly policy: Policy
}

const contentKinds = new Set<Coordination.EventKind>([
  "comment.created",
  "run.tool",
  "run.output",
  "run.workspace",
  "run.diff",
])
const invalid: CoordinationContracts.Failure = { code: "invalid", message: "Invalid awareness note or citation" }
const forbidden: CoordinationContracts.Failure = { code: "forbidden", message: "Awareness delivery is not authorized" }
const stale: CoordinationContracts.Failure = { code: "conflict", message: "Source activity changed since analysis" }
const inactive: CoordinationContracts.Failure = { code: "unavailable", message: "Target Session is not active here" }

export function make(deps: Dependencies) {
  return {
    deliver: Effect.fn("CoordinationAwarenessDelivery.deliver")(function* (input: Input) {
      if (
        input.principal.kind !== "member" ||
        input.sourceThreadID === input.targetThreadID ||
        !input.reportID.trim() ||
        !input.messageID ||
        !input.finding.trim() ||
        input.finding.length > 2_000 ||
        !Number.isSafeInteger(input.source.eventSeq) ||
        input.source.eventSeq < 0 ||
        !Number.isSafeInteger(input.source.activitySeq) ||
        input.source.activitySeq < 0
      )
        return yield* Effect.fail(invalid)

      const [sourceThread, targetThread] = yield* Effect.all([
        deps.access.getThread(input.principal, input.sourceThreadID, "read"),
        deps.access.getThread(input.principal, input.targetThreadID, "read"),
      ])
      if (
        sourceThread.id !== input.sourceThreadID ||
        targetThread.id !== input.targetThreadID ||
        sourceThread.projectId !== targetThread.projectId ||
        sourceThread.sessionId === targetThread.sessionId
      )
        return yield* Effect.fail(forbidden)
      if (sourceThread.activitySeq !== input.source.activitySeq) return yield* Effect.fail(stale)

      const page = yield* deps.events.replayThread(sourceThread.id, input.source.eventSeq - 1, 1)
      const event = page.events[0]
      if (
        !event ||
        event.id !== input.source.eventID ||
        event.seq !== input.source.eventSeq ||
        event.threadId !== sourceThread.id ||
        event.projectId !== sourceThread.projectId ||
        !contentKinds.has(event.kind)
      )
        return yield* Effect.fail(invalid)

      const binding = yield* deps.binding.resolve(targetThread.sessionId)
      if (binding.projectId !== targetThread.projectId || binding.workerId !== targetThread.workerId)
        return yield* Effect.fail(forbidden)
      const sessions = yield* SessionV2.Service
      const target = yield* sessions.get(targetThread.sessionId).pipe(Effect.mapError(() => forbidden))
      if (target.projectID !== targetThread.projectId) return yield* Effect.fail(forbidden)

      // This required port is the trusted report and current consent gate; no default permits delivery.
      const allowed = yield* deps.policy.validate({
        principal: input.principal,
        sourceThread,
        targetThread,
        sourceEvent: event,
        reportID: input.reportID,
        finding: input.finding,
      })
      if (!allowed) return yield* Effect.fail(forbidden)

      const note = {
        messageID: input.messageID,
        target: { sessionID: target.id, projectID: target.projectID, location: target.location },
        source: {
          sessionID: sourceThread.sessionId,
          eventID: event.id,
          revision: sourceThread.activitySeq,
        },
        reportID: input.reportID,
        authorID: input.principal.userId,
        finding: input.finding,
      } satisfies SessionAwareness.ValidatedNote
      const prior = yield* SessionAwareness.receipt({ sessionID: target.id, messageID: input.messageID }).pipe(
        Effect.mapError(() => forbidden),
      )
      if (prior) {
        if (
          !SessionInput.equivalent(prior, {
            sessionID: target.id,
            prompt: Prompt.make({ text: SessionAwareness.promptText(note) }),
            delivery: "steer",
          })
        )
          return yield* Effect.fail({
            code: "conflict" as const,
            message: "Awareness message ID has different content",
          })
        return {
          sessionID: prior.sessionID,
          messageID: prior.id,
          admittedSeq: prior.admittedSeq,
          promotedSeq: prior.promotedSeq,
          activeObserved: (yield* sessions.active).has(target.id),
        }
      }
      if (!(yield* sessions.active).has(target.id)) return yield* Effect.fail(inactive)
      return yield* SessionAwareness.admit(note).pipe(
        Effect.mapError(
          (error): CoordinationContracts.Failure => ({
            code: error instanceof SessionAwareness.TargetMismatch ? "forbidden" : "conflict",
            message: "Awareness admission failed or conflicts with an earlier delivery",
          }),
        ),
      )
    }),
  }
}
