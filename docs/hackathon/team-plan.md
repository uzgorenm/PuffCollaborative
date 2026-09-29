# Puff Collaborative Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. The intended execution method here is four human owners working in parallel; no agents or teammates have been dispatched by this document.

**Goal:** Demonstrate evidence-backed coordination between two real coding sessions through Flower, including human approval and context reuse.

**Architecture:** Two OpenCode workers export selected activity to a small hub. A SuperGrid AgentApp produces summaries and proposals from permitted evidence; the hub validates human approval and routes one attributed input to the target session's original worker.

**Tech Stack:** Existing OpenCode TypeScript/Bun and SolidJS; a project-local Python/uv Flower AgentApp; local persistent JSON records; no additional agent framework or database service.

**Spec:** [mvp-spec.md](mvp-spec.md). Also read [README-review.md](README-review.md).

**Delivery instruction:** Serdar requested that completed work be committed and pushed to `origin/main` every time. The workstream branch names below are optional local isolation names; the shared delivery branch is `main`. Synchronize with remote `main` before integrating and pushing, preserve teammates' commits, and never force-push.

## Global constraints

- Budget: 5–6 hours, four people, one project, two workers, three actual agents.
- OpenCode repo toolchain: bun@1.3.14. Prove startup before product changes; Bun was missing in the inspected shell.
- Flower bootstrap: 1.39.0; thereafter use the generated project's compatible dependencies, uv.lock, and `uv run flwr ...`. Preserve the verified original template outside this repo.
- No React replacement, new agent framework, local Ollama setup, external database service, or desktop packaging.
- No credentials in tracked files, URLs, logs, browser bundles, or FAB contents. Explicitly shared synthetic sessions only for the demo.
- Per-session ownership, stable event/action IDs, source revisions, and attributed approvals are required, not optional polish.
- Reuse existing OpenCode execution and permissions; no second coding loop and no remote shell endpoint.
- Root/package AGENTS.md apply. Run tests and `bun typecheck` from package/task directories, never tests from repo root. UI copy uses the existing i18n mechanism.
- Branch names have at most three hyphen-separated words; use conventional commits. Do not change upstream runtime architecture to implement this MVP.

## Owners and file boundaries

| Owner | Workstream / branch | Owns | First usable output |
| --- | --- | --- | --- |
| Serhat | OpenCode adapter / `session-bridge` | hackathon/worker/ | One real session exported and one approved input admitted to that same session. |
| Ferit | Shared state and API / `shared-project-state` | hackathon/hub/, hackathon/contracts/ | Contract fixtures and hub snapshot/event/approval endpoints. |
| Serdar | Flower coordination / `flower-coordinator` | hackathon/flower/ | A real SuperGrid run returning a validated report over the common fixtures. |
| Talha | Team overview / `team-overview` | packages/app/src/pages/puff/, packages/app/src/components/puff/, packages/app/src/app.tsx route, app i18n keys | Two-session view and proposal review against the fixtures. |

This uses Serhat's OpenCode familiarity and Serdar's already-verified Flower setup. Ferit and Talha have equally important ownership; their assignments do not assume different skill levels.

Ferit is the integration owner for shared schemas and the root manifest/lockfile if changes become necessary. Other owners request narrowly scoped root changes rather than editing those files concurrently. Talha owns any shared UI entry-point edits. No one implements another owner's workstream in parallel without agreeing a handoff.

## Review focus

1. Duplicate/reordered events and repeated clicks must not create duplicate coding instructions. Ferit tests hub idempotency; Serhat tests OpenCode retry reconciliation.
2. Private sessions, wrong-project identities, and client-spoofed authors must not cross the sharing boundary. Serhat tests export scope; Ferit tests server-side authorization.
3. New evidence must invalidate old proposals/approvals. Ferit tests revision checks; Talha renders the stale state.
4. Offline workers and failed Flower runs must not look successful. Serdar tests coordinator failures; Serhat tests failed delivery; Talha shows both states.
5. A model must not turn an unsupported claim into accepted knowledge. Serdar tests source validation/no-overlap behavior; Ferit tests explicit decision approval and supersession.

