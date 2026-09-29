import { For, Show, createEffect, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { useLanguage } from "@/context/language"
import type { Coordination } from "@opencode-ai/schema/coordination"
import type { TeamThread } from "@/pages/puff/team-api"
import { teamEventText } from "@/pages/puff/team-state"
import { canOfferDecisionRetry, selectContext } from "./model"
import { createSourcePeek, type SourcePeekState, type SourceRef, type SourceResolver } from "./source-peek"
import "./context-panel.css"

export interface ContextPanelProps {
  target?: { sessionId: string; workerId?: string; threadId?: string }
  snapshot?: TeamThread
  related?: readonly Coordination.Thread[]
  connected: boolean
  loading: boolean
  error?: string
  writable: boolean
  busy: boolean
  onCancel: (run: Coordination.Run) => void
  onReject: (approval: Coordination.Approval) => void
  sourceScope?: string
  resolveSource?: SourceResolver
  canRetryDecision?: (approval: Coordination.Approval) => boolean
  onRetryDecision?: (approval: Coordination.Approval) => void | Promise<void>
}

export function ContextPanel(props: ContextPanelProps) {
  const language = useLanguage()
  const view = createMemo(() => selectContext(props))
  const [peekView, setPeekView] = createStore<{ source: SourcePeekState; openedScope: string }>({
    source: { status: "closed" },
    openedScope: "",
  })
  const peek = createSourcePeek((state) => setPeekView("source", state))
  const sourceScope = createMemo(() => {
    const thread = view().thread
    if (!thread || !props.sourceScope || !props.resolveSource) return ""
    return JSON.stringify([
      props.sourceScope, thread.projectId, thread.id, thread.sessionId, thread.workerId,
      view().card?.id, view().card?.version, view().card?.sourceActivitySeq,
      view().sources.map((ref) => [ref.threadId, ref.eventId, ref.seq]),
    ])
  })
  createEffect(() => {
    setPeekView("openedScope", "")
    peek.setScope(sourceScope(), props.resolveSource)
  })
  onCleanup(() => peek.close())
  let closeButton: HTMLButtonElement | undefined
  const inspect = (ref: SourceRef, button: HTMLButtonElement) => {
    const thread = view().thread
    const scope = sourceScope()
    if (!thread || !scope) return
    setPeekView("openedScope", scope)
    void peek.inspect(ref, thread.projectId, button)
    queueMicrotask(() => {
      if (sourceScope() === scope && peek.state().status !== "closed" && closeButton?.isConnected) closeButton.focus()
    })
  }
  const visiblePeek = () => !!peekView.openedScope && sourceScope() === peekView.openedScope && peekView.source.status !== "closed"
  const sourceEvent = () => {
    if (!visiblePeek()) return undefined
    const state = peekView.source
    return state.status === "ready" ? state.event : undefined
  }
  const inspecting = (ref: SourceRef) => {
    const state = peekView.source
    return visiblePeek() && state.status !== "closed" && state.ref.eventId === ref.eventId &&
      state.ref.threadId === ref.threadId && state.ref.seq === ref.seq
  }
  const unavailable = () => language.t(
    view().state === "offline" ? "puff.team.connectToRead"
      : view().state === "unavailable" ? "puff.team.localUnavailable"
        : view().state === "loading" ? "puff.team.loading"
          : "puff.team.noContext",
  )

  return (
    <div class="puff-context" onKeyDown={(event) => {
      if (event.key !== "Escape" || !visiblePeek()) return
      event.preventDefault()
      event.stopPropagation()
      peek.close(true)
    }}>
      <h2>{language.t("puff.team.context")}</h2>
      <p class="puff-context-caption">{language.t("puff.team.contextHint")}</p>
      <Show when={view().state !== "ready"}>
        <div class="puff-context-empty" role="status"><span aria-hidden="true">✳</span><p>{unavailable()}</p></div>
      </Show>
      <Show when={view().thread}>
        {(thread) => (
          <>
            <section class="puff-context-section">
              <span class="puff-context-kicker">{language.t("puff.session")}</span>
              <dl class="puff-context-identity">
                <div><dt>{language.t("puff.worker")}</dt><dd><code>{thread().workerId}</code></dd></div>
                <div><dt>{language.t("puff.session")}</dt><dd><code>{thread().sessionId}</code></dd></div>
              </dl>
            </section>
            <section class="puff-context-section">
              <span class="puff-context-kicker">{language.t("puff.team.working")}</span>
              <Show when={view().card} fallback={<p>{language.t("puff.noSummary")}</p>}>
                {(card) => <><h3>{card().currentTask}</h3><p>{card().progress}</p></>}
              </Show>
              <Show when={view().stale}><p class="puff-context-notice">{language.t("puff.staleSummary")}</p></Show>
            </section>
            <Show when={view().card?.blockers.length}>
              <section class="puff-context-section">
                <span class="puff-context-kicker">{language.t("puff.blocker")}</span>
                <For each={view().card?.blockers}>{(blocker) => <p>{blocker}</p>}</For>
              </section>
            </Show>
            <section class="puff-context-section">
              <span class="puff-context-kicker">{language.t("puff.relationship")}</span>
              <p>{language.t("puff.unspecified")}</p>
            </section>
            <Show when={view().verifiedOutcome}>
              {(outcome) => (
                <section class="puff-context-section">
                  <span class="puff-context-kicker">{language.t("puff.team.latestOutcome")}</span>
                  <p>{outcome()}</p>
                </section>
              )}
            </Show>
            <section class="puff-context-section">
              <span class="puff-context-kicker">{language.t("puff.findings")}</span>
              <p>{language.t("puff.noNotes")}</p>
              <p class="puff-context-caption">{language.t("puff.useUnverified")}</p>
            </section>
            <Show when={view().card}>
              <section class="puff-context-section">
                <details class="puff-context-sources">
                  <summary>{language.t("puff.evidence", { count: view().sources.length })}</summary>
                  <Show when={view().sources.length} fallback={<p>{language.t("puff.evidenceMissing")}</p>}>
                    <For each={view().sources}>
                      {(ref) => (
                        <div class="puff-context-source-row">
                          <Show when={sourceScope()} fallback={<><code>{ref.eventId}</code><small>{language.t("puff.team.sourceUnavailable")}</small></>}>
                            <button type="button" aria-expanded={inspecting(ref)} onClick={(event) => inspect(ref, event.currentTarget)}>
                              <span aria-hidden="true">↗</span>{language.t("puff.team.source")} <code>{ref.eventId}</code>
                            </button>
                          </Show>
                          <small>{language.t("puff.team.sequence", { sequence: ref.seq })}</small>
                        </div>
                      )}
                    </For>
                  </Show>
                </details>
                <Show when={visiblePeek()}>
                  <div class="puff-context-peek" role="region" aria-label={language.t("puff.team.sourceEvent")}>
                    <button ref={closeButton} type="button" class="puff-context-peek-close" onClick={() => peek.close(true)}>{language.t("puff.team.sourceClose")}</button>
                    <Show when={peekView.source.status === "loading"}><p role="status">{language.t("puff.team.sourceLoading")}</p></Show>
                    <Show when={peekView.source.status === "missing"}><p role="status">{language.t("puff.team.sourceMissing")}</p></Show>
                    <Show when={peekView.source.status === "no-access"}><p role="status">{language.t("puff.team.sourceNoAccess")}</p></Show>
                    <Show when={peekView.source.status === "unavailable"}><p role="status">{language.t("puff.team.sourceUnavailable")}</p></Show>
                    <Show when={sourceEvent()}>
                      {(event) => <div class="puff-context-source-detail">
                        <code>{event().kind}</code><code>{event().id}</code>
                        <small>{language.t("puff.team.sequence", { sequence: event().seq })}</small>
                        <p>{teamEventText(event()) || language.t("puff.team.recorded")}</p>
                      </div>}
                    </Show>
                  </div>
                </Show>
              </section>
            </Show>
            <Show when={view().activeRuns.length}>
              <section class="puff-context-section">
                <span class="puff-context-kicker">{language.t("puff.team.upNext")}</span>
                <For each={view().activeRuns}>
                  {(run) => (
                    <div class="puff-context-queue">
                      <span>{language.t(`puff.team.run.${run.state}`)}</span>
                      <p>{props.snapshot?.instructions.find((instruction) => instruction.threadId === thread().id && instruction.id === run.instructionId)?.text}</p>
                      <Button size="small" variant="ghost" disabled={!props.writable || props.busy || run.state === "cancelling"} onClick={() => props.onCancel(run)}>{language.t("puff.team.stop")}</Button>
                    </div>
                  )}
                </For>
              </section>
            </Show>
            <For each={view().approvals}>
              {(approval) => (
                <section class="puff-context-approval">
                  <h3>{language.t("puff.team.toolPermission")}</h3>
                  <code>{approval.toolCallId}</code>
                  <p>{language.t("puff.team.permissionHint")}</p>
                  <div>
                    <Button size="small" disabled={!props.writable || props.busy} onClick={() => props.onReject(approval)}>{language.t("puff.reject")}</Button>
                    <Button size="small" variant="primary" disabled={true}>{language.t("puff.team.allow")}</Button>
                  </div>
                </section>
              )}
            </For>
            <For each={view().deliveryIssues}>
              {(approval) => {
                const retryable = () => canOfferDecisionRetry(approval, props.canRetryDecision, props.onRetryDecision)
                return <section class="puff-context-approval">
                  <h3>{language.t("puff.team.decisionDelivery")}</h3>
                  <code>{approval.toolCallId}</code>
                  <p>{language.t(approval.state === "rejected" ? "puff.team.toolRejected" : "puff.team.toolApproved")}</p>
                  <p role="status">{language.t(approval.deliveryState === "failed" ? "puff.failed" : "puff.pending")}</p>
                  <Show when={retryable()} fallback={<p>{language.t("puff.team.retryUnavailable")}</p>}>
                    <Button size="small" disabled={!props.writable || props.busy} onClick={() => {
                      if (retryable()) void props.onRetryDecision?.(approval)
                    }}>{language.t("puff.team.retryDecision")}</Button>
                  </Show>
                </section>
              }}
            </For>
          </>
        )}
      </Show>
    </div>
  )
}
