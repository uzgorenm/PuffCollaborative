import { For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { useLanguage } from "@/context/language"
import type { ProjectSnapshot, SharedSession, SharingInput } from "@/pages/puff/project-api"
import { sessionViews } from "@/pages/puff/project-state"
import { Evidence } from "./evidence"

export function SessionCard(props: {
  view: ReturnType<typeof sessionViews>[number]
  snapshot: ProjectSnapshot
  index: number
  writable: boolean
  busy: boolean
  checking: boolean
  href?: string
  onCheck: (session: SharedSession) => void
  onSharing: (session: SharedSession, input: SharingInput) => void
}) {
  const language = useLanguage()
  const session = () => props.view.session
  const [form, setForm] = createStore({
    open: false,
    topic: "",
    relationship: "unspecified" as SharedSession["relationship"],
    muted: false,
  })
  const owner = () => !!props.snapshot.viewerId && props.snapshot.viewerId === props.view.worker?.ownerId
  const save = (shared: boolean) =>
    props.onSharing(session(), {
      projectId: props.snapshot.projectId,
      workerId: session().workerId,
      shared,
      featureTopic: form.topic.trim(),
      relationship: form.relationship,
      awarenessMuted: form.muted,
    })
  return (
    <article class="puff-card puff-session" data-lane={props.index % 2}>
      <div class="puff-row">
        <span class="puff-avatar">{session().ownerId.slice(0, 2).toUpperCase()}</span>
        <div class="puff-grow">
          <strong>{session().ownerId}</strong>
          <span class="puff-caption">{language.t("puff.owner")}</span>
        </div>
        <span class="puff-status" data-state={props.view.online ? "online" : "offline"}>
          {language.t(props.view.online ? "puff.online" : "puff.offline")}
        </span>
      </div>
      <div class="puff-session-title">
        <span class="puff-kicker">{language.t(`puff.${session().relationship}`)}</span>
        <h2>{session().title}</h2>
        <p>{props.view.summary?.approach ?? language.t("puff.noSummary")}</p>
      </div>
      <div class="puff-row puff-wrap">
        <span class="puff-chip">{session().featureTopic}</span>
        <span class="puff-status" data-state={props.view.summary?.workState ?? "unknown"}>
          {language.t(`puff.${props.view.summary?.workState ?? "unknown"}`)}
        </span>
        <Show when={session().awarenessMuted}>
          <span class="puff-chip">{language.t("puff.muted")}</span>
        </Show>
      </div>
      <Show when={props.view.summary}>
        {(summary) => (
          <>
            <div class="puff-session-progress">
              <h3>{language.t("puff.progress")}</h3>
              <p>{summary().progress}</p>
            </div>
            <Show when={props.view.stale}>
              <p class="puff-notice">{language.t("puff.staleSummary")}</p>
            </Show>
            <Show when={summary().blockers.length}>
              <div class="puff-blocker">
                <h3>{language.t("puff.blocker")}</h3>
                <For each={summary().blockers}>{(blocker) => <p>{blocker}</p>}</For>
              </div>
            </Show>
            <Evidence refs={summary().evidenceRefs} snapshot={props.snapshot} />
            <div class="puff-meta">
              <span>{language.t("puff.flowerRun")}</span>
              <code>{summary().runId}</code>
            </div>
          </>
        )}
      </Show>
      <details class="puff-metadata">
        <summary>{language.t("puff.session")}</summary>
        <dl>
          <dt>{language.t("puff.worker")}</dt>
          <dd>{session().workerId}</dd>
          <dt>{language.t("puff.session")}</dt>
          <dd>{session().sessionId}</dd>
          <dt>{language.t("puff.lastSeen")}</dt>
          <dd>{props.view.worker?.lastSeenAt}</dd>
        </dl>
      </details>
      <div class="puff-session-actions">
        <Button
          onClick={() => props.onCheck(session())}
          disabled={!props.writable || props.busy || props.checking || !props.view.online}
        >
          {language.t("puff.checkContext")}
        </Button>
        <Show when={props.href} fallback={<span class="puff-caption">{language.t("puff.routeMissing")}</span>}>
          {(href) => (
            <a class="puff-link" href={href()}>
              {language.t("puff.openSession")} ↗
            </a>
          )}
        </Show>
      </div>
      <Show when={owner()}>
        <Button
          variant="ghost"
          onClick={() =>
            setForm({
              open: !form.open,
              topic: session().featureTopic,
              relationship: session().relationship,
              muted: !!session().awarenessMuted,
            })
          }
        >
          {language.t("puff.sharing")}
        </Button>
      </Show>
      <Show when={form.open}>
        <form
          class="puff-form"
          onSubmit={(e) => {
            e.preventDefault()
            save(true)
          }}
        >
          <label>
            {language.t("puff.topic")}
            <input
              value={form.topic}
              onInput={(e) => setForm("topic", e.currentTarget.value)}
              required
              maxLength={160}
            />
          </label>
          <label>
            {language.t("puff.relationship")}
            <select
              value={form.relationship}
              onChange={(e) => setForm("relationship", e.currentTarget.value as SharedSession["relationship"])}
            >
              <option value="alternative">{language.t("puff.alternative")}</option>
              <option value="unspecified">{language.t("puff.unspecified")}</option>
            </select>
          </label>
          <label class="puff-checkbox">
            <input type="checkbox" checked={form.muted} onChange={(e) => setForm("muted", e.currentTarget.checked)} />
            {language.t("puff.mute")}
          </label>
          <p class="puff-caption">{language.t("puff.sharingHint")}</p>
          <Button type="submit" disabled={!props.writable || props.busy || !form.topic.trim()}>
            {language.t("puff.saveSharing")}
          </Button>
          <Button variant="ghost" onClick={() => save(false)} disabled={!props.writable || props.busy}>
            {language.t("puff.unshare")}
          </Button>
        </form>
      </Show>
    </article>
  )
}
