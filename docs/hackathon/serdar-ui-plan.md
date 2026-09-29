# Puff team interface implementation plan

> Execute inline using superpowers:executing-plans. This plan covers Serdar's T3 only.

**Goal:** Make simultaneous coding experiments and the exchange of useful findings understandable and reviewable inside the existing OpenCode frontend.

**Architecture:** Add `/puff` to the existing SolidJS app. A small API adapter reads the hub snapshot and submits explicit human actions. The page uses the existing theme, components, and localization. A clearly labeled synthetic preview works before the shared hub arrives; preview actions never claim real execution.

**Tech stack:** Existing SolidJS, Bun 1.3.14, TypeScript, app components and i18n. No new production dependencies.

**Spec:** `docs/hackathon/mvp-spec.md`, Task 3 in `team-plan.md`.

## Constraints and integration boundaries

- Work on main; commit only this slice, preserve concurrent documentation edits, fetch/integrate before pushing.
- Serhat owns shared contracts/hub, Talha the worker, Ferit Flower. Keep provisional UI types and synthetic examples inside the Puff page until their common contract exists.
- Existing OpenCode conversations, execution and permissions remain the session implementation.
- Use two-second snapshot polling and a 30-second heartbeat cutoff. Approval is not delivery; require a matching delivery acknowledgment and message ID.
- No credentials in URLs, build variables, fixtures, or persistent browser storage. A hub connection can hold a member credential in memory for the current page only. Authentication remains server-owned.
- Missing viewer identity or worker route metadata disables owner actions/deep links rather than guessing identity or localhost.
- Full cross-worker integration cannot be claimed until the hub and worker are available.

## Review focus

1. New evidence while a proposal is being edited must invalidate the old approval, not silently rebind it to a new version.
2. A stale or failed poll must not make cached workers look current or enable new writes.
3. Duplicate clicks and delayed requests must not send multiple instructions or paid context checks.
4. Untrusted model text and source IDs must render as text; source navigation must identify the exact worker/session.
5. Synthetic examples, accepted requests, and actual acknowledged delivery must be visibly distinct.

## Task 1: State and API boundary

Files: `pages/puff/project-api.ts`, `project-state.ts`, `project-state.test.ts`, `preview.ts`.

Interfaces: export snapshot record types and `createProjectApi({baseUrl, token})`; methods `snapshot`, `approve`, `context`, `request`, `sharing`, `acceptDecision`. Pure selectors calculate worker freshness, source staleness and acknowledged delivery.

- [x] Install the pinned runtime locally and existing dependencies without modifying manifests/lockfile.
- [x] Write failing tests for stale/offline workers, preserved alternative sessions and work state, exact approval version/text, conflict errors, acknowledgment-only delivery, source revision changes and invalid snapshot rejection.
- [x] Implement the adapter and selectors against the documented v1 contract. Keep optional integration metadata explicit in a handoff README.
- [x] Run targeted tests; record results.

## Task 2: Team view and interactions

Files: `pages/puff/index.tsx`, `puff.css`, `components/puff/session-card.tsx`, `proposal-card.tsx`, `decision-list.tsx`, `evidence.tsx`; minimal route/navigation in `app.tsx`; new English i18n keys.

Consumes Task 1's snapshot/API/selectors. Produces one responsive page with a connection form, session lanes, awareness feed, proposal editing/review, sharing/topic/mute controls, context-check progress, accepted decisions, and inspectable source activity.

- [x] Build with existing Button/TextField/theme and localized visible copy.
- [x] Keep preview actions explicitly simulated and delivery pending until an acknowledgment is present.
- [x] Disable writes while disconnected, stale, unauthorized, or pending; preserve edited text against polling changes.
- [x] Add a visible app navigation entry; keep original conversations available through verified worker mappings.

## Task 3: Verification and delivery

- [x] Run targeted tests, package typecheck and build; distinguish existing failures from new ones.
- [x] Walk through desktop and mobile layouts, evidence inspection, edit/approve/reject, pending delivery, stale/offline states, topic/mute/unshare and accepted decisions.
- [x] Review the final diff with a fresh reviewer and fix important findings.
- [x] Update only T3 status/checklist, document the hub integration requirements, commit verified work and push normally to main after fetching. See `evidence/2026-09-29-serdar-ui.md` for the code version and evidence boundary.

## Progress

- Plan prepared from the existing approved team scope and the request to plan and implement immediately.
- Ruling: no new feature branch/worktree; repository instructions explicitly require main. Concurrent general planning edits will not be staged in this slice.
- Ruling: the common hub schema/fixtures do not exist yet. UI-owned provisional types and preview data permit useful work; replacing them with the published contract and proving real delivery remains an integration checkpoint.

## Contract update discovered during implementation

The shared backend landed while this UI was being built. Its actual prefix is `/api/coordination/v1`, authentication is individual Basic, and only the status endpoint is registered. The normal connection now checks that route; the provisional `/puff/v1` adapter is accessible only as an explicitly selected development fixture. No automatic fallback presents examples as live state. See the UI handoff README and integration gate G0.

## Implementation and review record

- Runtime/dependencies installed without changing package manifests or the lockfile.
- Responsive `/puff` route, both home navigation entries, session cards, source inspection, shared findings, review/edit/reject, sharing settings and explicit accepted decisions implemented.
- Thirteen focused tests cover state/API, persistent pending IDs, definitive rejection and the real Basic readiness route. Five localization parity checks also pass.
- Independent review found four important interactions: disconnect losing a pending job, edited decision text mismatch, pending jobs blocking mute/unshare, and definite rejection leaving an unrecoverable pending job. Fixed all four; unit and synthetic HTTP/browser checks verified the affected behavior.
- Browser walkthroughs at 1440×1100 and 390×844; synthetic HTTP polling/reconnect and lost-connection checks. No production collaboration or Flower claim.
- Ruling: explicit English fallback in every app locale preserves key/placeholder parity without inventing unreviewed translations. Cost: Puff copy remains English until native review.
- Ruling: the pre-existing `desktop native locale detection > uses Unicode likely subtags for script-sensitive bundles` failure (`pa-PK` yields `en`, expected `pa`) is reported rather than changing unrelated locale behavior. Its source and test are unchanged from HEAD. Cost: the full unit suite is not entirely green on Bun 1.3.14 in this environment.
- Remaining: G0 authoritative snapshot/action/receipt mapping and services; live WF01–WF07/WF10 and two fresh WF02 rehearsals. T3 is UI/fixture verified, not live-integration complete.
