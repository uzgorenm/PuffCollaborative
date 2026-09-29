# Puff Collaborative Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. The intended execution method here is four human owners working in parallel; no agents or teammates have been dispatched by this document.

**Goal:** Demonstrate live, evidence-backed awareness between two real coding sessions through Flower, including alternative approaches to the same feature and visible adaptation by an ongoing agent.

**Architecture:** Two OpenCode workers export selected activity to a small hub. A SuperGrid AgentApp distinguishes alternative experiments from redundant work and identifies relevant findings. The hub routes short source-linked awareness notes to related opted-in sessions at safe turn boundaries; work-redirection instructions still need the target owner to approve them.

**Tech Stack:** Existing OpenCode TypeScript/Bun and SolidJS; a project-local Python/uv Flower AgentApp; local persistent JSON records; no additional agent framework or database service.

**Spec:** [mvp-spec.md](mvp-spec.md). Also read [README-review.md](README-review.md).

**Delivery instruction:** `main` is the default and only shared development branch. Commit and push completed, verified work directly to `origin/main` every time. No PRs or feature branches. Each teammate uses a separate clone on main, integrates incoming commits before pushing, and never force-pushes. Track ownership and progress in [the team board](README.md).

## Global constraints

- Budget: 5–6 hours, four people, one project, two isolated worker sessions (which may have the same owner), three actual agents.
- OpenCode repo toolchain: bun@1.3.14. Prove startup before product changes; Bun was missing in the inspected shell.
- Flower bootstrap: 1.39.0; thereafter use the generated project's compatible dependencies, uv.lock, and `uv run flwr ...`. Preserve the verified original template outside this repo.
- No React replacement, new agent framework, local Ollama setup, external database service, or desktop packaging.
- No credentials in tracked files, URLs, logs, browser bundles, or FAB contents. Explicitly shared synthetic sessions only for the demo.
- Per-session ownership, stable event/action IDs, source revisions, and attributed approvals are required, not optional polish.
- Reuse existing OpenCode execution and permissions; no second coding loop and no remote shell endpoint.
- Root/package AGENTS.md apply. Run tests and `bun typecheck` from package/task directories, never tests from repo root. UI copy uses the existing i18n mechanism.
- Use main directly and conventional commits. Do not change upstream runtime architecture to implement this MVP.

## Owners and file boundaries

| Owner | Workstream | Owns | First usable output |
| --- | --- | --- | --- |
| Serhat | Shared state and API | hackathon/hub/, hackathon/contracts/ | Contract fixtures and hub snapshot/event/approval endpoints. |
| Talha | OpenCode adapter | hackathon/worker/ | One real session exported and one approved input admitted to that same session. |
| Serdar | Team overview | packages/app/src/pages/puff/, packages/app/src/components/puff/, packages/app/src/app.tsx route, app i18n keys | Two-session view and proposal review against the fixtures. |
| Ferit | Flower coordination | hackathon/flower/ | A real SuperGrid run returning a validated report over the common fixtures. |

These assignments follow the team’s confirmed roles. The previously verified standalone Flower setup is available as a starting point for Ferit; the product integration still needs verification.

Serhat is the integration owner for shared schemas and the root manifest/lockfile if changes become necessary. Other owners request narrowly scoped root changes rather than editing those files concurrently. Serdar owns any shared UI entry-point edits. No one implements another owner's workstream in parallel without agreeing a handoff.

## Review focus

1. Duplicate/reordered events and repeated clicks must not create duplicate coding instructions. Serhat tests hub idempotency; Talha tests OpenCode retry reconciliation.
2. Private sessions, wrong-project identities, and client-spoofed authors must not cross the sharing boundary. Talha tests export scope; Serhat tests server-side authorization.
3. New evidence must invalidate old proposals/approvals. Serhat tests revision checks; Serdar renders the stale state.
4. Offline workers and failed Flower runs must not look successful. Ferit tests coordinator failures; Talha tests failed delivery; Serdar shows both states.
5. A model must not turn an unsupported claim into accepted knowledge. Ferit tests source validation/no-overlap behavior; Serhat tests explicit decision approval and supersession.

## Task 1 — Serhat: contracts, hub, durable decisions

**Features:** F1 shared session topics; F4 informational awareness and approved action routing; F5 memory after the core loop; shared persistence for F2/F3/F6.

