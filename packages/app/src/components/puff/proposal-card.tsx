import { createMemo, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { useLanguage } from "@/context/language"
import type { ProjectSnapshot, Proposal } from "@/pages/puff/project-api"
import { deliveryState, evidenceStale } from "@/pages/puff/project-state"
import { Evidence } from "./evidence"

export function ProposalCard(props: {
  proposal: Proposal
  snapshot: ProjectSnapshot
  writable: boolean
  busy: boolean
  onReview: (proposal: Proposal, decision: "approve" | "reject", text: string) => void
  onAccept: (proposal: Proposal) => void
}) {
  const language = useLanguage()
  // Pin text and version together; polling must never silently rebind a person's edit.
  const [draft, setDraft] = createStore({
    text: props.proposal.text,
    version: props.proposal.version,
    original: props.proposal.text,
    editing: false,
  })
  const changed = () => draft.version !== props.proposal.version || draft.original !== props.proposal.text
  const stale = () => props.proposal.state === "stale" || evidenceStale(props.snapshot, props.proposal.evidenceRefs)
  const owner = () =>
    props.snapshot.viewerId &&
    props.snapshot.workers.some(
      (w) => w.workerId === props.proposal.targetWorkerId && w.ownerId === props.snapshot.viewerId,
    )
  const status = createMemo(() => {
    if (stale()) return "stale"
    if (["approved", "delivered"].includes(props.proposal.state))
      return deliveryState(props.snapshot.deliveries, {
        sourceKind: "approvedProposal",
        sourceId: props.proposal.proposalId,
        targetWorkerId: props.proposal.targetWorkerId,
        targetSessionId: props.proposal.targetSessionId,
      })
    return props.proposal.state
  })
  const enabled = () =>
    props.writable &&
    !props.busy &&
    !!owner() &&
    !stale() &&
    !changed() &&
    props.proposal.state === "proposed" &&
    !!draft.text.trim()
  return (
    <article class="puff-card puff-proposal">
      <div class="puff-row puff-wrap">
        <span class="puff-kicker">{language.t(`puff.${props.proposal.kind}`)}</span>
        <span class="puff-status" data-state={status()}>
          {language.t(`puff.${status()}`)}
        </span>
        <span class="puff-caption">{language.t("puff.version", { version: props.proposal.version })}</span>
      </div>
      <h3>
        {language.t("puff.target", {
          session:
            props.snapshot.sessions.find(
              (s) => s.workerId === props.proposal.targetWorkerId && s.sessionId === props.proposal.targetSessionId,
            )?.title ?? props.proposal.targetSessionId,
        })}
      </h3>
      <p class="puff-caption">{language.t("puff.untrusted")}</p>
      <Show when={draft.editing} fallback={<p class="puff-instruction puff-prewrap">{draft.text}</p>}>
        <label class="puff-label">
          {language.t("puff.instruction")}
          <textarea
            rows={4}
            value={draft.text}
            onInput={(e) => setDraft("text", e.currentTarget.value)}
            maxLength={8000}
          />
        </label>
      </Show>
      <div>
        <h4>{language.t("puff.rationale")}</h4>
        <p>{props.proposal.rationale}</p>
      </div>
      <Evidence refs={props.proposal.evidenceRefs} snapshot={props.snapshot} />
      <Show when={changed()}>
        <p class="puff-notice">{language.t("puff.staleEdit")}</p>
        <Button
          onClick={() =>
            setDraft({
              text: props.proposal.text,
              version: props.proposal.version,
              original: props.proposal.text,
              editing: false,
            })
          }
        >
          {language.t("puff.loadCurrent")}
        </Button>
      </Show>
      <Show when={!owner()}>
        <p class="puff-caption">{language.t("puff.ownerOnly")}</p>
      </Show>
      <Show when={props.proposal.state === "proposed"}>
        <div class="puff-actions">
          <Button
            variant="primary"
            disabled={!enabled()}
            onClick={() => props.onReview({ ...props.proposal, version: draft.version }, "approve", draft.text)}
          >
            {language.t("puff.approve")}
          </Button>
          <Button disabled={!enabled()} onClick={() => setDraft("editing", !draft.editing)}>
            {language.t("puff.edit")}
          </Button>
          <Button
            variant="ghost"
            disabled={!enabled()}
            onClick={() => props.onReview({ ...props.proposal, version: draft.version }, "reject", draft.text)}
          >
            {language.t("puff.reject")}
          </Button>
        </div>
      </Show>
      <Button
        variant="ghost"
        disabled={
          !props.writable ||
          props.busy ||
          !draft.text.trim() ||
          stale() ||
          changed() ||
          !props.snapshot.viewerId ||
          props.snapshot.decisions.some((d) => d.text === draft.text && d.state === "accepted")
        }
        onClick={() => props.onAccept({ ...props.proposal, text: draft.text })}
      >
        {language.t("puff.acceptDecision")}
      </Button>
    </article>
  )
}
