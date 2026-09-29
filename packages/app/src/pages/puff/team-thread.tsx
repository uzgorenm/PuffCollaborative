import { For, Show, createEffect, createMemo, onCleanup, on } from "solid-js"
import { useParams, useLocation, A } from "@solidjs/router"
import { Button } from "@opencode-ai/ui/button"
import { useLanguage } from "@/context/language"
import { useTeam } from "./team-context"
import { ContextPanel } from "@/components/puff/context-panel"
import { teamEventText } from "./team-state"

export default function TeamThreadPage() {
  const params = useParams<{ threadId: string }>()
  const location = useLocation()
  const team = useTeam()
  const language = useLanguage()
  let viewport: HTMLDivElement | undefined
  let contextToggle: HTMLButtonElement | undefined
  let nearBottom = true
  let frame = 0
  let restored = ""
  let revealed = ""
  const savePosition = (id: string) => {
    if (viewport && restored === id) team.set("positions", id, { top: viewport.scrollTop, followTail: nearBottom })
  }
  createEffect(
    on(
      () => params.threadId,
      (id, previous) => {
        if (previous) savePosition(previous)
        nearBottom = team.state.positions[id]?.followTail ?? true
        restored = ""
        revealed = ""
        team.selectThread(id)
      },
    ),
  )
  onCleanup(() => {
    savePosition(params.threadId)
    cancelAnimationFrame(frame)
    if (team.state.threadId === params.threadId) team.selectThread("")
  })
  const snapshot = () => team.state.snapshot
  const draft = () => team.state.drafts[params.threadId] ?? { text: "", kind: "instruction" as const }
  const pending = () => team.state.pending[params.threadId]
  const runs = () => snapshot()?.runs ?? []
  const active = () => runs().filter((run) => !["completed", "failed", "cancelled"].includes(run.state))
  const visible = createMemo(() =>
    team.state.events.filter((event) =>
      [
        "instruction.submitted",
        "comment.created",
        "run.output",
        "run.tool",
        "run.diff",
        "run.failed",
        "run.completed",
        "run.recovery.required",
      ].includes(event.kind),
    ),
  )
  const sourceId = () => {
    if (!location.hash.startsWith("#event-")) return ""
    try {
      return decodeURIComponent(location.hash.slice(7))
    } catch {
      return ""
    }
  }
  const missingSource = () =>
    !!sourceId() && !team.state.loading && !!snapshot() && !visible().some((event) => event.id === sourceId())
  createEffect(() => {
    const id = params.threadId
    const source = sourceId()
    visible().at(-1)?.id
    if (team.state.loading || !snapshot()) return
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      if (!viewport) return
      if (source) {
        if (revealed === `${id}:${source}`) return
        const target = document.getElementById(`event-${source}`)
        if (target) {
          revealed = `${id}:${source}`
          target.scrollIntoView({ block: "center", behavior: "auto" })
          target.focus({ preventScroll: true })
          nearBottom = false
        }
        restored = id
        return
      }
      if (restored !== id) {
        const position = team.state.positions[id]
        viewport.scrollTo({
          top: position && !position.followTail ? position.top : viewport.scrollHeight,
          behavior: "auto",
        })
        restored = id
        return
      }
      if (nearBottom) viewport.scrollTo({ top: viewport.scrollHeight, behavior: "auto" })
    })
  })
  const updateDraft = (text: string, kind = draft().kind) => team.set("drafts", params.threadId, { text, kind })
  return (
    <section class="team-thread" classList={{ "team-context-closed": !team.state.context }}>
      <header class="team-thread-header">
        <div class="team-thread-heading">
          <span class="team-eyebrow">{language.t("puff.team.sharedConversation")}</span>
          <h1>{snapshot()?.thread.title ?? language.t("puff.team.conversation")}</h1>
          <Show when={snapshot()}>
            {(value) => (
              <p>
                {value().thread.createdBy}
                <span>·</span>
                {value().thread.workerId}
              </p>
            )}
          </Show>
        </div>
        <button
          class="team-context-toggle"
          ref={contextToggle}
          aria-controls="shared-team-context"
          type="button"
          aria-expanded={team.state.context}
          onClick={() => team.set("context", (value) => !value)}
        >
          {language.t("puff.team.context")}
          <span aria-hidden="true">◧</span>
        </button>
      </header>
      <Show when={team.state.error}>
        <div class="team-connection-alert" role="alert">
          <span>{language.t(`puff.${team.state.error || "request"}`)}</span>
          <Button size="small" onClick={() => void team.refresh()}>
            {language.t("puff.refresh")}
          </Button>
        </div>
      </Show>
      <div class="team-conversation-layout">
        <div class="team-conversation-main">
          <div
            class="team-messages"
            ref={viewport}
            onScroll={(event) => {
              nearBottom =
                event.currentTarget.scrollHeight - event.currentTarget.scrollTop - event.currentTarget.clientHeight < 90
              savePosition(params.threadId)
            }}
            aria-busy={team.state.loading}
          >
            <Show when={!team.state.connected}>
              <div class="team-conversation-empty">
                <span class="team-empty-symbol">↗</span>
                <h2>{language.t("puff.team.connectToRead")}</h2>
                <p>{language.t("puff.team.connectHint")}</p>
              </div>
            </Show>
            <Show when={team.state.connected && team.state.loading}>
              <div class="team-message-skeleton">
                <i />
                <i />
                <i />
              </div>
            </Show>
            <Show when={team.state.connected && !team.state.loading && !visible().length}>
              <div class="team-conversation-empty">
                <span class="team-empty-symbol">✳</span>
                <h2>{language.t("puff.team.startConversation")}</h2>
                <p>{language.t("puff.team.startHint")}</p>
              </div>
            </Show>
            <Show when={missingSource()}>
              <p role="status" class="team-connection-alert">
                {language.t("puff.team.sourceMissing")}
              </p>
            </Show>
            <For each={visible()}>
              {(event) => (
                <article
                  id={`event-${event.id}`}
                  tabIndex={-1}
                  class="team-message"
                  classList={{
                    "team-human-message": event.kind === "instruction.submitted",
                    "team-comment-message": event.kind === "comment.created",
                    "team-tool-message": event.kind === "run.tool" || event.kind === "run.diff",
                  }}
                >
                  <div class="team-message-byline">
                    <span class="team-message-avatar">
                      {event.actorId ? event.actorId.replace(/^usr_/, "").slice(0, 2).toUpperCase() : "✳"}
                    </span>
                    <strong>{event.actorId ?? language.t("puff.team.agent")}</strong>
                    <span class="team-message-kind">
                      {language.t(
                        event.kind === "instruction.submitted"
                          ? "puff.team.instruction"
                          : event.kind === "comment.created"
                            ? "puff.team.comment"
                            : event.kind === "run.tool"
                              ? "puff.team.tool"
                              : event.kind === "run.diff"
                                ? "puff.team.changes"
                                : "puff.team.update",
                      )}
                    </span>
                    <time dateTime={event.occurredAt}>
                      {new Date(event.occurredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </time>
                  </div>
                  <Show when={event.kind === "run.tool"}>
                    <div class="team-tool-label">
                      <span aria-hidden="true">⌘</span>
                      <code>
                        {typeof event.payload.toolName === "string"
                          ? event.payload.toolName
                          : language.t("puff.team.tool")}
                      </code>
                      <span>
                        {typeof event.payload.status === "string" &&
                        ["started", "completed", "failed"].includes(event.payload.status)
                          ? language.t(`puff.team.run.${event.payload.status as "started" | "completed" | "failed"}`)
                          : ""}
                      </span>
                    </div>
                  </Show>
                  <Show
                    when={teamEventText(event)}
                    fallback={
                      <p class="team-caption">
                        {language.t(
                          event.kind === "run.completed"
                            ? "puff.team.run.completed"
                            : event.kind === "run.failed"
                              ? "puff.team.run.failed"
                              : event.kind === "run.recovery.required"
                                ? "puff.team.run.recovery_required"
                                : "puff.team.recorded",
                        )}
                      </p>
                    }
                  >
                    <p class="team-message-text">{teamEventText(event)}</p>
                  </Show>
                  <Show when={event.kind === "run.diff" && typeof event.payload.ref === "string"}>
                    <code class="team-source-ref">{String(event.payload.ref)}</code>
                  </Show>
                  <details class="team-message-source">
                    <summary>{language.t("puff.team.source")}</summary>
                    <code>{event.id}</code>
                    <span>{language.t("puff.team.sequence", { sequence: event.seq })}</span>
                  </details>
                </article>
              )}
            </For>
          </div>
          <Show when={active().length}>
            <div class="team-run-strip" aria-live="polite">
              <span class="team-status-dot connected" />
              <span>{language.t(`puff.team.run.${active()[0]!.state}`)}</span>
              <Show when={active().length > 1}>
                <small>{language.t("puff.team.moreQueued", { count: active().length - 1 })}</small>
              </Show>
            </div>
          </Show>
          <form
            class="team-composer"
            onSubmit={(event) => {
              event.preventDefault()
              void team.send()
            }}
          >
            <Show when={pending() && !team.state.action}>
              <div class="team-pending-note" role="status">
                {language.t("puff.team.unconfirmed")}
              </div>
            </Show>
            <textarea
              aria-label={language.t("puff.team.message")}
              placeholder={language.t(
                draft().kind === "comment" ? "puff.team.commentPlaceholder" : "puff.team.instructionPlaceholder",
              )}
              value={draft().text}
              onInput={(event) => updateDraft(event.currentTarget.value)}
              disabled={!team.state.connected || !!pending()}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.isComposing) {
                  event.preventDefault()
                  void team.send()
                }
              }}
              rows={3}
            />
            <div class="team-composer-footer">
              <label>
                <span class="team-sr-only">{language.t("puff.team.messageType")}</span>
                <select
                  value={draft().kind}
                  disabled={!!pending()}
                  onChange={(event) =>
                    updateDraft(draft().text, event.currentTarget.value as "instruction" | "comment")
                  }
                >
                  <option value="instruction">{language.t("puff.team.instruction")}</option>
                  <option value="comment">{language.t("puff.team.comment")}</option>
                </select>
              </label>
              <span class="team-composer-hint">
                {language.t(draft().kind === "comment" ? "puff.team.commentHint" : "puff.team.queueHint")}
              </span>
              <Button
                type="submit"
                variant="primary"
                disabled={!team.writable() || !!team.state.action || !draft().text.trim()}
              >
                {language.t(
                  team.state.action ? "puff.team.sending" : pending() ? "puff.team.retrySame" : "puff.team.send",
                )}
                <span aria-hidden="true">↑</span>
              </Button>
            </div>
          </form>
        </div>
        <aside
          id="shared-team-context"
          class="team-context-panel"
          inert={!team.state.context}
          aria-label={language.t("puff.team.context")}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation()
              team.set("context", false)
              contextToggle?.focus()
            }
          }}
        >
          <ContextPanel
            target={
              snapshot()
                ? {
                    sessionId: snapshot()!.thread.sessionId,
                    workerId: snapshot()!.thread.workerId,
                    threadId: snapshot()!.thread.id,
                  }
                : undefined
            }
            snapshot={snapshot()}
            related={team.state.threads}
            connected={team.state.connected}
            loading={team.state.loading}
            error={team.state.error}
            writable={team.writable()}
            busy={!!team.state.action}
            onCancel={(run) => void team.control("cancel", run)}
            onReject={(approval) => void team.control("reject", approval)}
          />
        </aside>
      </div>
    </section>
  )
}

export function TeamHome() {
  const language = useLanguage()
  return (
    <div class="team-conversation-empty team-welcome">
      <span class="team-empty-symbol">✳</span>
      <h1>{language.t("puff.team.welcome")}</h1>
      <p>{language.t("puff.team.welcomeHint")}</p>
      <A href="/">{language.t("puff.team.backToSessions")} ↗</A>
    </div>
  )
}