## Task 1 — Serhat: connect real OpenCode sessions

**Features:** F1 capture; F4 delivery; F5 delivery to new/existing sessions.

**Create:** hackathon/worker/package.json, tsconfig.json, adapter.ts, sharing.ts, worker.ts, adapter.test.ts, sharing.test.ts, README.md.

**Inspect first:** packages/plugin/src/index.ts; packages/protocol/src/groups/session.ts; packages/server/src/handlers/session.ts; existing plugin/API tests and relevant AGENTS.md. Do not assume the legacy plugin hooks drive the active V2 runtime.

**Consumes:** Ferit's v1 contract, roster/worker credentials, hub routes, and the selected local OpenCode API.

**Produces:** `captureSession(sessionId) -> SharedEvent[]`; `deliverContext(delivery) -> {messageId, state, error}`; heartbeats; delivery acknowledgments.

- [ ] In the first 30 minutes, launch the chosen OpenCode runtime, create a synthetic session, fetch its messages/events, and submit one ordinary prompt through the actual supported API. Record the exact working path/version.
- [ ] Write failing checks: `unshared_session_exports_nothing`; `selected_session_exports_only_allowed_fields`; `retry_delivery_reuses_message_id`; `delivery_cannot_target_other_worker`; `busy_session_uses_existing_queue`.
- [ ] Run `bun test` from hackathon/worker and confirm the new assertions fail for the intended missing behavior.
- [ ] Implement selected-session capture, sharing preview, durable event cursor, 10-second heartbeat, hub publishing, and polling/claiming deliveries. Use capped payloads and only the assigned project's sessions.
- [ ] Implement context delivery through existing prompt admission. Preserve worker/session identity and author metadata. Never replay an ambiguous delivery automatically.
- [ ] Run package tests and `bun typecheck`; prove with a real session that a repeated delivery produces one visible context input and the session subsequently uses it.
- [ ] Document startup and shutdown without printing credentials; commit with `feat(worker): bridge shared OpenCode sessions`.

**Done when:** a second person sees a permitted event and an approved proposal reaches exactly the intended local session. A private session stays absent; an offline worker reports failure rather than delivery.

**If blocked at minute 45:** pair with Ferit on one verified HTTP path; use explicit capture/context buttons instead of automatic hooks. Do not spend the entire hackathon supporting both API generations.

## Task 2 — Ferit: contracts, hub, durable decisions

**Features:** F1 registry; F4 approval/routing; F5 memory; shared persistence for F2/F3/F6.

**Create:** hackathon/contracts/v1.schema.json, fixtures.json, README.md; hackathon/hub/package.json, tsconfig.json, server.ts, store.ts, jobs.ts, approval.ts, server.test.ts, approval.test.ts, README.md.

**Consumes:** worker events; Serdar's `coordinate` boundary; member/worker runtime credentials.

**Produces:** all `/puff/v1/...` routes from the spec, fixed-roster authorization, persistent snapshots, proposal/version validation, delivery queue, accepted decisions, and integration fixtures. Runtime storage lives outside tracked source and is ignored by Git.

- [ ] Publish the v1 schema and one shared fixture file by minute 25. Include two workers/sessions, one permitted event per session, an overlap proposal, a stale proposal, and an accepted decision. These are labeled synthetic fixtures, not live evidence.
- [ ] Write failing checks: `duplicate_event_is_noop`; `old_revision_does_not_replace_new`; `spoofed_actor_and_wrong_project_are_rejected`; `stale_approval_returns_conflict`; `double_approval_creates_one_delivery`; `restart_preserves_approved_decisions`; `superseded_decision_is_not_current`.
- [ ] Run `bun test` from hackathon/hub and confirm intended failures.
- [ ] Implement the narrow single-project API and single-writer persistence. Derive actor/worker identity from authentication; do not treat OpenCode's instance-level password as project membership.
- [ ] Implement async coordinator jobs keyed by requestId. Save run/result/error state, validate reports, and preserve source revisions. Do not rerun Flower when the UI polls.
- [ ] Implement owner-only approval with exact version/text/target binding, one pending delivery per session, worker claims/acknowledgments, and explicit knowledge acceptance/supersession.
- [ ] Run tests and `bun typecheck`; restart the service and verify decisions persist. Verify unauthorized calls fail and duplicate approval returns the same action without an extra execution.
- [ ] Write the integrated startup order; commit with `feat(hub): coordinate shared project state`.

