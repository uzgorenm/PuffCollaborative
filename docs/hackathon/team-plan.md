# Puff Collaborative Implementation Plan

Ferit's isolated activity/Jev slice (`hackathon/flower/activity/`):

- [x] Deterministic event reduction, queued/start distinction, current-only summaries.
- [x] Injected Jev classification, real TypeSafe request path, debounce and bounded fallback.
- [x] Eight synthetic histories, selected/capped evidence, 16 passing unit tests.
- [ ] Serhat confirms C2/C3 sequence/selection mapping and C8 Flower input format.
- [ ] Agent 1 consumes the same evidence in a real Flower chain; no live claim yet.

See the activity README and `evidence/2026-09-29-activity-intelligence.md` receipt.

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans when implementing an approved owned slice. Steps use checkboxes. This plan assigns four human owners; coordinator review agents do not replace those owners.

**Goal:** One agent's new finding improves another agent's ongoing work while deliberate alternative frontend experiments remain separate.

**Architecture:** Existing OpenCode sessions and execution machinery feed the shared coordination backend. Flower agents exchange selected evidence and produce a source-linked awareness result. The backend validates and admits that context into the related existing Session at a safe boundary. The interface exposes sources, delivery stages and actual use.

**Tech stack:** Existing Bun/TypeScript, SolidJS, SQLite/Drizzle and EventV2; an isolated Python/uv Flower project using its compatible dependencies. Reuse the server and persistence already present in this fork.

**Spec:** [Product behavior](mvp-spec.md), [exact workflow cases](acceptance-workflows.md), [integration decisions](integration-gates.md). Progress and completion rules live in [progress-checklist.md](progress-checklist.md).

## Global constraints

- Four humans, 5–6 hours, one reliable live awareness flow. Two worker sessions may belong to the same person and must have isolated workspaces.
- The hackathon asks for multiple Flower Agents collaborating on SuperGrid. A single Flower smoke test is an intermediate checkpoint; WF10 and the submission gate remain required.
- Bun is pinned to 1.3.14. Use package-local tests and `bun typecheck`; do not run the root test script or invoke `tsc` directly.
- Flower bootstrap uses 1.39.0 where appropriate; thereafter use the generated project's compatible dependencies, lockfile and `uv run flwr ...`. Preserve the separately verified official template.
- Reuse the existing UI/runtime/database. No extra agent framework, replacement frontend, local Ollama setup or new database service.
- Use selected synthetic sessions for the demo. Never put credentials in source, logs, URLs, browser bundles, fixtures or FAB contents. Flower uses runtime-provided model access.
- The target session's existing runner retains tool permissions and workspace ownership. No second model loop or arbitrary remote shell endpoint.
- Main is the only shared development branch. Commit verified owned work, fetch/integrate incoming main and push normally. No PRs, feature branches, force-pushes or resetting another person's changes.
- Product behavior comes from the spec/workflows. Shared implementation signatures come from Serhat's [coordination contract](../coordination-contract.md), schemas and registered API. The earlier `/puff/v1`/standalone JSON-hub design is superseded as an implementation direction; do not create another backend to satisfy a provisional UI adapter.

## Ownership and first usable handoff

| Owner | Scope and file boundary | First usable result |
| --- | --- | --- |
| Serhat | `docs/coordination-contract.md`; shared coordination schema, protocol, server composition and core service modules under the boundaries in that contract | An agreed fixture and one authenticated real producer-to-consumer exchange |
| Talha | OpenCode runtime/session/workspace adapter behind the agreed runner port; coordinate edits to shared signatures through Serhat | One real selected source event and one context input promoted into an already active target Session |
| Serdar | `packages/app/src/pages/puff/`, `components/puff/`, minimal app navigation/route and i18n | Reachable real-data view that distinguishes alternatives and admission/promotion/use |
| Ferit | Isolated product Flower project, initially proposed at `hackathon/flower/`; classification/result adapter to the agreed backend job boundary | Actual Flower-agent exchange producing a validated source-linked result over the common evidence |

The six Agent roles inside the backend contract are Serhat's implementation subdivisions, not a reassignment of the four teammates. Respect those narrower write areas. Serhat owns shared schema/root dependency changes; Serdar owns shared UI entry points. Existing local UI work remains Serdar's work to commit.

