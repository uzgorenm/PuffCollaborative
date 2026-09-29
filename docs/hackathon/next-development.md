# Next development round

September 29, 2026. Serdar authorized continued development through the existing chats. Start from integrated main `4a19f943a7`; this file records work assignments, not completion claims. Preserve the native-first product, original coding controls, meaningful collaboration and the existing acceptance workflows.

## Workspace and coordination

- **Next implementation checkout:** `/Users/mac/Desktop/Coding/Hackathon/Puff/PuffCollaborative-main-integration`. It is a detached integration checkout on current main; do not switch/reset it. Coordinator is its sole Git writer and main publisher. The frontend lead owns frontend composition but does not stage/commit in this checkout.
- **QA checkout/window:** `/Users/mac/Desktop/Coding/Hackathon/Puff/PuffCollaborative-serdar-ui`, native profile `/tmp/puff-serdar-ui-desktop`, renderer 5175/CDP9223. Freeze source there while QA tests it. Review drafts and the prior R1 consumer test remain preserved there. New implementation agents must not accidentally edit that checkout.
- **Native input:** QA completed its pass and explicitly released CDP9223. The frontend lead is finishing its already-started polling-focus repair and must release input after its commit; this is not a grant for further native work. The coordinator assigns the next native pass explicitly. All other chats use source and isolated tests.
- **Backend/runtime/Flower feature delegation:** `Set up Flower development (2)` owns its separately isolated sharing, active-Session and Flower agents. It publishes exact branch/file boundaries and ready commits. It must not write frontend files or this integration checkout, and does not push main independently.
- **Main integration:** `Set up Flower development` reviews finished slices, runs affected checks at the combined source, and commits/pushes normally. Do not stage another agent's unfinished changes. Coordinate a short file freeze before integrated checks; ordinary source/test work stays parallel.
- **Follow-up:** the coordinator checks progress every ten minutes through a thread heartbeat, stays quiet on unchanged state, and assigns only meaningful next work within the agreed MVP. Completed work is not restarted merely to keep a chat busy.

## File ownership

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

Read applicable AGENTS.md and current source before work. Use existing libraries, components, schemas, theme and i18n. No new framework, new runner, replacement API client or invented delivery contract. Library-specific API work uses Context7. Do not copy old review conclusions without checking whether the latest source fixed them. Each role returns exact changed files, tests, limitations and its ready handoff; ask the coordinator to resolve ownership conflicts instead of editing outside the table.

### Ready backend handoffs awaiting integration

- Sharing authorization: `297af1bcc41c9e490c935b5fb68ef2e84fc1121a` on `codex/sharing-consent`, in `PuffCollaborative-sharing-consent`. R5 reviews this exact commit. New sharing fails closed without a trusted production Session-selection provider; demo provisioning must account for this before integration. Existing authorized reads are separately tested.
- Active-Session admission: `021ed1b46ce49aa6b18510f32e61c37c2766ecea` on `codex/active-session-handoff`, in `PuffCollaborative-active-handoff`. Deterministic tests show one safe-boundary promotion during an active provider stream; this still needs the validated source/consent/worker caller and integration review.
- Flower's fresh hosted synthetic chain completed A/B analysis and coordination in runs `2737239426624509029`, `1193879813426190823`, and `16630437671334715564`. Its receipt and commit are pending. This is not evidence of backend delivery, active-Session promotion, or B using the result.
- The lead's small polling-focus repair in `serdar-ui` must be ported by R4 into its owned controller files. R3 reuses the accompanying browser regression. Do not cherry-pick over their active edits or run two competing native checks.

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