**Create:** hackathon/contracts/v1.schema.json, fixtures.json, README.md; hackathon/hub/package.json, tsconfig.json, server.ts, store.ts, jobs.ts, approval.ts, server.test.ts, approval.test.ts, README.md.

**Consumes:** worker events; Ferit's `coordinate` boundary; member/worker runtime credentials.

**Produces:** all `/puff/v1/...` routes from the spec, fixed-roster authorization, persistent snapshots, relation/topic selection, source-revision checks, an awareness/approved-action delivery queue, accepted decisions, and integration fixtures. Runtime storage lives outside tracked source and is ignored by Git.

- [ ] Publish the v1 schema and one shared fixture file by minute 25. Include two isolated sessions owned by one person and marked as alternative approaches to one feature topic; add permitted events, a relevant shared constraint, an awareness note, a stale proposal, and an accepted decision. These are labeled synthetic fixtures, not live evidence.
- [ ] Write focused checks for duplicate/old events, wrong-project identities, a note blocked by an unshared or unrelated target, one note per source revision and target, stale approval, and repeat delivery. Test accepted-decision persistence if F5 is reached.
- [ ] Run `bun test` from hackathon/hub and confirm intended failures.
- [ ] Implement the narrow single-project API and single-writer persistence. Derive actor/worker identity from authentication; do not treat OpenCode's instance-level password as project membership.
- [ ] Implement async coordinator jobs keyed by requestId. Save run/result/error state, validate reports, and preserve source revisions. Do not rerun Flower when the UI polls.
- [ ] Route informational notes only between opted-in related sessions, deduplicate by source revision and target, and allow mute/unshare. Keep owner-only approval for work-redirection instructions with exact version/text/target binding. Allow one pending delivery per session, worker claims/acknowledgments, and explicit knowledge acceptance/supersession.
- [ ] Run tests and `bun typecheck`; restart the service and verify decisions persist. Verify unauthorized calls fail and duplicate approval returns the same action without an extra execution.
- [ ] Write the integrated startup order; commit with `feat(hub): coordinate shared project state`.

**Done when:** fixtures can be replaced with real worker events without changing the schema, related sessions can read each other's permitted current state, and awareness/approved delivery is authorized and idempotent.

**If time is short:** fixed roster, JSON storage, and 2-second UI polling are sufficient. Do not build account onboarding, organizations, a generic job platform, or a vector index.

## Task 2 — Talha: connect real OpenCode sessions

**Features:** F1 capture; F4 live awareness and approved-action delivery; F5 delivery to new/existing sessions after the core loop.

**Create:** hackathon/worker/package.json, tsconfig.json, adapter.ts, sharing.ts, worker.ts, adapter.test.ts, sharing.test.ts, README.md.

**Inspect first:** packages/plugin/src/index.ts; packages/protocol/src/groups/session.ts; packages/server/src/handlers/session.ts; existing plugin/API tests and relevant AGENTS.md. Do not assume the legacy plugin hooks drive the active V2 runtime.

**Consumes:** Serhat's v1 contract, roster/worker credentials, hub routes, and the selected local OpenCode API.

**Produces:** `captureSession(sessionId) -> SharedEvent[]`; `deliverContext(delivery) -> {messageId, state, error}`; heartbeats; delivery acknowledgments.

- [ ] In the first 30 minutes, launch the chosen OpenCode runtime, create a synthetic session, fetch its messages/events, and submit one ordinary prompt through the actual supported API. Record the exact working path/version.
- [ ] Write focused checks for unshared sessions exporting nothing, selected fields only, awareness reaching only the selected related session, retry reusing the same message ID, and busy sessions using the existing queue.
- [ ] Run `bun test` from hackathon/worker and confirm the new assertions fail for the intended missing behavior.
- [ ] Implement selected-session capture, sharing preview, durable event cursor, 10-second heartbeat, hub publishing, and polling/claiming deliveries. Use capped payloads and only the assigned project's sessions.
- [ ] Implement informational awareness and approved instructions through existing prompt admission at safe boundaries. Preserve worker/session identity and source attribution. Never replay an ambiguous delivery automatically; do not interrupt an active model/tool turn to inject a note.
- [ ] Run package tests and `bun typecheck`; prove with a real session that a repeated delivery produces one visible context input and the session subsequently uses it.
- [ ] Document startup and shutdown without printing credentials; commit with `feat(worker): bridge shared OpenCode sessions`.