## Review focus

1. A future queued task must not be mistaken for awareness during an active task: integration C4 and WF02.
2. Similar-looking alternatives must remain distinct; unrelated/private evidence must not route into them: C2/C3 and WF01/WF03.
3. Repeated jobs, delivery retries and acknowledgments must not create another visible input or analysis echo loop: C3/C7/C8 and WF04.
4. A late report or sharing change must invalidate pending context, with honest limits after admission: C7 and WF05.
5. A receipt, rendered fixture or successful Flower run must not be presented as agent use: C9 and WF02/WF06/WF10.

## Task 1 — Serhat: shared contract and service integration

**Consumes:** product cases, existing backend contracts, Talha's runner needs, Ferit's result shape and Serdar's UI needs. **Produces:** one authority for identities/records/routes, persistent state and events, validated routing, explicit failure states and consumer-ready fixtures. **Gates:** G0, G1, G4.

- [ ] Resolve C1–C9 with the consuming owners. Publish a contract commit covering topic/alternative/mute, evidence/cursor mapping, active awareness versus queued instructions, admission states and separate approval meanings.
- [ ] Correct the shared fixture's duplicate project sequence and add the same-owner alternatives/private/unrelated/stale/offline cases. Every consumer must read this shared fixture before adding its own assumptions.
- [ ] Implement one authenticated shared-state slice through schema → protocol → handler → real service. Generate clients according to root AGENTS.md; a route table and the current status-503 endpoint do not close the gate.
- [ ] Store permitted source events once, resolve destination ownership server-side, and validate real source references and current selection before creating a note. Exercise wrong actor/project/worker, old source and revoked target controls.
- [ ] Commit state/event/outbound intent consistently through the existing persistence/event layer. Exercise retry identity, lost responses, snapshot/replay consistency and explicit unavailable-adapter errors.
- [ ] Connect one actual analysis request/result and one target context admission with the other owners. Show the source-to-target identity chain; distinguish tool approval from a proposal to change work.
- [ ] Record relevant package tests, typechecks and real boundary evidence in the progress checklist before marking this slice done. Keep accepted-decision persistence secondary.

**Stop/go:** Serhat's API and each consumer must agree at G0. UI previews and analysis fixtures may progress while that agreement is pending, but cannot claim live integration.

## Task 2 — Talha: capture and active-session admission

**Consumes:** authoritative Thread/Session/worker binding, selected evidence policy and agreed context-admission port. **Produces:** real source capture, stable admission receipts, promotion evidence, cancellation/reconciliation boundaries. **Gates:** G1, G3, G4.

- [ ] Launch the actual supported runtime and record its version/path. Create A/B as isolated sessions with the same owner; record actual identities and B's initial plan.
- [ ] Capture one permitted A event and prove P's private marker never enters the shared export. Preserve exact event identity and the agreed source sequence mapping.
- [ ] Prove the existing session API can admit an attributed informational note while B is active. The candidate is explicit `steer` through existing admission; agree the signature with Serhat. Do not reserve a second Run or start a competing runner.
- [ ] Record admitted → promoted → used separately. A queued instruction that begins only after B's entire assignment ends does not pass WF02.
- [ ] Reconcile stable message IDs after a lost response; exact retry produces one input, changed payload/mode/target conflicts, ambiguity remains visible. Test mute/unshare and offline behavior at the agreed boundary.
- [ ] Run WF02 with Ferit's real result and the automatic trigger; record B's concrete use of the fresh source-only finding while keeping B's alternative approach. Have Serdar expose that evidence.

**Stop/go:** The first useful proof is active admission, not broad support for every API generation. If only idle queueing works, record that limitation immediately and keep G1/G3 open.

## Task 3 — Serdar: visible collaboration and human decisions

**Consumes:** current shared contract/fixture, real snapshots/events, delivery/use receipts and explicit action permissions. **Produces:** one reachable view in the existing app, source inspection, accurate state and human controls. **Gates:** G0, G3, G4, G5.

**Verified UI checkpoint:** [3f75718234 receipt](evidence/2026-09-29-serdar-ui.md) covers the responsive page, synthetic same-owner alternatives, source inspection, review/sharing controls, late updates and reconnect safeguards. Focused tests, typecheck/build and desktop/mobile walkthrough pass; full units retain one unrelated locale failure. The boxes below remain open where they require the common contract or real service/agent evidence. The next UI task is to consume Serhat's authoritative shared state and Talha's admission/promotion/use receipts after G0.

