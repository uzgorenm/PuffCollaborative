import { For, Show, createMemo } from "solid-js"
import { A } from "@solidjs/router"
import { Button } from "@opencode-ai/ui/button"
import { useLanguage } from "@/context/language"
import type { Coordination } from "@opencode-ai/schema/coordination"
import type { TeamThread } from "@/pages/puff/team-api"
import { selectContext } from "./model"
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
}

export function ContextPanel(props: ContextPanelProps) {
  const language = useLanguage()
  const view = createMemo(() => selectContext(props))
  const unavailable = () => language.t(
    view().state === "offline" ? "puff.team.connectToRead"
      : view().state === "unavailable" ? "puff.team.localUnavailable"
        : view().state === "loading" ? "puff.team.loading"
          : "puff.team.noContext",
  )

  return (
    <div class="puff-context">
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
                        <A href={`/puff/thread/${encodeURIComponent(ref.threadId)}#event-${encodeURIComponent(ref.eventId)}`}>
                          <span aria-hidden="true">↗</span><code>{ref.eventId}</code>
                          <small>{language.t("puff.team.sequence", { sequence: ref.seq })}</small>
                        </A>
                      )}
                    </For>
                  </Show>
                </details>
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
          </>
        )}
      </Show>
    </div>
  )
}
