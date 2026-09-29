import { For, Show } from "solid-js"
import type { Coordination } from "@opencode-ai/schema/coordination"
import type { ProjectOverview, RelatedWork } from "./overview-model"
import "./overview-view.css"

export type OverviewCopyKey =
  | "title" | "people" | "statedFocus" | "agentReport" | "projectWork" | "privateWork"
  | "privateNotice" | "reportedResults" | "inspectSource" | "relatedWork" | "reportedCompletion"
  | "noSummary" | "noFocus" | "details" | "blocker" | "workDone" | "executionUnknown"
  | "current" | "stale" | "possibleOverlap" | "deliberateAlternative" | "inspect"
  | "continue" | "reuse" | "separate" | "unavailable" | "noResults" | "noAttention"
  | "noSessions" | "noPrivateSessions" | "toolPermission" | "needsAttention" | "updatedAt"
  | "workQueued" | "workActive" | "workBlocked" | "workIdle" | "executionQueued"
  | "executionRunning" | "executionWaiting" | "executionCompleted" | "executionFailed"
  | "executionRecovery" | "executionReserved" | "executionCancelling" | "executionCancelled"
  | "sourceLabel" | "ownerLabel" | "startedByLabel" | "noOwnedSessions"
  | "noCurrentReport" | "lastReported" | "openSession" | "openSessionLabel"
  | "connectTitle" | "connectHint" | "connectAction" | "noProject" | "loadError" | "loading"

export type PrivateSession = { id: string; title: string; updatedAt: string; href: string }
export type SourceRef = Coordination.WorkCard["evidenceRefs"][number]

