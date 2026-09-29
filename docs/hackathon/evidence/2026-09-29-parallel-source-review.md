# Independent desktop and backend source review

Recorded September 29, 2026, approximately 13:04 PDT. **Evidence level: source review only.** Three independent agents reviewed backend integration, frontend reliability and desktop interaction opportunities. They made no edits, executed no tests, started no servers and did not observe native interactions.

## Reviewed state

- Original checkout: `/Users/mac/Desktop/Coding/Hackathon/Puff/PuffCollaborative`, `main` at `0a91f6231aa4d64cc909839f46c376d54b1b1116`.
- The `team-api`, `team-context`, `team-state`, `team-thread`, `team-shell` and `team.css` UI files were untracked evolving work. Desktop initialization and the retained OpenCode host's HTTP API composition were dirty. Findings about them must be rechecked after the frontend lead's changes; HEAD alone does not identify those files.
- Prepared output checkout: `/Users/mac/Desktop/Coding/Hackathon/Puff/PuffCollaborative-serdar-ui`, `serdar/ui`, parent `f715b3e3594dfc92a95c698ee274b0e4f6a8b639`. It does not contain the newer backend/dirty UI above. This receipt records observations, not a merge of those implementations.
- Serhat's committed `docs/hackathon/evidence/2026-09-29-coordination-backend-mock.md` on main reports core tests, seven HTTP-handler runs, migration/client checks and typechecking at `4124e1af73`. That receipt used Bun 1.4.2 versus repository pin 1.3.14. These results were read, not independently rerun. The handler tests do not prove native/network transport or real agent execution.

## Backend findings and handoff

| ID | Finding and source | Reproduction to add | Owner |
| --- | --- | --- | --- |
| B1 — P1 | Queue/runner activity does not advance `Thread.activitySeq`; `packages/core/src/coordination/queue/queue.ts` callback projection around line 455 writes callback/Run state. `work-card/work-card.ts:119–130` requires exact current revision and rejects newer evidence. Revision updates found for creation/comments do not cover runner output. | Run tool/output activity without posting a later comment. Require a card citing the latest eligible event to succeed and an older card to become stale. Define meaningful revision events and update the projection atomically. | Serhat; Ferit consumes the revision |
| B2 — P2 | `packages/core/src/coordination/comments/index.ts:52–102` checks request identity before unconditional transactional insert; `comments/sql.ts:20` has a unique request index. Overlapping exact retries may return a database defect instead of the same result. Not reproduced. | Concurrently send the same member/thread/request/payload. Both resolve to one stored comment/event; conflicting reuse fails explicitly. | Serhat |
| B3 — integration blocker | Committed standalone server composition differs from the retained OpenCode host. Dirty `packages/opencode/src/server/routes/instance/httpapi/server.ts` adds coordination layers; an existing helper owns this fix. Last native QA report saw missing `@opencode/CoordinationRuntime`. | Verify the final configured desktop host over actual HTTP and native transport with individual member credentials, not only unconfigured 503. | Existing startup helper; R1 verifies; native QA observes |
| B4 — execution handoff | `packages/server/src/handlers/coordination-data.ts:71–88` queues instructions; separate runner-auth reservation starts execution. The mock integration test reserves turns explicitly. | Identify and exercise the worker that claims the first and subsequent turns. Member UI must never hold worker credentials. | Talha/runtime; R1 verifies mock boundary |

Existing dirty `team-api.ts` and `team-context.tsx` already consume `/api/coordination/v1`: projects, threads, snapshot, paged replay, comments, instructions, cancellation and approval claim/decision. Do not replace this client. Provisioning/admission are outside that UI; project activity/card lists and SSE are not consumed by this client. Current event updates are polling, not proof of an SSE UI.

Analysis authentication can write validated WorkCards, but the reviewed host does not compose real Flower job triggering/results. It also does not let analysis principals use ordinary member read endpoints. Ferit needs an explicit authorized-input handoff; do not bypass access control to get it.

## Frontend reliability findings

All line references below describe the inspected **dirty** version, not an immutable commit. Recheck before fixing. Each is source-derived, not an executed failure.

| ID | Failure sequence | Source and expected correction | Owner |
| --- | --- | --- | --- |
| U1 — P2 | Send times out with pending request; credentials expire; writeability prevents retry, pending prevents disconnect, connected prevents reconnect. Reload loses in-memory request identity. | `team-context.tsx`, connect/disconnect/send guards. Allow same-identity credential recovery while preserving the exact ambiguous submission. | Frontend lead; R4 verifies |
| U2 — P2 | Delay A read, select B then A. Global read lock skips new reads; old A matches thread ID/connection and is published as fresh. | `team-context.tsx`, selectThread/refresh. Guard each selection generation and stop obsolete replay work. | Frontend lead; R4 verifies |
| U3 — P2 | Replay reaches 25 pages with `hasMore` still true; provider nevertheless clears loading/errors and refreshes lastSuccess. | `team-context.tsx`, replay loop and final state. Preserve catch-up/incomplete state separately from connectivity. | Frontend lead; R4 verifies |
| U4 — P2 | Tool approval decision commits; runner forwarding fails; refresh hides the decided approval although delivery remains pending. Retry first tries to claim an already-decided approval. | `team-thread.tsx` approval filter; `team-context.tsx` control; `packages/core/src/coordination/runner/adapter.ts:139`. Display decision and delivery separately; reconcile the exact decision. | Frontend lead and Serhat; R4 verifies |

Ordinary double-click submission is guarded synchronously in the inspected code; the review did not support a duplicate-click finding.

## Creative review and product continuity

The native shared-thread direction needs deliberate continuity with the existing coding experience. Highest-value proposals are: distinguish same-owner A/B by approach/state; inspect exact evidence and return without losing draft/position; retain meaningful code/diff/tool presentation; make A's finding causing B's changed plan visible.

Topic/alternative/sharing/mute controls and admission/promotion/use stages from the earlier prototype do not yet have demonstrated authoritative equivalents in the desktop flow. Preserve their product meaning through the current shell/thread/context design; do not restore a dashboard or invent successful states. Visual and motion judgments remain hypotheses until observed in Electron.

## Completion boundary

Serhat has a substantial implemented coordination slice and a reported mock integration receipt. No new G0–G6 gate, D01–D06 native check or WF01–WF10 live workflow is closed by this source review. A stored card, tool permission or mock Run is not proof of real Flower cooperation or an already-active target agent using a finding.

Next: [R1–R6 assignments](../serdar-parallel-reviews.md), starting with the lead's checkout/panel handoff and R1's actual existing-client connection proof. Existing native QA retains `serdar-desktop-qa.md`; this review does not modify or replace its observations.