**Done when:** fixtures can be replaced with real worker events without changing the schema, two people can read the same project state, and approved delivery is authorized and idempotent.

**If time is short:** fixed roster, JSON storage, and 2-second UI polling are sufficient. Do not build account onboarding, organizations, a generic job platform, or a vector index.

## Task 3 — Serdar: Flower summaries and coordination

**Features:** F2 summaries; F3 evidence-based detection; F5 context retrieval; F6 Flower trace.

**Create:** hackathon/flower/pyproject.toml, uv.lock, LICENSE, agent/agent_app.py, agent/utils.py, coordinator.py, test_coordinator.py, README.md. Derive the AgentApp from the official template, preserving its licensing and compatible dependency declarations.

**Consumes:** ContextRequest, ProjectSnapshot, permitted events, accepted decisions, and the shared fixtures.

**Produces:** `coordinate(request, snapshot) -> CoordinationReport`; a real Flower run ID; source-linked summaries/proposals; bounded failure states.

- [ ] In the first 45 minutes, run the official-template-derived app on SuperGrid with the fixture input; capture the run ID and retrieve one structured result through the selected CLI/log channel. Prove local-host-to-SuperGrid submission and return before writing sophisticated prompts.
- [ ] Write failing checks using Python's standard unittest: `unknown_evidence_is_rejected`; `report_preserves_request_and_session_ids`; `no_overlap_can_return_empty_proposals`; `superseded_decision_excluded`; `failed_run_never_becomes_success`; `repeated_request_id_does_not_launch_twice` (the hub owns durable deduplication; adapter honors its existing run ID).
- [ ] Run `uv run python -m unittest discover` from hackathon/flower and confirm intended failures.
- [ ] Implement bounded input selection, session summarization, overlap/dependency/reuse reasoning, and accepted-decision lookup. Record the exact source revisions considered. Do not send unrelated history or make up evidence.
- [ ] Emit one schema-valid coordination report and visible response; parse the report strictly on return. Pass subprocess arguments as an argument array, never interpolated shell text. Runtime failures preserve safe diagnostics and the run ID.
- [ ] Integrate the async hub boundary. A request must finish or fail within 90 seconds. Preserve coding availability when coordination fails. Add debounced refresh only after explicit checks succeed.
- [ ] Run unit checks, `uv run flwr build`, and two real smoke tests: overlap and unrelated tasks. Inspect the report and completed run status; do not infer success merely from a created run ID.
- [ ] Commit with `feat(flower): propose evidence-backed coordination`.

**Done when:** the actual Flower result changes what the target session knows, with source references and human approval. A static canned proposal or an animation alone does not satisfy this task.

**If time is short:** use the existing runtime model and an explicit check button. Defer native Grid routing, automatic provider selection, a separate verifier agent, and local inference.

## Task 4 — Talha: shared overview and human review

**Features:** F1 visibility; F4 approval controls; F5 decision view; F6 observable demo.

**Create:** packages/app/src/pages/puff/index.tsx, project-api.ts, project-state.test.ts; packages/app/src/components/puff/session-card.tsx, proposal-card.tsx, decision-list.tsx. Modify only the necessary route in packages/app/src/app.tsx and app i18n resources.

**Consumes:** Ferit's fixtures/snapshot API, proposal approval endpoint, context-request endpoint, and decision endpoint.

**Produces:** one team overview with worker/session cards, source-linked summaries, context-check action, proposal review, delivery status, and accepted decisions.

