import { For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import type { EvidenceRef, ProjectSnapshot } from "@/pages/puff/project-api"
import { evidenceText } from "@/pages/puff/project-state"

export function Evidence(props: { refs: EvidenceRef[]; snapshot: ProjectSnapshot }) {
  const language = useLanguage()
  return (
    <details class="puff-evidence">
      <summary>{language.t("puff.evidence", { count: props.refs.length })}</summary>
      <div class="puff-evidence-list">
        <For each={props.refs}>
          {(ref) => {
            const event = () =>
              props.snapshot.events.find(
                (e) =>
                  e.eventId === ref.eventId &&
                  e.workerId === ref.workerId &&
                  e.sessionId === ref.sessionId &&
                  e.revision === ref.revision,
              )
            return (
              <div class="puff-evidence-item">
                <strong>
                  {props.snapshot.sessions.find((s) => s.workerId === ref.workerId && s.sessionId === ref.sessionId)
                    ?.title ?? ref.sessionId}
                </strong>
                <code>
                  {ref.workerId} / {ref.sessionId} · {language.t("puff.revision", { revision: ref.revision })}
                </code>
                <code>{ref.eventId}</code>
                <Show when={event()} fallback={<p>{language.t("puff.evidenceMissing")}</p>}>
                  {(item) => <p class="puff-prewrap">{evidenceText(item().content)}</p>}
                </Show>
              </div>
            )
          }}
        </For>
      </div>
    </details>
  )
}
