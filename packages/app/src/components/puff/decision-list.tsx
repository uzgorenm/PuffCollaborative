import { For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import type { ProjectSnapshot } from "@/pages/puff/project-api"
import { Evidence } from "./evidence"

export function DecisionList(props: { snapshot: ProjectSnapshot }) {
  const language = useLanguage()
  const decisions = () => props.snapshot.decisions.filter((d) => d.state === "accepted")
  return (
    <section class="puff-card puff-memory">
      <span class="puff-kicker">{language.t("puff.decisionTitle")}</span>
      <h2>{language.t("puff.decisionSubtitle")}</h2>
      <Show when={decisions().length} fallback={<p class="puff-empty">{language.t("puff.noDecisions")}</p>}>
        <For each={decisions()}>
          {(decision) => (
            <article class="puff-decision">
              <p class="puff-prewrap">{decision.text}</p>
              <span class="puff-caption">{language.t("puff.acceptedBy", { name: decision.approvedBy })}</span>
              <time class="puff-caption">{decision.approvedAt}</time>
              <Evidence refs={decision.evidenceRefs} snapshot={props.snapshot} />
            </article>
          )}
        </For>
      </Show>
    </section>
  )
}
