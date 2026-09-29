# Next development round

September 29, 2026. Serdar authorized continued development through the existing chats. Start from integrated main `4a19f943a7`; this file records work assignments, not completion claims. Preserve the native-first product, original coding controls, meaningful collaboration and the existing acceptance workflows.

## Workspace and coordination

- **Next implementation checkout:** `/Users/mac/Desktop/Coding/Hackathon/Puff/PuffCollaborative-main-integration`. It is a detached integration checkout on current main; do not switch/reset it. Coordinator is its sole Git writer and main publisher. The frontend lead owns frontend composition but does not stage/commit in this checkout.
- **QA checkout/window:** `/Users/mac/Desktop/Coding/Hackathon/Puff/PuffCollaborative-serdar-ui`, native profile `/tmp/puff-serdar-ui-desktop`, renderer 5175/CDP9223. Freeze source there while QA tests it. Review drafts and the prior R1 consumer test remain preserved there. New implementation agents must not accidentally edit that checkout.
- **Native input:** QA completed its pass and explicitly released CDP9223. The frontend lead committed its polling-focus repair as `65767b5f31` on `serdar/ui` and explicitly released input. No chat currently owns native interaction. The coordinator assigns the next native pass explicitly. All chats use source and isolated tests meanwhile.
- **Backend/runtime/Flower feature delegation:** `Set up Flower development (2)` owns its separately isolated sharing, active-Session and Flower agents. It publishes exact branch/file boundaries and ready commits. It must not write frontend files or this integration checkout, and does not push main independently.
- **Main integration:** `Set up Flower development` reviews finished slices, runs affected checks at the combined source, and commits/pushes normally. Do not stage another agent's unfinished changes. Coordinate a short file freeze before integrated checks; ordinary source/test work stays parallel.
- **Clean publication checkout:** `/Users/mac/Desktop/Coding/Hackathon/Puff/PuffCollaborative-publication`, coordinator-only. It starts from committed integration state and has its own locked dependencies. Advance it only with reviewed ready commits, verify that exact source, then push main normally. This prevents unrelated in-progress frontend files from blocking publication. Preserve the active implementation checkout and never copy its unfinished work wholesale.
- **Follow-up:** the coordinator checks progress every ten minutes through a thread heartbeat, stays quiet on unchanged state, and assigns only meaningful next work within the agreed MVP. Completed work is not restarted merely to keep a chat busy.

### Source-inspection round completed; ownership handoff

The lead/panel/controller/identity/focus slice is committed as `e332cbf539` after independent review, 67 focused tests, 46 browser tests, app/desktop typechecks and app build. See the [coordinator receipt](evidence/2026-09-29-source-inspection.md). These source results do not close native or live-awareness gates.

- Freeze the main-integration UI source for QA. `Summarize current team work` alone may launch and interact with a separate native instance, under the current [desktop access record](desktop-coordination.md).
- The earlier frontend lead has released its files. `Build Puff project overview and coordination` now owns the next host/client/i18n integration in its separate overview checkout, preserving this committed checkpoint after a coordinator fast-forward. The old ownership table below is the completed round's boundary, not permission to resume competing host edits.
- R1 owns its local overview backend handoff. The panel's separate cross-chat action was rejected by automatic approval review, including an indirect handoff workaround; do not retry it or claim a new detail deliverable. Its prior panel implementation is already published. Root handles authorized project coordination.
- Next durable overview target: an authenticated project brief plus self-authored person focus, with explicit new backend file ownership agreed before registration/migration edits. Session intent/share still requires trusted Session ownership; membership alone cannot supply it. Delivery/redirection/use remain separate unimplemented records.

## Current assignments

| Owner | Bounded next result | Exclusive boundary |
| --- | --- | --- |
| Build Puff project overview and coordination | Freeze a tested, mounted overview for Serdar's hands-on preview | App overview modules plus host/client/controller/i18n/route integration in `PuffCollaborative-project-overview`; preserve R1 files |
| Check Puff project overview and coordination | Verify the changed exact-source path and report remaining release blockers | Source/tests review only; no native input or implementation edits |
| Complete R1 collaborative review | Authenticated versioned brief and self-authored focus service and route contract | New core overview files/tests/migration plus narrow schema, core contracts, protocol and `handlers/coordination-data.ts` changes in the overview checkout; final runtime/composition/generated registration stays with backend integration |
| Set up Flower development (2) | Produce one combined, tested backend candidate using main, current Serhat, sharing guard, active-Session adapter and full Flower ancestry | Separate backend candidate checkout; one Git/source writer; no main push or native use |
| Summarize current team work | Finish frozen native pass, then prepare the stable overview preview and hand input to Serdar | Exact instances and conditions in [desktop coordination](desktop-coordination.md); no product/Git edits |
| Root coordinator | Review actual integrated source and publish normal commits to main | Clean publication checkout and resource ownership records |
| Complete Serdar’s R3 review | Reproduce whether unchanged overview polling disconnects the Inspect focus target | New `packages/app/test-browser/puff-overview-focus.test.ts` only; no app edits, native interaction or Git writes during the frozen preview |