- [ ] Keep the local preview visibly synthetic while reconciling its provisional `/puff/v1` Bearer adapter with the actual service/auth contract. A renamed URL without matching schema/auth/service behavior is insufficient.
- [ ] Add and verify the page route/navigation. Render two alternative sessions with owner, approach, planned/ongoing/completed status, freshness and exact sources. Test the same-owner case, not just two different people.
- [ ] Show pending, admitted, promoted, failed/ambiguous and observed use separately. Never derive use from an approval, returned message ID, spinner completion or the canned preview response.
- [ ] Connect selection/topic/mute and source navigation to real identities. Keep unrelated/private sessions out of the authorized view; disable unavailable actions based on actual server outcomes.
- [ ] Exercise late source updates, edited/stale proposals, lost connection/reconnect and duplicate actions. Keep tool permission requests separate from work-redirection proposals.
- [ ] Run applicable app tests, package typecheck/build, then a real browser or desktop walkthrough. Record both visual evidence and the backend/agent evidence it depends on.
- [ ] Lead two fresh WF02 rehearsals and a 3–5 minute explanation of the real flow. Keep memory views/polish after the connected behavior works.

**Stop/go:** The UI can be fixture-complete while G3 remains open. A runnable page still needs a real source/result/target chain before being called a working collaboration feature.

## Task 4 — Ferit: actual Flower cooperation and useful findings

**Agent 1 checkpoint:** Two distinct AgentApp projects and the local chain adapter
are implemented in `hackathon/flower/`. Local source/unit/build evidence and the
blocked live attempt are recorded in the [Flower receipt](evidence/2026-09-29-flower-chain.md).
SuperGrid authentication must be refreshed before real result retrieval can be
verified. The requested provisional `ContextRequest`/`ProjectSnapshot` boundary
is explicit; mapping it to project `seq`, `Thread.activitySeq` and the current
job/result API still requires Serhat at C3/C8. No shared schema or Agent 2
`activity/`/`fixtures/` file is changed. The live checkboxes remain open.

**Consumes:** bounded selected evidence, explicit alternative labels, source IDs/sequences and stable job identity. **Produces:** version-compatible AgentApps, actual useful agent exchange, validated report and bounded errors. **Gates:** G2, G3, G4, G6.

- [ ] Inspect the product project's dependency declaration and preserve its compatible environment. Verify build and a small hosted result before adding detailed classification.
- [ ] Prove a useful exchange between actual Flower Agents on SuperGrid, such as analysis → coordination. Record participants, consumed intermediate result and terminal run/task evidence. A single greeting cannot close G2.
- [ ] Produce the shared structured report over A/B evidence. Distinguish intentional alternatives, suspected duplication, dependency and no relation; keep planned work distinct from completed results. Validate references without inventing facts or target authority.
- [ ] Publish a real result through Serhat's agreed boundary. Preserve request/run IDs and terminal/unknown failure states. Test invalid sources, stale results and the unrelated control.
- [ ] Add debounced meaningful-change analysis after the explicit pipeline works. Repeated polls, unchanged evidence and acknowledgments alone do not create additional paid runs or notes.
- [ ] Complete WF02 with Talha and Serdar, then WF10 and the team-owned Hub publication gate. Use only synthetic permitted evidence; never package session data or credentials in an app bundle.

**Stop/go:** An upstream runtime smoke test and a parsed fixture are intermediate evidence. The main deliverable is a real exchanged finding that reaches and changes an ongoing OpenCode session.

## Integration rhythm

Use the [25-minute coordination loop](progress-checklist.md#the-coordination-loop-during-the-build). First close G0 and prove the risky G1/G2 boundaries. Join them into G3 immediately; reserve the last hour for G4/G5 rehearsal and G6 submission. Record the exact current gate and blocker instead of advancing by elapsed time alone.

Each owner verifies only owned changes, then the consuming owner exercises the real handoff. Root/package AGENTS.md govern tests, generated clients and commits. The [acceptance workflows](acceptance-workflows.md) are the final check, not the number of checked implementation steps above.