- [ ] Use the existing app development path and components. Render the common fixture by minute 45; no alternate React app or desktop packaging.
- [ ] Write meaningful state checks: `offline_worker_is_not_displayed_as_current`; `approval_sends_expected_version_and_final_text`; `stale_conflict_requires_refresh`; `delivery_ack_required_for_success`; `proposal_text_is_rendered_as_untrusted_content`.
- [ ] Run the specific tests from packages/app using its existing test setup and confirm intended failures; read its AGENTS.md before changes.
- [ ] Build one route with two worker lanes and a central proposal area. Show owner, worker, session, last update, evidence references, and Flower run ID. Clearly label fixtures until real data replaces them.
- [ ] Add Approve/Edit/Reject for the authorized target owner, an explicit Check team context action, and a separate Accept as project decision action. The server remains the authorization authority.
- [ ] Integrate hub polling; show pending/failed/stale/delivered distinctly. Existing conversation links must target the intended server/session, not assume the viewer's localhost is the worker.
- [ ] Run relevant app tests, `bun typecheck`, and a browser walkthrough at two viewport sizes. Verify the complete review/delivery flow with Ferit and Serhat.
- [ ] Commit with `feat(app): show team context and handoffs`.

**Done when:** a viewer can explain who owns each resource, what crossed the boundary, why Flower proposed the action, who approved it, and whether the destination received it.

**If time is short:** cards and a compact event list are enough. Cut animated graphs and full transcript mirroring before cutting the approval and delivery states.

## Integration schedule

| Elapsed | All-team checkpoint |
| --- | --- |
| 0:00–0:25 | Agree scope/contracts, verify toolchains, fixed demo roster and connectivity. Each owner uses a separate checkout based on current remote main; it includes Serhat's reviewed README. |
| 0:25–0:45 | Serhat proves OpenCode capture/input; Ferit supplies fixtures/API; Serdar proves Flower structured round trip; Talha renders fixtures. Pair immediately on a blocked execution dependency. |
| 0:45–2:00 | Implement owned slices against frozen contract. Verify and integrate small working commits into main early; do not wait for polish to share interfaces. |
| 2:00–3:00 | First live vertical slice: both workers -> hub -> Flower -> proposal -> owner approval -> actual target session response. |
| 3:00–4:00 | Add accepted decisions and new-session reuse; test stale source, duplicate approval, private session, and worker offline. |
| 4:00–5:00 | Freeze new features, integrate, rehearse, restart services, capture a clearly labeled backup recording of a genuine successful run. |
| Optional hour 6 | Fix defects and improve clarity. Add a stretch item only if the complete demo has succeeded twice. |

## Working agreement

- Read the spec and your task card before coding. Contract changes go through Ferit with all four owners informed; schema version changes require fixture updates.
- Each owner shares the working command, exact pushed commit, evidence of their checks, and known limitations. This document does not itself notify anyone or assign GitHub issues.
- Ferit coordinates integration order: contracts and fixtures first; hub, worker, Flower, and UI slices follow as their interfaces work. Check each slice before committing and pushing it to main; authors preserve another person's in-progress changes.
- Use separate checkouts. The optional local isolation branches are `session-bridge`, `shared-project-state`, `flower-coordinator`, and `team-overview`; completed work goes to main. Fetch before every integration. If a push is rejected because main advanced, reconcile the incoming commits, rerun affected checks, and push normally.
- Each owner reserves the final hour for integration and testing. Serdar narrates the Flower run; Serhat and Ferit operate the two demo workers; Talha operates the overview and shows the approval flow.
- Checkpoints measure observed outcomes. A build, fixture response, live Flower run, and successful context delivery prove different things.

## Final acceptance rehearsal

1. Start two real, explicitly shared synthetic sessions on different machines; show distinct worker/session identities.
2. Keep one private session unshared and demonstrate that it does not appear in the hub or Flower input.
3. Request context; show a completed Flower run with an evidence-backed dependency or reuse suggestion.
4. Change a referenced source and verify the old proposal cannot be approved.
5. Generate a fresh proposal, edit or approve it as the target worker owner, and observe one attributed input plus the destination agent's response.
6. Retry the same approval/delivery and verify no second input is created.
7. Accept a source-backed project decision; restart the hub and retrieve it from a fresh session.
8. Disconnect a worker and show an honest offline/failure state. Explain exactly which content left each machine and which model/runtime handled it.

GitHub Issues was disabled when this plan was written. These four task cards are ready to become issues if the repository owner enables that feature; GitHub handles and platform assignments are separate from the human ownership recorded here.