The mounted overview was integrated as `6aadf49887` after focused tests, browser regressions, typecheck and build. See the [overview publication receipt](evidence/2026-09-29-project-overview.md). The native preview remains on its original isolated app commit `2a7d8bba76`; do not hot-reload it while Serdar tests.

The accepted brief field `suggestedAwarenessMode` is nonauthoritative starter guidance. It cannot replace an owner-selected, versioned policy for a particular target Session/Thread. Every redirection still needs its exact target owner's approval. Trusted owner binding, selection/export, revocation, admission and observed-use gates remain separate.

The cancelled R6 demo-generator task remains cancelled. R6's later onboarding/approval UX specification is a separate user-authorized artifact, not implemented behavior. Completed R2–R5 reviews remain idle until a relevant change needs their exact expertise.

## Completed round ownership (historical)

All paths are relative to the next implementation checkout unless a separately isolated checkout is explicitly named.

| Role / existing chat | Concrete next result | Exclusive write area |
| --- | --- | --- |
| Frontend lead — Review README for task workflow | Existing authenticated client resolves an exact citation; mount new panel/identity components; own shared copy | `packages/app/src/pages/puff/team-api.ts`, `team-api.test.ts`, `team-thread.tsx`; `packages/app/src/components/puff/team-shell.tsx`, `team.css`; `packages/app/src/i18n/puff-en.ts`; `docs/hackathon/next-ui-handoff.md` |
| Panel — Read the project README | Inline source inspection and honest decision/delivery presentation | `packages/app/src/components/puff/context-panel/`; `docs/hackathon/next-panel-handoff.md` |
| R2 — Review Serdar UI checkpoint | Readable identity for similarly named sessions using real metadata | New `packages/app/src/components/puff/session-identity/`; `docs/hackathon/next-identity-handoff.md` |
| R3 — Complete Serdar’s R3 review | Automated keyboard/focus/reduced-motion regression coverage, rechecking already-fixed findings | New `packages/app/test-browser/puff-focus.test.ts`; `docs/hackathon/reviews/r3-next.md` |
| R4 — Complete Serdar parallel review | Preserve the exact tool-decision retry while delivery is pending/failed | `packages/app/src/pages/puff/team-state.ts`, `team-state.test.ts`; `docs/hackathon/next-reliability-handoff.md` |
| R1 — Complete R1 collaborative review | Meaningful runner events advance card freshness; concurrent exact comment retries reconcile | `packages/core/src/coordination/queue/queue.ts`, `comments/index.ts`; new `packages/core/test/coordination/activity-freshness.test.ts`, `comment-retry.test.ts`; `docs/hackathon/next-backend-quality-handoff.md` |
| R5 — Inspect Serdar UI checkpoint | Independent negative-case review of the sharing authorization repair | `docs/hackathon/reviews/r5-next.md` only; backend author retains implementation |
| R6 — Complete Serdar Puff R6 review | **Not dispatched: user cancelled the next demo-generator message.** Preserve its completed prior review. | No new write assignment; do not retry or reassign the cancelled task without renewed user authorization. |
| Native QA — Summarize current team work | Finish and release the current native acceptance window | Existing QA receipt in the QA checkout; no product edits |
| New user task — Build Puff project overview and coordination | Isolated overview/kickoff components and explicit host/data requirements | New `packages/app/src/pages/puff/project-overview/` and `docs/hackathon/project-overview-handoff.md` only in `PuffCollaborative-project-overview`; no shared host/client/controller/i18n/backend edits yet |

Read applicable AGENTS.md and current source before work. Use existing libraries, components, schemas, theme and i18n. No new framework, new runner, replacement API client or invented delivery contract. Library-specific API work uses Context7. Do not copy old review conclusions without checking whether the latest source fixed them. Each role returns exact changed files, tests, limitations and its ready handoff; ask the coordinator to resolve ownership conflicts instead of editing outside the table.

### Ready backend handoffs awaiting integration

