import { For, Show, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useTeam } from "../team-context"
import { teamEventText } from "../team-state"
import type { SimulationManifest } from "./simulation-contract"
import type { SourceRef } from "./overview-view"
import { hasCurrentCompletedEvidence, matchesCompletedTask } from "./demo-task-match"
import "./demo-task-start.css"

type TaskStart = NonNullable<SimulationManifest["taskStart"]>

export function DemoTaskStart(props: {
  start: TaskStart
  onInspect: (ref: SourceRef) => void
  onContinue: (threadId: string) => void
  onClose: () => void
}) {
  const team = useTeam()
  const language = useLanguage()
  const [state, set] = createStore({
    text: "",
    status: "idle" as "idle" | "checking" | "match" | "clear" | "unavailable" | "separate" | "selected",
    selectedTaskId: "",
    sourceText: "",
  })
  const reporter = createMemo(() => team.state.simulation?.actors.find((actor) => actor.userId === props.start.completed.reportedBy)?.displayName ??
    language.t("puff.simulation.unknownActor"))
  const completedTitle = createMemo(() => team.state.overview?.threads.find((thread) => thread.id === props.start.completed.threadId)?.title ?? props.start.completed.task)
  let read: AbortController | undefined
  let check = 0
  onCleanup(() => read?.abort())
  const updateText = (text: string) => {
    check++
    read?.abort()
    set({ text, status: "idle", selectedTaskId: "", sourceText: "" })
  }
  const submit = async () => {
    const text = state.text
    if (!text.trim()) return
    const ticket = ++check
    read?.abort()
    if (!matchesCompletedTask(text, props.start)) {
      set({ status: "clear", sourceText: "" })
      return
    }
    set({ status: "checking", sourceText: "" })
    await team.refreshOverview()
    if (ticket !== check) return
    if (!hasCurrentCompletedEvidence(props.start, team.state.overview)) {
      set("status", "unavailable")
      return
    }
    read = new AbortController()
    try {
      const event = await team.resolveOverviewSource(props.start.completed.sourceRef, read.signal)
      if (ticket !== check) return
      const sourceText = teamEventText(event)
      if (event.actorId !== props.start.completed.reportedBy || event.kind !== "run.output" ||
        !sourceText.startsWith("SIMULATED completed result:")) {
        set("status", "unavailable")
        return
      }
      set({ status: "match", sourceText })
    } catch {
      if (ticket === check) set("status", "unavailable")
    }
  }
  return <section class="puff-demo-task" aria-labelledby="puff-demo-task-title">
    <header>
      <div><span class="puff-demo-task-tag">{language.t("puff.simulation.banner")}</span>
        <h2 id="puff-demo-task-title">{language.t("puff.simulation.taskStart.title")}</h2>
        <p>{language.t("puff.simulation.taskStart.intro")}</p>
      </div>
      <button type="button" onClick={props.onClose}>{language.t("puff.simulation.taskStart.close")}</button>
    </header>
    <Show when={team.state.projectId === props.start.projectId} fallback={
      <div class="puff-demo-task-switch">
        <p>{language.t("puff.simulation.taskStart.switchProject")}</p>
        <button type="button" onClick={() => void team.chooseProject(props.start.projectId)}>{language.t("puff.simulation.taskStart.openProject")}</button>
      </div>
    }>
      <form onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <label for="puff-demo-task-input">{language.t("puff.simulation.taskStart.prompt")}</label>
        <textarea id="puff-demo-task-input" rows={2} value={state.text}
          placeholder={language.t("puff.simulation.taskStart.placeholder")}
          onInput={(event) => updateText(event.currentTarget.value)} />
        <div class="puff-demo-task-form-actions">
          <button type="submit" disabled={!state.text.trim() || state.status === "checking"}>{language.t("puff.simulation.taskStart.check")}</button>
          <button type="button" onClick={() => updateText(props.start.completed.task)}>{language.t("puff.simulation.taskStart.useExample")}</button>
        </div>
      </form>
      <Show when={state.status === "checking"}><p role="status">{language.t("puff.simulation.taskStart.checking")}</p></Show>
      <Show when={state.status === "unavailable"}><p role="status">{language.t("puff.simulation.taskStart.unavailable")}</p></Show>
      <Show when={state.status === "clear"}><p role="status">{language.t("puff.simulation.taskStart.noMatch")}</p></Show>
      <Show when={state.status === "separate"}><p role="status">{language.t("puff.simulation.taskStart.separateSelected")}</p></Show>
      <Show when={state.status === "selected"}><p role="status">{language.t("puff.simulation.taskStart.remainingSelected", {
        task: props.start.remaining.find((item) => item.id === state.selectedTaskId)?.title ?? state.text,
      })}</p></Show>
      <Show when={state.status === "match"}>
        <article class="puff-demo-task-result">
          <span class="puff-demo-task-kicker">{language.t("puff.simulation.taskStart.completedLabel")}</span>
          <h3>{language.t("puff.simulation.taskStart.alreadyDone", { person: reporter() })}</h3>
          <p>{props.start.completed.result}</p>
          <p class="puff-demo-task-source">{language.t("puff.simulation.taskStart.sourceSession", { title: completedTitle() })}</p>
          <details><summary>{language.t("puff.simulation.taskStart.exactSource")}</summary>
            <code>{props.start.completed.sourceRef.eventId}</code>
            <p>{state.sourceText}</p>
          </details>
          <div class="puff-demo-task-choices">
            <button type="button" onClick={() => props.onInspect(props.start.completed.sourceRef)}>{language.t("puff.simulation.taskStart.inspect")}</button>
            <button type="button" onClick={() => props.onContinue(props.start.completed.threadId)}>{language.t("puff.simulation.taskStart.continue")}</button>
            <button type="button" onClick={() => set("status", "separate")}>{language.t("puff.simulation.taskStart.separate")}</button>
          </div>
        </article>
      </Show>
      <Show when={["match", "separate", "selected"].includes(state.status)}>
        <div class="puff-demo-task-remaining">
          <h3>{language.t("puff.simulation.taskStart.remainingTitle")}</h3>
          <p>{language.t("puff.simulation.taskStart.remainingIntro")}</p>
          <div class="puff-demo-task-suggestions">
            <For each={props.start.remaining}>{(item) => <article>
              <h4>{item.title}</h4>
              <p>{item.rationale}</p>
              <div>
                <button type="button" onClick={() => set({ text: item.title, status: "selected", selectedTaskId: item.id })}>{language.t("puff.simulation.taskStart.choose")}</button>
                <button type="button" onClick={() => props.onInspect(item.sourceRef)}>{language.t("puff.simulation.taskStart.inspectBasis")}</button>
              </div>
            </article>}</For>
          </div>
        </div>
      </Show>
    </Show>
  </section>
}
