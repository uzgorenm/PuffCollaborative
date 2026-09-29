# Context panel handoff — September 29, 2026

Owner: Agent 2. Target: `serdar/ui` in `/Users/mac/Desktop/Coding/Hackathon/Puff/PuffCollaborative-serdar-ui`. This is a source and focused-test handoff. The frontend lead owns mounting, shared i18n, host transitions, native QA, Git, and publication.

## Files and contract

- `packages/app/src/components/puff/context-panel/index.tsx` reuses the lead's extracted `ContextPanel` and its existing props: `target`, `snapshot`, `related`, `connected`, `loading`, `error`, `writable`, `busy`, `onCancel`, and `onReject`.
- `model.ts` binds the exact active `threadId` + `workerId` + `sessionId` before returning WorkCard, runs, approvals, or source links. A/B switching, a local session without authoritative worker/thread identity, offline state, refresh failure, and loading all suppress the old panel data.
- `context-panel.css` owns the panel's internal layout and scoped row styles. `team.css` still has now-obsolete panel-internal selectors `.team-context-inner`, `.team-context-section`, `.team-context-empty`, `.team-evidence-link`, `.team-queue-card`, `.team-approval` and their descendant/hover/responsive rules; the lead may remove those blocks. Keep host `.team-context-panel`, `.team-context-closed .team-context-panel`, grid, host animations, and reduced-motion rules in the lead's CSS.
- `model.test.ts` contains synthetic UI fixtures only. They do not represent a real Flower run, OpenCode response, or receipt.

Usage remains `<ContextPanel target={...} snapshot={...} related={...} connected={...} loading={...} error={...} writable={...} busy={...} onCancel={...} onReject={...} />`. The lead's shared-thread and local-chat hosts already supply those props. There is no network request or runner in the component. Tool Allow stays disabled because the API lacks reviewable tool arguments/scope; Reject uses the lead's callback only when writable.

## Honest evidence boundary

The current `Thread` record has no explicit feature topic, selected sharing state, or alternative relationship. `related` is a list of accessible project threads, not proof that they are alternatives, so the panel never labels same-owner threads as alternatives. It shows relationship unspecified. The current WorkCard has task/progress/blockers and optional outcome/source refs, but no cross-session finding or awareness delivery record. The panel shows its outcome only when a same-project source reference is present and the card is current; it marks older source revisions stale and withholds future/wrong-thread cards. Its source link is constructed only from a provided ref to an accessible thread; the UI cannot prove that the target event anchor exists without a source-event lookup.

No current record establishes worker acknowledgment, Session admission, transcript promotion, or subsequent agent use. The panel uses the existing `puff.useUnverified` copy and does not promote a run ID, tool approval, generic acknowledgment, or WorkCard refresh into a use claim. This remains a product integration dependency, not a UI test failure.

All production copy in the current panel uses existing `puff.*` keys. To show the requested states more precisely once the backend supplies them, the lead can add these shared i18n keys: `puff.team.identityUnknown` (exact worker/Session binding unavailable), `puff.team.topicUnknown` (feature topic unavailable), `puff.team.sharingUnknown` (sharing selection unavailable), `puff.team.alternativesUnknown` (explicit alternative relation unavailable), and `puff.team.deliveryUnknown` (acknowledgment, admission, promotion, and observed-use receipts unavailable). This component does not reference missing keys.

## Verification

- `bun test --conditions=solid src/components/puff/context-panel/model.test.ts` from `packages/app`: **7 passed, 0 failed**. Covers exact binding, rapid A/B selection, unknown identity, offline/error, stale/future/wrong-thread cards, source filtering, and absent receipts.
- `bun run typecheck` from `packages/app`: **fails outside this panel directory**. Current diagnostics are in `components/puff/team-shell.tsx` (`serviceUrl`) and `pages/puff/team-state.test.ts` (branded IDs, `serviceUrl`, optional values). There are no diagnostics in `context-panel/` in that run. Agent 1 owns those files.
- `bun run build` from `packages/app`: **exit 0**, 2,599 modules transformed. Vite emitted existing duplicate static/dynamic import and chunk-size warnings; this establishes bundling, not native workflow behavior.
- No native visual interaction or production awareness delivery was claimed by this handoff.