- Sharing authorization: `297af1bcc41c9e490c935b5fb68ef2e84fc1121a` on `codex/sharing-consent`, in `PuffCollaborative-sharing-consent`. R5 reviews this exact commit. New sharing fails closed without a trusted production Session-selection provider; demo provisioning must account for this before integration. Existing authorized reads are separately tested.
- Active-Session admission: `021ed1b46ce49aa6b18510f32e61c37c2766ecea` on `codex/active-session-handoff`, in `PuffCollaborative-active-handoff`. Deterministic tests show one safe-boundary promotion during an active provider stream; this still needs the validated source/consent/worker caller and integration review.
- Flower's fresh hosted synthetic chain completed A/B analysis and coordination in runs `2737239426624509029`, `1193879813426190823`, and `16630437671334715564`. Ready commit `58a1b9861eec655a41c77ba192631ba978159cb2` is in `PuffCollaborative-flower-live`, with receipt `docs/hackathon/evidence/codex-flower-live.md`. This is not evidence of backend delivery, active-Session promotion, or B using the result.
- **Flower integration dependency:** `hackathon/flower/` is absent from current main. The live fix is incremental over Ferit's earlier feature lineage: `51ecb1249e`, `5823cf0626`, merge `7cde6ea734`, `f9a9987dd5`, and `745256d21f`. Review/integrate the complete Ferit feature ancestry before the live fix; do not cherry-pick `58a1b9861e` alone.
- The lead's polling-focus repair and R4's visible-project source binding are included in published `e332cbf539`. R3's regression is included; no additional port or repeated review is needed without a relevant change.
- R1's freshness/comment retry slice passed coordinator verification (17 tests, 177 assertions; core typecheck) and independent R2 review without a release-blocking finding. R2's review is `reviews/backend-quality-review.md`; the adjacent activity feed's omission of `run.output` remains a separate follow-up.
- R2's completed backend review and identity component are published. R5's [Flower delta review](reviews/flower-integration-review.md) independently passed all 43 local tests at `09f95869a8` and permits integrating the complete feature as isolated synthetic Flower work. Use a dedicated trusted state directory; arbitrary/shared state paths remain limited. Trusted export and real target use remain unverified.
- The user's later Project overview expansion is coordinated with `Find active sessions in the UI`: overview owns new modules now and receives shared host ownership only after the current lead's ready handoff; R1's next backend substrate belongs in the overview checkout with explicit new paths. Panel finishes its current slice first. R6's new onboarding assignment is separate from the cancelled demo-generator task. QA alone receives an explicit native-window handoff; the new overview checker stays source/tests. Main publication remains with this coordinator.

## Small shared frontend contract

The following are component/controller boundaries, not new backend wire fields.

1. The lead adds `source(projectId, ref, signal)` to the existing client; R4 exposes the controller's `resolveSource(ref, signal)` wrapper using its existing private authenticated client. The lead passes that optional resolver to the panel. Here `ref` is `{ threadId, eventId, seq }`, the signal is an AbortSignal, and the return is one existing `Coordination.Event`. Resolve through the existing project replay endpoint, requesting after `seq - 1` and limit 1, and verify project/thread/event/sequence equality. Capture the exact connected service/member and reject late results after identity/target changes. The lead publishes the method signature early so R4 can add its wrapper without editing client files. No lookup by similar text, no raw tool payload expansion beyond the permitted event schema, and no new source transport.
2. Panel owns an inline evidence peek: loading, exact verified event, unavailable/no-access and close. B's original conversation remains mounted; no route jump is required. Cancel outstanding reads and remove old evidence on target/service changes. Close/Escape returns focus to Inspect. Existing source links may remain a fallback only when their evidence limitations are explicit.
3. R4 retains an uncertain rejection's original claimed version and decision ID until the service confirms delivery. Expose a narrowly typed retry capability only for an exact remembered same-account attempt. A decided approval with pending/failed delivery remains distinct from a completed delivery. After reload or for another actor's decision without the original attempt, show an unresolved state rather than inventing a new request or reclaiming a decided approval.
4. Panel renders pending/failed decision delivery separately and accepts an optional retry callback/capability supplied through lead-owned hosts. R4 must not edit panel files; panel must not edit controller files. Tool Allow stays disabled until reviewable permission details exist. Do not add work-redirection controls under the guise of tool permission.
5. R2 supplies a small presentational identity component/helper to the lead. Show actual title plus stable Session/worker/owner metadata where available, with full accessible labels for truncated text. Display a run state only from an authoritative supplied record; do not infer alternatives, completion, approach or a winner from title similarity. Keep shared label additions with the lead.

## Acceptance for this round

- **N1 — Exact evidence without losing B:** B has an unsent draft and older reading position. Inspect A's cited event; delayed/mismatched/forbidden responses never display as the citation. Close returns focus and preserves B's draft, position and Session identity. An A→B target switch clears A's pending peek.
- **N2 — Durable decision, uncertain delivery:** decision commits, forwarding fails, then refresh/reconnect. UI retains the decided/pending distinction. Exact retry uses the same request/version without a new claim; wrong account and missing original attempt cannot retry. A confirmed delivered state clears the pending attempt once.
- **N3 — Distinct readable sessions:** two same-owner sessions with a long shared title prefix remain distinguishable by real identity and accessible text at narrow width; no fictional alternative/winner badge.
- **N4 — Fresh summaries:** runner tool/output activity without a later comment advances the eligible thread revision; an old card is stale and a newly cited eligible event can be summarized. Replayed callbacks and projection-only card writes must not generate an analysis feedback loop.
- **N5 — Exact comment retry:** overlapping same actor/thread/request/payload returns one durable comment/event to both calls; different payload under the same request ID yields an explicit conflict. No swallowed unrelated database error.
- **N6 — Fresh demo input (unassigned after cancelled dispatch):** each generated trial uses new identifiers; B's initial prompt/workspace contains neither A's newly introduced marker nor its substantive finding. Generation alone is synthetic input preparation, not live use-proof or a security guarantee between same-machine directories.

Run focused regressions against actual implementations. Do not repeat broad suites until a finished slice is ready for integration. Native observations remain with QA; new code in this checkout is not claimed native-verified just because the older window passed. Live WF02/WF10 still require the backend/runtime/Flower chain and real receipts.