export function ProjectOverviewView(props: {
  view: ProjectOverview
  privateSessions: readonly PrivateSession[]
  related: readonly RelatedWork[]
  t: (key: OverviewCopyKey, values?: Record<string, string | number>) => string
  onInspect: (ref: SourceRef) => void
  onOpenShared: (threadId: string) => void
  onOpenPrivate?: (session: PrivateSession) => void
  onContinue?: (threadId: string) => void
  onReuse?: (threadId: string) => void
  onSeparate?: (threadId: string) => void
  actorLabel?: (id: string) => string
}) {
  const execution = (state: Coordination.RunState | "unknown"): OverviewCopyKey => ({
    queued: "executionQueued", reserved: "executionReserved", running: "executionRunning",
    waiting_approval: "executionWaiting", cancelling: "executionCancelling",
    recovery_required: "executionRecovery", completed: "executionCompleted",
    failed: "executionFailed", cancelled: "executionCancelled", unknown: "executionUnknown",
  } as const)[state]
  const work = (status: Coordination.WorkCard["status"]): OverviewCopyKey => ({
    queued: "workQueued", active: "workActive", blocked: "workBlocked", idle: "workIdle", done: "workDone",
  } as const)[status]
  const source = (ref: SourceRef) => (
    <button
      type="button"
      class="puff-overview-source"
      aria-label={props.t("sourceLabel", { eventId: ref.eventId })}
      onClick={() => props.onInspect(ref)}
    >
      <span aria-hidden="true">↗</span>{props.t("inspectSource")} <code>{ref.eventId}</code>
    </button>
  )

  return (
    <main class="puff-overview" aria-labelledby="puff-overview-title">
      <header class="puff-overview-hero">
        <div>
          <span class="puff-overview-kicker">{props.view.project.name}</span>
          <h1 id="puff-overview-title">{props.t("title")}</h1>
        </div>
        <div class="puff-overview-totals" aria-label={props.t("projectWork")}>
          <div><strong>{props.view.people.length}</strong><span>{props.t("people")}</span></div>
          <div><strong>{props.view.sessions.length}</strong><span>{props.t("projectWork")}</span></div>
          <div><strong>{props.view.attention.length}</strong><span>{props.t("needsAttention")}</span></div>
        </div>
      </header>

      <div class="puff-overview-grid">
        <div class="puff-overview-primary">
          <section class="puff-overview-section" aria-labelledby="puff-overview-people">
            <div class="puff-overview-section-head"><h2 id="puff-overview-people">{props.t("people")}</h2></div>
            <div class="puff-overview-people">
              <For each={props.view.people}>
                {(person) => (
                  <article class="puff-overview-person">
                    <header><span class="puff-overview-avatar" aria-hidden="true">{person.userId.replace(/^usr_/, "").slice(0, 2).toUpperCase()}</span><h3>{props.actorLabel?.(person.userId) ?? person.userId}</h3></header>
                    <div class="puff-overview-focus">
                      <span class="puff-overview-label">{props.t("statedFocus")}</span>
                      <p>{person.statedFocus?.text ?? props.t("noFocus")}</p>
                      <Show when={person.statedFocus}><time dateTime={person.statedFocus!.statedAt}>{new Date(person.statedFocus!.statedAt).toLocaleString()}</time></Show>
                    </div>
                    <div class="puff-overview-agent-list">
                      <span class="puff-overview-label">{props.t("agentReport")}</span>
                      <Show when={person.agentReports.length} fallback={<p class="puff-overview-muted">{props.t("noOwnedSessions")}</p>}>
                        <For each={person.agentReports}>
                          {(session) => (
                            <p>
                              <span class="puff-overview-status-dot" data-state={session.execution} />
                              {session.freshness === "current" ? session.card?.currentTask : props.t("noCurrentReport")}
                              <small>{props.t(session.freshness === "stale" ? "stale" : execution(session.execution))}</small>
                            </p>
                          )}
                        </For>
                      </Show>
                    </div>
                  </article>
                )}
              </For>
            </div>
          </section>

          <section class="puff-overview-section" aria-labelledby="puff-overview-work">
            <div class="puff-overview-section-head"><h2 id="puff-overview-work">{props.t("projectWork")}</h2></div>
            <Show when={props.view.sessions.length} fallback={<p class="puff-overview-muted">{props.t("noSessions")}</p>}>
              <div class="puff-overview-work-list">
                <For each={props.view.sessions}>
                  {(session) => (
                    <article class="puff-overview-work-card">
                      <div class="puff-overview-work-summary">
                        <div><h3>{session.thread.title}</h3><p>{session.freshness === "current" ? session.card?.currentTask : props.t("noCurrentReport")}</p></div>
                        <span class="puff-overview-pill">{session.freshness === "stale" ? props.t("stale") : session.card ? props.t(work(session.card.status)) : props.t("noSummary")}</span>
                      </div>
                      <div class="puff-overview-meta">
                        <span>{session.ownerId ? props.t("ownerLabel", { owner: props.actorLabel?.(session.ownerId) ?? session.ownerId }) : props.t("startedByLabel", { creator: props.actorLabel?.(session.thread.createdBy) ?? session.thread.createdBy })}</span>
                        <span>{props.t(execution(session.execution))}</span>
                        <span>{props.t(session.freshness === "current" ? "current" : session.freshness === "stale" ? "stale" : "noSummary")}</span>
                        <time dateTime={session.card?.updatedAt ?? session.thread.createdAt}>{new Date(session.card?.updatedAt ?? session.thread.createdAt).toLocaleString()}</time>
                      </div>
                      <button
                        type="button"
                        class="puff-overview-open"
                        aria-label={props.t("openSessionLabel", { title: session.thread.title })}
                        onClick={() => props.onOpenShared(session.thread.id)}
                      >{props.t("openSession")} <span aria-hidden="true">↗</span></button>
                      <details class="puff-overview-detail">
                        <summary>{props.t("details")}</summary>
                        <Show when={session.card}>
                          {(card) => (
                            <div>
                              <Show when={session.freshness !== "current"}><span class="puff-overview-label">{props.t("lastReported")}</span><p>{card().currentTask}</p></Show>
                              <p>{card().progress}</p>
                              <For each={card().blockers}>{(blocker) => <p><strong>{props.t("blocker")}</strong> {blocker}</p>}</For>
                              <For each={card().evidenceRefs}>{source}</For>
                            </div>
                          )}
                        </Show>
                      </details>
                    </article>
                  )}
                </For>
              </div>
            </Show>
          </section>

          <Show when={props.related.length}>
            <section class="puff-overview-section" aria-labelledby="puff-overview-related">
              <div class="puff-overview-section-head"><h2 id="puff-overview-related">{props.t("relatedWork")}</h2></div>
              <For each={props.related}>
                {(item) => (
                  <article class="puff-overview-related">
                    <div><h3>{item.thread.title}</h3><p>{props.t(item.kind === "deliberate-alternative" ? "deliberateAlternative" : item.kind === "reported-completion" ? "reportedCompletion" : "possibleOverlap")}</p></div>
                    <div class="puff-overview-actions">
                      <Show when={item.card?.evidenceRefs[0]}>{(ref) => source(ref())}</Show>
                      <button type="button" disabled={!props.onContinue} onClick={() => props.onContinue?.(item.thread.id)}>{props.t("continue")}</button>
                      <button type="button" disabled={!props.onReuse || item.kind !== "reported-completion"} onClick={() => props.onReuse?.(item.thread.id)}>{props.t("reuse")}</button>
                      <button type="button" disabled={!props.onSeparate} onClick={() => props.onSeparate?.(item.thread.id)}>{props.t("separate")}</button>
                    </div>
                    <Show when={!props.onContinue && !props.onReuse && !props.onSeparate}><p class="puff-overview-muted">{props.t("unavailable")}</p></Show>
                  </article>
                )}
              </For>
            </section>
          </Show>
        </div>

        <div class="puff-overview-secondary">
          <section class="puff-overview-section" aria-labelledby="puff-overview-attention">
            <div class="puff-overview-section-head"><h2 id="puff-overview-attention">{props.t("needsAttention")}</h2></div>
            <Show when={props.view.attention.length} fallback={<p class="puff-overview-muted">{props.t("noAttention")}</p>}>
              <For each={props.view.attention}>
                {(item) => <p class="puff-overview-attention"><span>{props.t("toolPermission")}</span><code>{item.threadId}</code></p>}
              </For>
            </Show>
          </section>

          <section class="puff-overview-section" aria-labelledby="puff-overview-results">
            <div class="puff-overview-section-head"><h2 id="puff-overview-results">{props.t("reportedResults")}</h2></div>
            <Show when={props.view.reportedResults.length} fallback={<p class="puff-overview-muted">{props.t("noResults")}</p>}>
              <For each={props.view.reportedResults}>
                {(result) => <div class="puff-overview-result"><p>{result.text}</p><For each={result.refs}>{source}</For></div>}
              </For>
            </Show>
          </section>

          <section class="puff-overview-section puff-overview-private" aria-labelledby="puff-overview-private">
            <div class="puff-overview-section-head"><h2 id="puff-overview-private">{props.t("privateWork")}</h2></div>
            <p class="puff-overview-muted">{props.t("privateNotice")}</p>
            <Show when={props.privateSessions.length} fallback={<p class="puff-overview-muted">{props.t("noPrivateSessions")}</p>}>
              <For each={props.privateSessions}>
                {(session) => <button type="button" class="puff-overview-private-session" disabled={!props.onOpenPrivate} onClick={() => props.onOpenPrivate?.(session)}><span>{session.title}</span><time dateTime={session.updatedAt}>{new Date(session.updatedAt).toLocaleString()}</time></button>}
              </For>
            </Show>
          </section>
        </div>
      </div>
    </main>
  )
}