**Done when:** a related ongoing agent visibly uses a source-linked update from another session's permitted event, and an approved action reaches exactly the intended local session. A private session stays absent; an offline worker reports failure rather than delivery.

**If blocked at minute 45:** pair with Serhat on one verified HTTP path; use explicit capture/context buttons instead of automatic hooks. Do not spend the entire hackathon supporting both API generations.

## Task 3 — Serdar: shared overview and human review

**Features:** F1 visibility and relation labels; F4 live awareness and approval controls; F5 decision view after the core loop; F6 observable demo.

**Create:** packages/app/src/pages/puff/index.tsx, project-api.ts, project-state.test.ts; packages/app/src/components/puff/session-card.tsx, proposal-card.tsx, decision-list.tsx. Modify only the necessary route in packages/app/src/app.tsx and app i18n resources.

**Consumes:** Serhat's fixtures/snapshot API, proposal approval endpoint, context-request endpoint, and decision endpoint.

**Produces:** one team overview with worker/session cards, source-linked summaries, context-check action, proposal review, delivery status, and accepted decisions.

- [ ] Use the existing app development path and components. Render the common fixture by minute 45; no alternate React app or desktop packaging.
- [ ] Write meaningful state checks for two alternative approaches remaining distinct, planned work not shown as completed, offline workers marked stale, an awareness note awaiting delivery, approval sending the expected version/text, and delivery requiring acknowledgment.
- [ ] Run the specific tests from packages/app using its existing test setup and confirm intended failures; read its AGENTS.md before changes.
- [ ] Build one route with two worker lanes and a central proposal area. Show each alternative approach and its planned/ongoing/completed status, source-linked awareness notes, owner, last update, and Flower run ID. Clearly label fixtures until real data replaces them.
- [ ] Add a shared feature-topic control, awareness mute/unshare, source links, and visible note delivery. Add Approve/Edit/Reject for redirection proposals and an explicit Check team context fallback; the server remains the authorization authority. Add Accept as project decision after the live loop works.
- [ ] Integrate hub polling; show pending/failed/stale/delivered distinctly. Existing conversation links must target the intended server/session, not assume the viewer's localhost is the worker.
- [ ] Run relevant app tests, `bun typecheck`, and a browser walkthrough at two viewport sizes. Verify the complete review/delivery flow with Serhat and Talha.
- [ ] Commit with `feat(app): show team context and handoffs`.

**Done when:** a viewer can explain who owns each resource, what crossed the boundary, why Flower proposed the action, who approved it, and whether the destination received it.

**If time is short:** cards and a compact event list are enough. Cut animated graphs and full transcript mirroring before cutting the approval and delivery states.

## Task 4 — Ferit: Flower summaries and coordination

**Features:** F2 summaries; F3 alternative versus duplicate detection; F4 source-linked awareness; F5 context retrieval after the core loop; F6 Flower trace.

**Create:** hackathon/flower/pyproject.toml, uv.lock, LICENSE, agent/agent_app.py, agent/utils.py, coordinator.py, test_coordinator.py, README.md. Derive the AgentApp from the official template, preserving its licensing and compatible dependency declarations.

**Consumes:** ContextRequest, ProjectSnapshot, permitted events, accepted decisions, and the shared fixtures.

**Produces:** `coordinate(request, snapshot) -> CoordinationReport`; a real Flower run ID; source-linked summaries/proposals; bounded failure states.

- [ ] In the first 45 minutes, run the official-template-derived app on SuperGrid with the fixture input; capture the run ID and retrieve one structured result through the selected CLI/log channel. Prove local-host-to-SuperGrid submission and return before writing sophisticated prompts.
- [ ] Write focused checks for unknown evidence, correct request/session IDs, parallel alternatives not mislabeled as redundant, no relation returning no finding, failed runs not becoming success, and repeat request IDs not launching twice. Add superseded-decision checks if F5 is reached.
- [ ] Run `uv run python -m unittest discover` from hackathon/flower and confirm intended failures.
- [ ] Implement bounded input selection, session summarization, alternative/duplicate/dependency/reuse reasoning, and source-linked awareness notes. Preserve planned/ongoing/completed status and exact source revisions; never infer that two alternatives are redundant from similar wording alone. Add accepted-decision lookup after the live loop works. Do not send unrelated history or make up evidence.
- [ ] Emit one schema-valid coordination report and visible response; parse the report strictly on return. Pass subprocess arguments as an argument array, never interpolated shell text. Runtime failures preserve safe diagnostics and the run ID.
- [ ] Integrate the async hub boundary. A request must finish or fail within 90 seconds. Preserve coding availability when coordination fails. Prove explicit checks first, then add debounced refresh on meaningful progress for the live demo.
- [ ] Run unit checks, `uv run flwr build`, and two real smoke tests: related alternative experiments with a shared constraint, and unrelated tasks. Inspect the report and completed run status; do not infer success merely from a created run ID.
- [ ] Commit with `feat(flower): propose evidence-backed coordination`.

