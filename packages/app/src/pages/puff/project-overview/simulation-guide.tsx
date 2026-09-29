import { For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import type { SimulationManifest } from "./simulation-contract"
import { scenarioForProject } from "./simulation-contract"
import type { SourceRef } from "./overview-view"
import "./simulation-guide.css"

export function SimulationGuide(props: {
  manifest: SimulationManifest
  projectId: string
  busy: boolean
  error: boolean
  operator: boolean
  onSelect: (projectId: string) => void
  onAdvance: () => void
  onReset: () => void
  onInspect: (ref: SourceRef) => void
  onOpenTarget: (threadId: string) => void
}) {
  const language = useLanguage()
  const current = () => scenarioForProject(props.manifest, props.projectId)
  const stage = () => props.manifest.wf02?.stage ?? 0
  const label = (id: SimulationManifest["selectedScenarioId"]) => language.t(`puff.simulation.${id}`)
  return <section class="puff-simulation-guide" aria-labelledby="puff-simulation-guide-title">
    <header>
      <span class="puff-simulation-tag">{language.t("puff.simulation.banner")}</span>
      <div>
        <h2 id="puff-simulation-guide-title">{language.t("puff.simulation.guide")}</h2>
        <p>{language.t("puff.simulation.rail.guideHint")}</p>
      </div>
    </header>
    <nav aria-label={language.t("puff.simulation.guide")}>
      <For each={props.manifest.scenarios}>
        {(scenario) => <button
          type="button"
          aria-current={scenario.projectId === props.projectId ? "page" : undefined}
          disabled={props.busy}
          onClick={() => props.onSelect(scenario.projectId)}
        >{label(scenario.id)}</button>}
      </For>
    </nav>
    <details class="puff-simulation-details">
      <summary>{language.t("puff.simulation.rail.showControls")}</summary>
    <Show when={current()}>
      {(scenario) => <article class="puff-simulation-current">
        <span class="puff-overview-label">{language.t("puff.simulation.current")}</span>
        <h3>{scenario().title}</h3>
        <p>{scenario().summary}</p>
        <Show when={scenario().id === "wf01"}>
          <div class="puff-simulation-explain">
            <strong>{language.t("puff.simulation.alternative")}</strong>
            <p>{language.t("puff.simulation.alternativeDetail")}</p>
            <p>{language.t("puff.simulation.privateExcluded")}</p>
          </div>
        </Show>
        <Show when={scenario().id === "wf02" && props.manifest.wf02}>
          <div class="puff-simulation-explain">
            <p>{language.t("puff.simulation.wf02Explanation")}</p>
            <ol class="puff-simulation-timeline">
              <For each={props.manifest.wf02?.milestones ?? []}>
                {(milestone, index) => <li data-state={index() <= stage() ? "done" : index() === stage() + 1 ? "current" : "pending"}>
                  <strong>{language.t(`puff.simulation.${milestone.phase}`)}</strong>
                  <small>{language.t(index() <= stage() ? "puff.simulation.done" : index() === stage() + 1 ? "puff.simulation.next" : "puff.simulation.pending")}</small>
                  <Show when={milestone.observedAt}><time dateTime={milestone.observedAt!}>{new Date(milestone.observedAt!).toLocaleTimeString()}</time></Show>
                  <Show when={index() <= stage() && milestone.observedAt}>
                    <details><summary>{language.t("puff.simulation.receiptDetails")}</summary><code>{milestone.receiptId}</code></details>
                  </Show>
                </li>}
              </For>
            </ol>
            <div class="puff-simulation-actions">
              <button type="button" onClick={() => props.onInspect(props.manifest.wf02!.sourceRef)}>{language.t("puff.simulation.inspectSource")}</button>
              <button type="button" onClick={() => props.onOpenTarget(props.manifest.wf02!.targetThreadId)}>{language.t("puff.simulation.openTarget")}</button>
              <button type="button" disabled={!props.operator || props.busy || stage() >= 3} onClick={props.onAdvance}>{language.t("puff.simulation.advance")}</button>
            </div>
          </div>
        </Show>
        <Show when={scenario().id === "wf03"}>
          <div class="puff-simulation-comparisons">
            <For each={scenario().comparisons ?? []}>
              {(comparison) => <div>
                <strong>{language.t(comparison.classification === "likely_overlap" ? "puff.simulation.overlap" : "puff.simulation.unrelated")}</strong>
                <p>{comparison.finding ?? language.t("puff.simulation.unrelatedDetail")}</p>
                <small>{language.t(comparison.classification === "likely_overlap" ? "puff.simulation.overlapDetail" : "puff.simulation.noFinding")}</small>
              </div>}
            </For>
          </div>
        </Show>
      </article>}
    </Show>
    <div class="puff-simulation-footer">
      <button type="button" disabled={!props.operator || props.busy} onClick={props.onReset}>{language.t("puff.simulation.reset")}</button>
      <span>{language.t("puff.simulation.resetHint")}</span>
      <Show when={props.error}><p role="alert">{language.t("puff.simulation.actionError")}</p></Show>
    </div>
    </details>
  </section>
}
