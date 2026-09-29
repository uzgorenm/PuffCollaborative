import { createEffect, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { A } from "@solidjs/router"
import { useLanguage } from "@/context/language"
import { useTeam } from "./team-context"
import { fixApplicationState } from "./fix-reuse"
import "./fix-suggestion.css"

export function FixSuggestion() {
  const team = useTeam()
  const language = useLanguage()
  const [view, set] = createStore({ inspect: false })
  const attempt = () => team.state.fixAttempts[team.state.threadId]
  const fix = () => attempt()?.fix ?? team.state.fixProposal
  const person = () => {
    const id = fix()?.actorId ?? ""
    return (
      team.state.simulation?.actors.find((actor) => actor.userId === id)?.displayName ??
      id
        .replace(/^usr_/, "")
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
    )
  }
  createEffect(() => {
    fix()?.source.id
    team.state.threadId
    set("inspect", false)
  })
  const state = () => (attempt()?.runId ? fixApplicationState(attempt()!.runId!, team.state.events) : undefined)
  const targetCheck = () =>
    team.state.events.find(
      (event) =>
        event.runId === attempt()?.runId && event.kind === "run.tool" && typeof event.payload.verification === "object",
    )?.payload.verification
  return (
    <>
      <Show when={team.state.fixLoading && !fix()}>
        <p class="puff-fix-status" role="status">
          {language.t("puff.fix.checking")}
        </p>
      </Show>
      <Show when={team.state.fixError && !fix()}>
        <p class="puff-fix-status" role="status">
          {language.t("puff.fix.failedLookup")}{" "}
          <button type="button" onClick={() => void team.refreshOverview()}>
            {language.t("puff.fix.refresh")}
          </button>
        </p>
      </Show>
      <Show when={fix()}>
        {(value) => (
          <article class="puff-fix" aria-label={language.t("puff.fix.title", { person: person() })}>
            <div class="puff-fix-heading">
              <span aria-hidden="true">✳</span>
              <strong>{language.t("puff.fix.title", { person: person() })}</strong>
            </div>
            <p>{value().summary}</p>
            <Show when={!attempt()}>
              <p>{language.t("puff.fix.question")}</p>
            </Show>
            <Show when={state()}>
              {(status) => (
                <p class="puff-fix-receipt" role="status" data-state={status()}>
                  {language.t(`puff.fix.${status()}`)}
                </p>
              )}
            </Show>
            <Show when={attempt()?.uncertain}>
              <p role="status">{language.t("puff.fix.uncertain")}</p>
            </Show>
            <Show when={team.state.fixError}>
              <p role="alert">{language.t("puff.fix.actionFailed")}</p>
            </Show>
            <div class="puff-fix-actions">
              <button type="button" aria-expanded={view.inspect} onClick={() => set("inspect", !view.inspect)}>
                {language.t("puff.fix.inspect")}
              </button>
              <Show when={!attempt()?.runId}>
                <button
                  type="button"
                  class="puff-fix-primary"
                  disabled={!team.canApplyFix()}
                  onClick={() => void team.applyFix()}
                >
                  {language.t(
                    team.state.action.startsWith("fix:")
                      ? "puff.fix.applying"
                      : attempt()?.uncertain
                        ? "puff.fix.retry"
                        : "puff.fix.apply",
                  )}
                </button>
                <Show when={!attempt()}>
                  <button type="button" disabled={!!team.state.action} onClick={team.dismissFix}>
                    {language.t("puff.fix.decline")}
                  </button>
                </Show>
              </Show>
            </div>
            <Show when={view.inspect}>
              <div class="puff-fix-review">
                <A
                  href={`/puff/thread/${encodeURIComponent(value().source.threadId!)}#event-${encodeURIComponent(value().source.id)}`}
                >
                  {language.t("puff.fix.source")}
                </A>
                <h3>{language.t("puff.fix.patch")}</h3>
                <pre>{value().patch}</pre>
                <h3>{language.t("puff.fix.check")}</h3>
                <code>{value().verification.command}</code>
                <pre>{value().verification.output}</pre>
                <Show when={targetCheck()}>
                  {(check) => {
                    const data = check() as Record<string, unknown>
                    return (
                      <>
                        <h3>{language.t("puff.fix.targetCheck")}</h3>
                        <code>{String(data.command ?? "")}</code>
                        <pre>{String(data.output ?? "")}</pre>
                      </>
                    )
                  }}
                </Show>
              </div>
            </Show>
          </article>
        )}
      </Show>
    </>
  )
}