**Done when:** the actual Flower result changes what a related ongoing agent knows, with source references and an observable response that uses the finding. Human approval still gates any work-redirection instruction. A static canned proposal or an animation alone does not satisfy this task.

**If time is short:** use the existing runtime model and keep the explicit check as a clearly labeled fallback while resolving the live trigger. Defer native Grid routing, automatic provider selection, a separate verifier agent, and local inference.

## Integration schedule

| Elapsed | All-team checkpoint |
| --- | --- |
| 0:00–0:25 | Agree scope/contracts, verify toolchains, fixed demo roster and connectivity. Each owner uses a separate checkout based on current remote main; it includes Serhat's reviewed README. |
| 0:25–0:45 | Talha proves OpenCode capture/input; Serhat supplies fixtures/API; Ferit proves Flower structured round trip; Serdar renders fixtures. Pair immediately on a blocked execution dependency. |
| 0:45–2:00 | Implement owned slices against frozen contract. Verify and integrate small working commits into main early; do not wait for polish to share interfaces. |
| 2:00–3:00 | First live slice: two alternative experiments -> hub -> Flower -> source-linked awareness note -> target agent adapts while still working. |
| 3:00–4:00 | Add the debounced meaningful-change trigger and test unrelated/private sessions, duplicate note delivery, and worker offline. Add approved redirection and decision reuse if the core loop works. |
| 4:00–5:00 | Freeze new features, integrate, rehearse, restart services, capture a clearly labeled backup recording of a genuine successful run. |
| Optional hour 6 | Fix defects and improve clarity. Add a stretch item only if the complete demo has succeeded twice. |

## Working agreement

- Read the spec and your task card before coding. Contract changes go through Serhat with all four owners informed; schema version changes require fixture updates.
- Each owner shares the working command, exact pushed commit, evidence of their checks, and known limitations. This document does not itself notify anyone or assign GitHub issues.
- Serhat coordinates integration order: contracts and fixtures first; hub, worker, Flower, and UI slices follow as their interfaces work. Check each slice before committing and pushing it to main; authors preserve another person's in-progress changes.
- Use separate local clones, all on main. Fetch before every integration. If a push is rejected because main advanced, merge the incoming commits, rerun affected checks, and push normally. Do not create a PR or feature branch.
- Each owner reserves the final hour for integration and testing. Ferit narrates the Flower run; Talha and Serhat operate the two demo workers; Serdar shows both experiments, the source-linked note, and the receiving agent's response.
- Checkpoints measure observed outcomes. A build, fixture response, live Flower run, and successful context delivery prove different things.

## Final acceptance rehearsal

1. Start two real, explicitly shared synthetic sessions in isolated workspaces, both owned by the same developer and labeled as alternatives for one frontend feature. Show distinct worker/session identities and ongoing status.
2. Keep one private session unshared and demonstrate that it does not appear in the hub or Flower input.
3. Show A exploring one design and B another. A discovers a relevant shared constraint; a completed Flower run cites A's source event without declaring either approach the winner.
4. Show B receive the source-linked awareness note at a safe boundary and respond by adapting its own approach. Repeat the same source revision and verify no second note appears.
5. Demonstrate that an unrelated or unshared session receives nothing. Disconnect a worker and show an honest offline/failure state.
6. If the core loop is stable, approve one proposed work-redirection action, choose an accepted decision, and retrieve it from a fresh session. Explain exactly which content left each machine and which model/runtime handled it.

GitHub Issues was disabled when this plan was written. These four task cards are ready to become issues if the repository owner enables that feature; GitHub handles and platform assignments are separate from the human ownership recorded here.
