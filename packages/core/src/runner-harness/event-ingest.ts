import { Effect, Queue, Schema } from "effect"
import { Permission } from "@opencode-ai/schema/permission"
import { SessionEvent } from "@opencode-ai/schema/session-event"
import { EventV2 } from "../event"
import { PermissionV2 } from "../permission"
import { SessionV2 } from "../session"
import type { EventIngestion, Failure, Observation } from "./contracts"

export type RejectedEvent = {
  readonly sourceKey: string
  readonly type: string
  readonly reason: "invalid" | "unattributed" | "conflicting_text" | "foreign_prompt" | "wrong_location"
}

export interface Dependencies {
  readonly sessions: Pick<SessionV2.Interface, "history">
  readonly events: Pick<EventV2.Interface, "listen">
  readonly permissions: Pick<PermissionV2.Interface, "forSession">
  /** Receives identifiers only, never raw event content. */
  readonly rejected?: (event: RejectedEvent) => Effect.Effect<void>
}

export function make(input: Dependencies): EventIngestion {
  return {
    observe: ({ execution, session, onObservation, onReady }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const run = execution.run
          if (
            run.command.sessionId !== session.id ||
            run.session.id !== session.id ||
            run.projectId !== session.projectID ||
            run.session.projectID !== session.projectID ||
            run.session.location.directory !== session.location.directory ||
            run.session.location.workspaceID !== session.location.workspaceID ||
            (execution.admittedMessageId !== undefined &&
              execution.admittedMessageId !== run.command.runnerMessageId) ||
            (execution.workspace !== undefined &&
              (execution.workspace.threadId !== run.command.threadId ||
                execution.workspace.projectId !== run.projectId ||
                execution.workspace.directory !== session.location.directory ||
                execution.workspace.id !== session.location.workspaceID)) ||
            (execution.runtime !== undefined &&
              (execution.runtime.workerId !== run.command.executionOwner.workerId ||
                execution.runtime.instanceId !== run.command.executionOwner.instanceId))
          )
            return yield* Effect.fail({
              code: "conflict",
              message: "Runner observation binding mismatch",
            } satisfies Failure)

          const queue = yield* Queue.dropping<EventV2.Payload>(1_024)
          let overflow = false
          const unsubscribe = yield* input.events.listen((event) => {
            // A child Session's parentID alone does not bind its events to this Run.
            if (eventSessionID(event) !== session.id) return Effect.void
            return Queue.offer(queue, event).pipe(
              Effect.flatMap((accepted) =>
                accepted
                  ? Effect.void
                  : Effect.sync(() => {
                      overflow = true
                    }),
              ),
            )
          })
          yield* Effect.addFinalizer(() => unsubscribe.pipe(Effect.andThen(Queue.shutdown(queue)), Effect.asVoid))

          const assistants = new Set<string>()
          const tools = new Map<string, string>()
          const texts = new Map<string, string>()
          const permissions = new Set<string>()
          let cursor = -1
          let anchored = false
          let closed = false

          const reject = (sourceKey: string, type: string, reason: RejectedEvent["reason"]) =>
            input.rejected?.({ sourceKey, type, reason }) ?? Effect.void

          const emit = (observation: Observation) => onObservation(observation)

          const permission = Effect.fn("RunnerEventIngest.permission")(function* (request: Permission.Request) {
            if (request.sessionID !== session.id) return
            if (permissions.has(request.id)) return
            const sourceKey = `permission:${request.id}`
            if (
              !anchored ||
              closed ||
              request.source?.type !== "tool" ||
              !assistants.has(request.source.messageID) ||
              !tools.has(messageKey(request.source.messageID, request.source.callID))
            ) {
              yield* reject(sourceKey, Permission.Event.Asked.type, "unattributed")
              return
            }
            permissions.add(request.id)
            yield* emit({ kind: "permission", runId: run.command.runId, sourceKey, request })
          })

          const sessionEvent = Effect.fn("RunnerEventIngest.sessionEvent")(function* (event: SessionEvent.Event) {
            if (event.data.sessionID !== session.id) return
            if (
              event.location &&
              (event.location.directory !== session.location.directory ||
                event.location.workspaceID !== session.location.workspaceID)
            ) {
              yield* reject(event.id, event.type, "wrong_location")
              return
            }

            if (event.type === SessionEvent.Prompted.type) {
              if (event.data.messageID === run.command.runnerMessageId && !closed) {
                if (anchored) return
                anchored = true
                yield* emit({
                  kind: "promoted",
                  runId: run.command.runId,
                  sourceKey: event.id,
                  sourceSessionSeq: event.durable?.seq,
                  messageId: run.command.runnerMessageId,
                })
                return
              }
              if (anchored && !closed) {
                closed = true
                yield* reject(event.id, event.type, "foreign_prompt")
              }
              return
            }

            if (!anchored || closed) return

            if (event.type === SessionEvent.Step.Started.type) {
              assistants.add(event.data.assistantMessageID)
              return
            }

            if (event.type === SessionEvent.Text.Delta.type) {
              // Deltas are live-only. The replayable Text.Ended value is the outbound source of truth.
              return
            }

            if (event.type === SessionEvent.Text.Ended.type) {
              if (!assistants.has(event.data.assistantMessageID)) {
                yield* reject(event.id, event.type, "unattributed")
                return
              }
              const key = messageKey(event.data.assistantMessageID, event.data.textID)
              const previous = texts.get(key) ?? ""
              if (previous && !event.data.text.startsWith(previous)) {
                yield* reject(event.id, event.type, "conflicting_text")
                return
              }
              texts.set(key, event.data.text)
              const suffix = event.data.text.slice(previous.length)
              for (let offset = 0; offset < suffix.length; offset += 8_000)
                yield* emit({
                  kind: "activity",
                  runId: run.command.runId,
                  sourceKey: `${event.id}:output:${offset}`,
                  sourceSessionSeq: event.durable?.seq,
                  activity: { kind: "run.output", text: suffix.slice(offset, offset + 8_000) },
                })
              return
            }

            if (event.type === SessionEvent.Tool.Input.Started.type) {
              if (assistants.has(event.data.assistantMessageID))
                tools.set(messageKey(event.data.assistantMessageID, event.data.callID), event.data.name)
              return
            }

            if (event.type === SessionEvent.Tool.Called.type) {
              if (!assistants.has(event.data.assistantMessageID)) {
                yield* reject(event.id, event.type, "unattributed")
                return
              }
              tools.set(messageKey(event.data.assistantMessageID, event.data.callID), event.data.tool)
              yield* emit({
                kind: "activity",
                runId: run.command.runId,
                sourceKey: event.id,
                sourceSessionSeq: event.durable?.seq,
                activity: { kind: "run.tool", toolName: event.data.tool, status: "started" },
              })
              return
            }

            if (event.type === SessionEvent.Tool.Success.type || event.type === SessionEvent.Tool.Failed.type) {
              const toolName = tools.get(messageKey(event.data.assistantMessageID, event.data.callID))
              if (!assistants.has(event.data.assistantMessageID) || toolName === undefined) {
                yield* reject(event.id, event.type, "unattributed")
                return
              }
              yield* emit({
                kind: "activity",
                runId: run.command.runId,
                sourceKey: event.id,
                sourceSessionSeq: event.durable?.seq,
                activity: {
                  kind: "run.tool",
                  toolName,
                  status: event.type === SessionEvent.Tool.Success.type ? "completed" : "failed",
                },
              })
              return
            }

            if (event.type === SessionEvent.Step.Ended.type || event.type === SessionEvent.Step.Failed.type) {
              if (!assistants.has(event.data.assistantMessageID)) {
                yield* reject(event.id, event.type, "unattributed")
                return
              }
              if (event.type === SessionEvent.Step.Ended.type && event.data.finish === "tool-calls") return
              // A settled provider step is evidence; R3 must still confirm the Session drain ended.
              yield* emit({
                kind: event.type === SessionEvent.Step.Ended.type ? "settled" : "failed",
                runId: run.command.runId,
                sourceKey: event.id,
                sourceSessionSeq: event.durable?.seq,
                messageId: run.command.runnerMessageId,
              })
            }
          })

          const history = Effect.fn("RunnerEventIngest.history")(function* () {
            while (true) {
              const page = yield* input.sessions
                .history({ sessionID: session.id, after: cursor, limit: 256 })
                .pipe(
                  Effect.mapError(
                    () => ({ code: "unavailable", message: "Session history unavailable" }) satisfies Failure,
                  ),
                )
              for (const event of page.events) {
                const seq = event.durable?.seq
                if (seq === undefined || seq <= cursor) continue
                cursor = seq
                yield* sessionEvent(event)
              }
              if (!page.hasMore) return
              if (page.events.length === 0)
                yield* Effect.fail({
                  code: "unavailable",
                  message: "Session history did not advance",
                } satisfies Failure)
            }
          })

          const pending = () =>
            Effect.flatMap(input.permissions.forSession(session.id), (requests) => Effect.forEach(requests, permission))
          yield* history()
          yield* pending()
          yield* onReady ?? Effect.void

          while (true) {
            const event = yield* Queue.take(queue)
            if (overflow) {
              overflow = false
              yield* history()
              yield* pending()
            }
            if (event.durable?.aggregateID === session.id) {
              if (event.durable.seq > cursor) yield* history()
              continue
            }
            if (event.type === Permission.Event.Asked.type) {
              if (Schema.is(Permission.Event.Asked)(event)) yield* permission(event.data)
              else yield* reject(event.id, event.type, "invalid")
              continue
            }
            if (Schema.is(SessionEvent.All)(event)) {
              yield* sessionEvent(event)
              continue
            }
            if (eventSessionID(event) === session.id) yield* reject(event.id, event.type, "invalid")
          }
        }),
      ),
  }
}

function eventSessionID(event: EventV2.Payload) {
  if (typeof event.data !== "object" || event.data === null || !("sessionID" in event.data)) return undefined
  return event.data.sessionID
}

function messageKey(messageID: string, id: string) {
  return JSON.stringify([messageID, id])
}
