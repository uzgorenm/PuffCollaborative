import { For, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { useLanguage } from "@/context/language"
import { useGlobal } from "@/context/global"
import { ServerConnection } from "@/context/server"
import { sessionHref } from "@/utils/session-route"
import { SessionCard } from "@/components/puff/session-card"
import { ProposalCard } from "@/components/puff/proposal-card"
import { DecisionList } from "@/components/puff/decision-list"
import { Evidence } from "@/components/puff/evidence"
import { createPuffController } from "./controller"
import { deliveryState, evidenceStale, sessionViews } from "./project-state"
import type { AwarenessNote, SharedSession } from "./project-api"
import type { PreviewScenario } from "./preview"
import "./puff.css"

export default function PuffPage() {
  const language = useLanguage()
  const global = useGlobal()
  const ui = createPuffController()
  const views = () =>
    sessionViews(ui.state.snapshot, ui.state.now).map((view) => ({ ...view, online: view.online && ui.writable() }))
  const sessionKey = (session: SharedSession) => `${session.workerId}\0${session.sessionId}`
  const title = (workerId: string, sessionId: string) =>
    ui.state.snapshot.sessions.find((s) => s.workerId === workerId && s.sessionId === sessionId)?.title ?? sessionId
  const href = (session: SharedSession) => {
    const server = global.servers.list().find((s) => ServerConnection.key(s) === session.serverKey)
    return server ? sessionHref(ServerConnection.key(server), encodeURIComponent(session.sessionId)) : undefined
  }
  const noteState = (note: AwarenessNote) =>
    note.state === "stale" || evidenceStale(ui.state.snapshot, note.evidenceRefs)
      ? "stale"
      : note.state === "failed"
        ? "failed"
        : deliveryState(ui.state.snapshot.deliveries, {
            sourceKind: "awarenessNote",
            sourceId: note.noteId,
            targetWorkerId: note.targetWorkerId,
            targetSessionId: note.targetSessionId,
          })
  const reviews = () => ui.state.snapshot.proposals.filter((p) => p.state === "proposed").length
  return (
    <Show when={ui.state.viewId} keyed>
      {(_) => (
        <main class="puff-page">
          <div class="puff-shell">
            <header class="puff-topbar">
              <a class="puff-brand" href="/puff">
                <span class="puff-brand-mark" aria-hidden="true">
                  p
                </span>
                {language.t("puff.name")}
                <span class="puff-divider" />
                <span class="puff-caption">{language.t("puff.nav")}</span>
              </a>
              <div class="puff-actions">
                <a class="puff-back" href="/">
                  {language.t("puff.back")} ↗
                </a>
                <Button
                  onClick={() =>
                    ui.state.mode === "preview" ? ui.setState("connectionOpen", !ui.state.connectionOpen) : ui.preview()
                  }
                  disabled={ui.busy()}
                >
                  {language.t(ui.state.mode === "preview" ? "puff.connect" : "puff.disconnect")}
                </Button>
              </div>
            </header>
            <section class="puff-hero">
              <div>
                <span class="puff-kicker">{language.t("puff.eyebrow")}</span>
                <h1>{language.t("puff.title")}</h1>
                <p>{language.t("puff.subtitle")}</p>
              </div>
              <div class="puff-project-badge">
                <span class="puff-dot" />
                <div>
                  <strong>{ui.state.snapshot.projectName ?? ui.state.snapshot.projectId}</strong>
                  <span class="puff-caption">
                    {language.t(ui.state.mode === "preview" ? "puff.preview" : "puff.live")}
                  </span>
                </div>
              </div>
            </section>
            <Show when={ui.state.mode === "preview"}>
              <div class="puff-preview-banner">
                <div>
                  <strong>{language.t("puff.preview")}</strong>
                  <p>{language.t("puff.previewNotice")}</p>
                </div>
                <div class="puff-actions">
                  <label class="puff-sr-only" for="puff-scenario">
                    {language.t("puff.scenario")}
                  </label>
                  <select
                    id="puff-scenario"
                    value={ui.state.scenario}
                    onChange={(e) => ui.preview(e.currentTarget.value as PreviewScenario)}
                  >
                    <For each={["collaboration", "offline", "stale", "failed"] as const}>
                      {(scenario) => <option value={scenario}>{language.t(`puff.scenario.${scenario}`)}</option>}
                    </For>
                  </select>
                  <Button variant="ghost" onClick={() => ui.preview()}>
                    {language.t("puff.reset")}
                  </Button>
                </div>
              </div>
            </Show>
            <Show when={ui.state.mode === "live"}>
              <div class="puff-preview-banner">
                <div>
                  <strong>{language.t("puff.live")}</strong>
                  <p>{language.t("puff.fixtureNotice")}</p>
                </div>
              </div>
            </Show>
            <Show when={ui.state.connectionOpen}>
              <form
                class="puff-card puff-connection puff-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  void ui.connect()
                }}
              >
                <h2>{language.t("puff.connectionTitle")}</h2>
                <p>{language.t("puff.connectionHint")}</p>
                <Show when={import.meta.env.DEV}>
                  <label>
                    {language.t("puff.connectionKind")}
                    <select
                      value={ui.state.connectionKind}
                      onChange={(e) =>
                        ui.setState("connectionKind", e.currentTarget.value as "coordination" | "fixture")
                      }
                    >
                      <option value="coordination">{language.t("puff.coordinationService")}</option>
                      <option value="fixture">{language.t("puff.developmentFixture")}</option>
                    </select>
                  </label>
                </Show>
                <div class="puff-connection-fields">
                  <label>
                    {language.t("puff.hubUrl")}
                    <input
                      type="url"
                      value={ui.state.hubUrl}
                      onInput={(e) => ui.setState("hubUrl", e.currentTarget.value)}
                      required
                    />
                  </label>
                  <Show
                    when={ui.state.connectionKind === "fixture"}
                    fallback={
                      <label>
                        {language.t("puff.username")}
                        <input
                          autocomplete="username"
                          value={ui.state.username}
                          onInput={(e) => ui.setState("username", e.currentTarget.value)}
                          required
                        />
                      </label>
                    }
                  >
                    <label>
                      {language.t("puff.projectId")}
                      <input
                        value={ui.state.projectId}
                        onInput={(e) => ui.setState("projectId", e.currentTarget.value)}
                        required
                      />
                    </label>
                  </Show>
                  <label>
                    {language.t(ui.state.connectionKind === "coordination" ? "puff.password" : "puff.memberToken")}
                    <input
                      type="password"
                      autocomplete="off"
                      value={ui.state.token}
                      onInput={(e) => ui.setState("token", e.currentTarget.value)}
                      required
                    />
                  </label>
                </div>
                <div class="puff-actions">
                  <Button variant="primary" type="submit" disabled={ui.state.connecting}>
                    {language.t(ui.state.connecting ? "puff.connecting" : "puff.connect")}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={ui.state.connecting}
                    onClick={() => ui.setState({ connectionOpen: false, token: "" })}
                  >
                    {language.t("puff.cancel")}
                  </Button>
                </div>
              </form>
            </Show>
            <Show when={ui.state.error}>
              <div role="alert" class="puff-alert">
                <div>
                  <strong>{language.t(`puff.${ui.state.error || "request"}`)}</strong>
                  <Show when={ui.state.mode === "live"}>
                    <p>{language.t("puff.cached")}</p>
                  </Show>
                </div>
                <Show when={ui.state.mode === "live"}>
                  <Button onClick={() => void ui.refresh()}>{language.t("puff.refresh")}</Button>
                </Show>
              </div>
            </Show>
            <Show when={ui.state.notice}>
              <p role="status" class="puff-notice">
                {language.t(`puff.${ui.state.notice || "saved"}`)}
              </p>
            </Show>
            <Show when={ui.state.mode === "live" && !ui.state.snapshot.viewerId}>
              <p class="puff-notice">{language.t("puff.identityMissing")}</p>
            </Show>
            <div class="puff-stats">
              <div>
                <strong>{ui.state.snapshot.sessions.length}</strong>
                <span>{language.t("puff.sessions")}</span>
              </div>
              <div>
                <strong>{ui.state.snapshot.awarenessNotes.length}</strong>
                <span>{language.t("puff.findings")}</span>
              </div>
              <div>
                <strong>{reviews()}</strong>
                <span>{language.t("puff.reviewCount")}</span>
              </div>
              <span class="puff-boundary">{language.t("puff.boundary")}</span>
            </div>
            <Show when={ui.state.job}>
              {(job) => (
                <div class="puff-job" role="status">
                  <span class="puff-status" data-state={job().status}>
                    {language.t(
                      ui.state.jobUnresolved
                        ? "puff.contextUnresolved"
                        : job().status === "pending"
                          ? "puff.contextPending"
                          : job().status === "completed"
                            ? "puff.contextDone"
                            : "puff.contextFailed",
                    )}
                  </span>
                  <Show when={job().runId}>
                    <code>{job().runId}</code>
                  </Show>
                  <For each={job().warnings ?? []}>{(warning) => <p>{warning}</p>}</For>
                </div>
              )}
            </Show>
            <div class="puff-workspace">
              <section class="puff-sessions" aria-label={language.t("puff.sessions")}>
                <Show
                  when={views().length}
                  fallback={<div class="puff-card puff-empty">{language.t("puff.noSessions")}</div>}
                >
                  <For each={views().map((view) => sessionKey(view.session))}>
                    {(key, index) => (
                      <Show when={views().find((v) => sessionKey(v.session) === key)}>
                        {(view) => (
                          <SessionCard
                            view={view()}
                            snapshot={ui.state.snapshot}
                            index={index()}
                            writable={ui.writable()}
                            busy={ui.busy()}
                            checking={ui.state.job?.status === "pending"}
                            href={href(view().session)}
                            onCheck={(session) => void ui.check(session, language.t("puff.contextQuestion"))}
                            onSharing={(session, input) => void ui.sharing(session, input)}
                          />
                        )}
                      </Show>
                    )}
                  </For>
                </Show>
              </section>
              <section class="puff-feed">
                <div class="puff-section-heading">
                  <span class="puff-flower" aria-hidden="true">
                    ✳
                  </span>
                  <div>
                    <h2>{language.t("puff.activityTitle")}</h2>
                    <p>{language.t("puff.activitySubtitle")}</p>
                  </div>
                </div>
                <Show
                  when={ui.state.snapshot.awarenessNotes.length}
                  fallback={<p class="puff-card puff-empty">{language.t("puff.noNotes")}</p>}
                >
                  <For each={ui.state.snapshot.awarenessNotes.map((n) => n.noteId)}>
                    {(id) => (
                      <Show when={ui.state.snapshot.awarenessNotes.find((n) => n.noteId === id)}>
                        {(note) => (
                          <article class="puff-card puff-note">
                            <div class="puff-note-route">
                              <span>{title(note().sourceWorkerId, note().sourceSessionId)}</span>
                              <span aria-hidden="true">→</span>
                              <span>{title(note().targetWorkerId, note().targetSessionId)}</span>
                            </div>
                            <p class="puff-note-text puff-prewrap">{note().text}</p>
                            <span class="puff-status" data-state={noteState(note())}>
                              {language.t(`puff.${noteState(note())}`)}
                            </span>
                            <Show when={noteState(note()) === "delivered"}>
                              <p class="puff-caption">{language.t("puff.useUnverified")}</p>
                            </Show>
                            <Evidence refs={note().evidenceRefs} snapshot={ui.state.snapshot} />
                            <div class="puff-meta">
                              <span>{language.t("puff.flowerRun")}</span>
                              <code>{note().runId ?? language.t("puff.noRun")}</code>
                            </div>
                          </article>
                        )}
                      </Show>
                    )}
                  </For>
                </Show>
              </section>
            </div>
            <div class="puff-bottom">
              <section class="puff-reviews">
                <div class="puff-section-heading">
                  <div>
                    <h2>{language.t("puff.reviewTitle")}</h2>
                    <p>{language.t("puff.reviewSubtitle")}</p>
                  </div>
                </div>
                <Show
                  when={ui.state.snapshot.proposals.length}
                  fallback={<p class="puff-card puff-empty">{language.t("puff.noProposals")}</p>}
                >
                  <For each={ui.state.snapshot.proposals.map((p) => p.proposalId)}>
                    {(id) => (
                      <Show when={ui.state.snapshot.proposals.find((p) => p.proposalId === id)}>
                        {(proposal) => (
                          <ProposalCard
                            proposal={proposal()}
                            snapshot={ui.state.snapshot}
                            writable={ui.writable()}
                            busy={ui.busy()}
                            onReview={(p, decision, text) => void ui.review(p, decision, text)}
                            onAccept={(p) => void ui.accept(p)}
                          />
                        )}
                      </Show>
                    )}
                  </For>
                </Show>
              </section>
              <DecisionList snapshot={ui.state.snapshot} />
            </div>
          </div>
        </main>
      )}
    </Show>
  )
}
