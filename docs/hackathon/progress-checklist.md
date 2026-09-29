# Puff progress and verification

**Compact React sidebar:** source `1497e7cbbf` removes visible status words while retaining colored dots, tooltips, and accessible labels. Fourteen tests, typecheck, production build, and sidebar navigation pass. [Backend handoff receipt](evidence/2026-09-29-compact-web-sidebar.md). The interface remains a local demo pending backend wiring.

**Browser UI workflows (September 29):** Next.js/React source `0c002da6c9` adds person → total summary → sessions, project setup/task assignment, overlap choices, attributed finding reuse, and private local sessions at `apps/web`. Fourteen tests, package typecheck, production build, browser persistence/source-deduplication checks, and a 2:26 cursor walkthrough passed. [Evidence and limitations](evidence/2026-09-29-react-web-workflows.md). The interface is explicitly an interactive demo; no live-awareness, real-presence, or execution gate is closed by these checks.

**Main browser sidebar (September 29):** source `790518a2c9688e9fc1d09f3b6b02a29b965c7a03` adds the Stanford Hackathon project tree, personal threads, teammate sections, and rolling 90-minute summaries to `apps/web`; the separate `/puff` overview page is removed. Production builds, app typecheck, 47 browser tests, and desktop/mobile browser inspection passed. [Evidence and limits](evidence/2026-09-29-main-web-sidebar.md). Activity comes from demo or simulator sessions; WF01/WF02 and G5 remain open.

This is the coordinator's working checklist. A feature counts as progress when its behavior can be demonstrated with evidence. Use the [workflow cases](acceptance-workflows.md) to run the checks and the [integration gates](integration-gates.md) to resolve interfaces. Human ownership remains Serhat (server), Talha (OpenCode), Serdar (interface), Ferit (Flower).

## Current checkpoint

**Ferit — local producer/consumer checkpoint, September 29:** the Activity
producer now feeds the Flower chain adapter through one validated handoff, and
`python bridge_demo.py` walks a two-session, four-event synthetic history
through source-reference mapping into server-shaped WorkCard and awareness-note
candidates. This is a local adapter demonstration with a synthetic Flower
report. No test suite or live Flower run was performed for this checkpoint;
SuperLink was unreachable from the current environment. No backend write or
OpenCode delivery occurred. See
[`evidence/2026-09-29-ferit-activity-flower-bridge.md`](evidence/2026-09-29-ferit-activity-flower-bridge.md).

Earlier Activity/Jev component tests and eight synthetic histories are recorded
in [`evidence/2026-09-29-activity-intelligence.md`](evidence/2026-09-29-activity-intelligence.md).
C2/C3/C4/C8 and live workflow gates remain open.

Baseline reviewed on September 29 at source commit `e42a799cf6aefe1cc6d6907310b3ff8bf467ed43`, with incoming-source updates through `5c8e111931`. The [baseline receipt](evidence/2026-09-29-coordinator-baseline.md) distinguishes those inspections. Later changes need their own evidence.

| Area | Evidence available at the baseline | Next demonstrable result |
| --- | --- | --- |
| Serhat — server | Incoming commits add access/projects/comments, runner/approval controls, journal, snapshot composition, protocol declarations and test source. The handler file still supplies only status-503; no integrated run or tests were executed by this audit. | One agreed awareness contract consumed by all three other workstreams, then actual authenticated service behavior. |
| Talha — OpenCode | Existing upstream session machinery is present; no Puff-specific runner integration was demonstrated in this audit. | Capture A's real selected activity and admit an attributed note into an already active B session. |
| Serdar — interface | Uncommitted adapter, state tests, synthetic preview and components are visible locally; page/navigation work continued during the review. No live walkthrough is evidenced here. | A reachable page consuming the agreed service; show source, admission, promotion and agent use separately. |
| Ferit — Flower | A prior upstream-template greeting on SuperGrid is recorded. No real Puff awareness exchange is evidenced here yet. | Actual Flower-agent cooperation returning a validated finding about A and B. |

**Gate result at this checkpoint: 0 of 7 gates below closed.** This is an evidence count, not a claim that nobody has worked. **Core behavioral cases: 0 of WF01–WF07 have a passing receipt in this audit.** The table above gives partial implementation credit without declaring the product ready.

CI workflows have been removed. A push does not run a readiness check automatically. Earlier repository cleanup builds/typechecks are historical evidence for that earlier change, not for live coordination.

## UI checkpoint — September 29, 12:32 PDT

Serdar's [UI receipt](evidence/2026-09-29-serdar-ui.md) records source/unit/fixture evidence at `3f7571823468fba62e86810e16ddc0b5f13a9b44`: reachable responsive `/puff`, explicit synthetic/development labels, source inspection, review/edit/reject, sharing controls and pending/reconnect safeguards. Eighteen focused tests, 41 browser-condition tests, typecheck and build pass. Full units: 736 pass, one unchanged locale-detection failure. Desktop/mobile browser walkthroughs and screenshots are recorded.

This adds implementation evidence to T3; it closes no live gate or WF01–WF07 case. G0 still needs the shared snapshot/actions/identity mapping, and G3/G5 need actual admission, promotion and agent-use receipts. The default connection checks the registered Basic-auth status route; the provisional API is development-only. A second teammate has not yet reproduced this receipt.

## Coordination backend checkpoint — September 29, 12:44 PDT

The [backend mock integration receipt](evidence/2026-09-29-coordination-backend-mock.md) is tied to pushed commit [`4124e1a`](https://github.com/uzgorenm/PuffCollaborative/commit/4124e1a). It records the registered `/api/coordination/v1` handlers, individual Basic identities, real SQLite/EventV2 persistence, a two-client HTTP flow, restart reads, migrations, generated client and the explicit mock runner. The core coordination suite passed 39 tests; the server integration passed seven consecutive 51-assertion runs after an ordering assumption was fixed. This is an integrated multiplayer backend result with a mock execution port. It does not close G0 or a WF01–WF07 case because the Puff awareness contract, real OpenCode execution and Flower pipeline have not been exercised together.

## Coordination process checkpoint — September 29

The [process test receipt](evidence/2026-09-29-coordination-process-e2e.md) tests commit `e83a0bb71203c14c3ad996ea155187ad5453763d` through real HTTP and SQLite with a separate fake runner process. The smoke test, typecheck, existing mock integration test, fresh initialization and preceding-schema migration passed. The broader suite had eight passing cases and one failing regression: `run.output` commits without advancing `Thread.activitySeq`, preventing a source-cited work card for that output. Seed `12648430` completed 100 accepted instructions across 20 threads, with five queued cancellations and 95 starts.

The [activity revision recheck](evidence/2026-09-29-coordination-activity-revision.md) at `b3eeb0c` passed all nine process cases and 1,084 assertions, including the previously failing work-card citation. The separate in-process mock HTTP test passed 51 assertions. These results use fake execution; real OpenCode execution and the Puff awareness exchange remain unverified.

The [content revision recheck](evidence/2026-09-29-coordination-content-revision.md) at `8bf5459` passed the focused SQLite freshness and comment tests (2 tests, 26 assertions) and all nine process cases (1,084 assertions). Content events now advance `Thread.activitySeq`; queue, lifecycle and card events keep their project cursor without changing that revision. The process worker remains fake.

The [activity-feed receipt](evidence/2026-09-29-coordination-activity-feed.md) verifies the `run.output` read-model projection with fixture events at `a0ee1dd` (3 tests, 16 assertions) and authenticated HTTP delivery at `c2f24b5` (1 focused process case, 14 assertions). Real runner output in the live view remains to be checked.

The [recovery isolation receipt](evidence/2026-09-29-coordination-recovery-isolation.md) at `204d9d6` verifies that an unverifiable Run holds its own Thread without blocking another Thread of the same worker. A focused Queue/SQLite regression passed 13 tests and 66 assertions with a mocked execution port. The full HTTP process suite passed 9 cases and 1,088 assertions with a separate fake runner, including reserved delivery after disconnect and exact recovery on reconnect. The retained OpenCode process has separate evidence below.

## Runner process checkpoint — September 29

The [runner integration receipt](evidence/runner-2026-09-29-r13-integration.md) tests commit `a694a8f3a4d3763c4c447e9ccaea8b7e2a45ac93` with pinned OpenCode, the embedded coordinator, SQLite, isolated Git worktrees and a deterministic local model. Two process cases passed with 93 assertions. They cover Session and workspace continuity, concurrent Threads, native tool approval and a write, authenticated callbacks, an uncertain cancellation held through restart while another Thread completes, and ordered callback recovery after a typed outage. R1 and Agent 1 independently repeated both cases at published `46dc9e8` with 93 assertions; Agent 1 also passed server typecheck. The [Agent 1 recheck](evidence/2026-09-29-coordination-real-runner-recheck.md) records its evidence boundary. The local model spent no credits. The receipts keep component, process and external deployment evidence separate.

These checkpoints do not close G0 through G7 or WF01 through WF10. Selected activity export, awareness admission into an already active Session, frontend use and the Jev/Flower exchange still need their own receipts.

## Rules for checking a box

**Later backend quality checkpoint:** [receipt at `dec2fb31c0`](evidence/2026-09-29-backend-quality.md) records 17 passing local integration tests, 177 assertions, core typecheck and independent source review for atomic activity revisions and overlapping comment retry. The same checks passed again in a clean publication checkout. This is partial implementation evidence for G4/F2; live gates remain open, and `run.output` inclusion in the separate activity feed is a follow-up.

**Later source-inspection checkpoint:** [receipt at `e332cbf539`](evidence/2026-09-29-source-inspection.md) records exact inline citation lookup, original-attempt tool-decision retry and real Session identity. Coordinator checks passed 67 focused tests, 46 browser tests, app/desktop typechecks and app build. Native N1/N2/N3 acceptance and live WF02/WF10 remain open; a synthetic HTTP response is not a Flower delivery receipt.

**Native backend preview:** [receipt at `3147b79f2f`](evidence/2026-09-29-desktop-backend-preview.md) records the Electron desktop connected to the registered coordination service. Two shared Session records appeared separately; an instruction submitted from the desktop queued and completed through the mock runner, and its exact source event was inspected. App, desktop and server typechecks passed; 56 focused app tests and the 51-assertion server integration passed. This preview does not close WF01–WF10 or G0–G7. Live awareness and Flower exchange remain open.

**Flower checkpoint — September 29:** Agent 1's
[receipt](evidence/2026-09-29-flower-chain.md) records two separate AgentApp builds,
local boundary/lifecycle checks and a blocked synthetic SuperGrid attempt.
Authentication failed before run IDs were returned. G2/WF10 remain open; no
live collaboration or publication is claimed. Serhat's C3/C8 mapping is still
needed before the provisional input/output adapter can be called integrated.

- `PASS`: the stated behavior passed at the receipt's code version and required evidence level. Check its box and link the receipt.
- `NOT RUN`: no matching evidence. Leave unchecked even if code or fixtures exist.
- `FAIL`: a run contradicted the expectation. Record actual behavior and the next fix.
- `BLOCKED`: name the missing dependency and its owner. Do not call a missing adapter a product success.
- A source review, a unit test, a fixture preview, an integrated service run, and a live Flower/OpenCode run prove different things. Label each receipt with the actual kind.
- Mark a gate complete only after every check within it passes. Reopen affected checks after relevant code, configuration, contract, or model/prompt changes; unchanged documentation does not invalidate runtime evidence.
- A coordinator or a second teammate checks the receipt before the gate closes. The reviewer records only what they observed or could reproduce. Another agent's claim is not itself a receipt.

## G0 — The pieces agree on one interface

**Lead: Serhat. Review: Talha, Serdar and Ferit at their own boundaries. Status: BLOCKED by contract differences.**

- [ ] Agree the interface decisions in [integration gates](integration-gates.md), especially API/auth, evidence sequence meaning, missing awareness records, and active-session admission. Record the exact shared contract commit and any explicitly deferred secondary operations. C1–C9 are review dimensions; their later runtime checks are owned by G1–G5, not prerequisites for closing G0.
- [ ] All consumers read the same synthetic fixture without private field renaming. It represents one owner, two alternative frontend sessions, one private session, one unrelated topic, and pending/stale/failed awareness.
- [ ] Prove one minimal authenticated producer/consumer exchange through a registered route, handler, service and matching client. Record the agreed but still pending operations for G1–G5. A route table or the status-503 scaffold alone is insufficient; the whole application need not be finished for this first handoff.

**Close with:** contract commit, fixture validation results from each consumer, and the minimal actual authenticated request/response trace. No credentials in the receipt. All routes used by the final demo must be real by G5; unused secondary/reserved APIs may remain unimplemented and disabled.

## G1 — Real sessions expose and receive the right context

**Lead: Talha. Support: Serhat. Status: NOT RUN.**

- [ ] Two real sessions in isolated workspaces, both owned by Serdar in the test, remain identifiable and actively work on different alternatives. Record session IDs and source revisions/sequences.
- [ ] Only selected activity leaves A. A private session and an unrelated selected session cannot become recipients for A's topic. Show at least one forbidden source and one forbidden target being excluded.
- [ ] Prove the actual session API can admit context while B is active, promote it at a safe boundary, and preserve one runner. Do not substitute a new task that begins after B finishes. Verify stable-ID retry with no second visible input.

**Close with:** real source event, target's pre-existing active state, admission receipt, transcript promotion, and repeat-delivery result. This gate proves transport, not that B used the finding.

## G2 — Flower agents actually cooperate

**Lead: Ferit. Support: Serhat. Status: NOT RUN.**

- [ ] A real SuperGrid exchange includes multiple Flower Agents and a useful intermediate result: one agent's output is consumed by another in producing the awareness result. Record participating identities and correlated task/run/message evidence.
- [ ] The final result cites the supplied A/B evidence, preserves both alternative approaches, and distinguishes ongoing work from completed work. Unknown sources and an unrelated control produce no actionable note.
- [ ] Polling/retrying an existing job does not start another paid run. Preserve unresolved remote-run state rather than silently launching replacements.

**Close with:** WF10's collaboration evidence, actual validated report, terminal run state, and control result. A greeting, two independent model calls, or two OpenCode sessions plus one Flower agent is insufficient for this gate.

The [organizers' brief](https://discuss.flower.ai/t/collaborative-agent-hackathon-stanford-ca-2026/1275) allows agent chains as well as context/handoffs between AgentApps. Native Grid transport is a choice, not a separate mandatory feature. Use project-compatible Flower dependencies and runtime-provided model access; no new local model setup is needed for this checklist.

## G3 — A finding changes another agent's ongoing work

**Lead: all four. Final receiving-session proof: Talha. Status: NOT RUN.**

- [ ] Pass WF01: one owner's compact and expanded frontend experiments remain distinct. No agent or summary chooses, merges, cancels or declares one redundant merely because they look similar.
- [ ] Pass WF02 with a fresh A-only fact introduced after B starts. Trace source event → Flower exchange/result → validated note → stable target message → promotion → B's concrete use, while B retains its alternative approach.
- [ ] Run the final version with an automatic meaningful-progress trigger. An explicit Check context button may establish the pipeline first, but does not close the automatic-awareness check. Show event, report and promotion timestamps; do not describe measured latency as instantaneous.

**Close with:** one complete live evidence chain and B's prior/after behavior. Copying the finding into B manually, preloading it in B's prompt, a canned preview response, or a delivery receipt without use fails this gate.

## G4 — The loop stays bounded and respects context

**Lead: Serhat. Support: Talha, Ferit, Serdar. Status: NOT RUN.**

- [ ] Pass WF03: accidental duplication can be suggested with sources; similarly worded but unrelated work receives no actionable cross-session update.
- [ ] Pass WF04: repeated source input, repeated requests, five polls, delivery retry and a plain acknowledgment create no duplicate visible note or acknowledgment ping-pong.
- [ ] Pass WF05: newer evidence, mute, unshare and topic changes prevent pending obsolete notes from being admitted. Document the claimed/in-flight boundary; never promise to retract context an agent has already consumed.
- [ ] Pass WF06: Flower failure and an offline target do not become success, coding remains usable, and retry waits for the previous run's known terminal outcome.
- [ ] Pass WF07: unknown evidence and instructions disguised as awareness cannot authorize redirection; a non-owner cannot approve it. The UI distinguishes a tool permission request from a proposal to change work.

**Close with:** case receipts and relevant deterministic tests/fault-injection results, labeled with their evidence level. Include the actual target transcript or admission ledger where absence of an extra input is the expected result.

## G5 — A person can understand and repeat the live demo

**Lead: Serdar. Support: all four. Status: NOT RUN.**

- [ ] Reach the real page through app navigation and use real service data. Show owner, approach, planned/ongoing/completed state, freshness, sources, Flower participants/results, and the receiving response. Fixture mode stays visibly labeled.
- [ ] Distinguish pending, admitted, promoted, failed/ambiguous and used. Displaying an approval or message ID alone must not imply that an agent consumed or acted on the update.
- [ ] Run the main workflow twice from a known pushed version using fresh A/B sessions and isolated workspaces each time, with a fresh source-only constraint as specified in WF02. Record both receipts; ensure neither run depends on previous shared context, accepted memory, cached answers or synthetic preview.
- [ ] Explain the problem, why agents have separate resources, what crosses the boundary, what Flower contributes, and who chooses an approach within a 3–5 minute rehearsal. Capture a clearly labeled backup recording of a genuine successful run.

**Close with:** a browser/desktop walkthrough, two live run receipts, and a timed demo recording or observed rehearsal. A production build is useful evidence but cannot replace the interaction walkthrough.

## G6 — The team can submit what it demonstrated

**Lead: Ferit for Hub; Serdar as coordinator for submission. Status: NOT VERIFIED.**

- [ ] Publish the team's working AgentApp on Flower Hub, record its public link and version, and verify that the published version can run. Using an upstream template is not publication of the team's app.
- [ ] Record confirmation that team details, short project description and repository link were submitted. Keep personal email addresses and account credentials out of source and evidence files.
- [ ] Confirm the submitted/public version matches the demo and accurately describes any manual fallback or incomplete feature. Finish WF10's publication check.

**Close with:** public Hub link/version, matching source commit, run evidence and a non-sensitive submission receipt. Requirements source: [official submission instructions](https://discuss.flower.ai/t/collaborative-agent-hackathon-stanford-ca-2026/1275).

## After the protected flow works

- [ ] WF08: human-approved work redirection with exact version/text/target, rejection, edits and retry handling.
- [ ] WF09: accept, retain, supersede and retrieve a project decision in new and ongoing sessions.
- [ ] F7: automatically retrieve accepted context when a fresh session starts.
- [ ] Improve visual polish or add another worker only after G0–G5 have evidence.

These do not compensate for a failing live-awareness gate. No overall percentage should hide a failed G3 or a missing Flower collaboration/submission requirement.

## The coordination loop during the build

1. **Choose the next unfinished gate.** Each owner names one demonstrable output and the person who consumes it. Keep the first target small: one contract, one source event, one real report, one admitted note.
2. **Work within ownership.** Serhat owns the shared backend contract/composition; Talha owns OpenCode execution; Serdar owns UI; Ferit owns analysis/Flower. The six “Agent” roles in the backend contract are Serhat's internal subdivisions, not additional human teammates.
3. **At each roughly 25-minute checkpoint, report:** pushed SHA or explicit local-only state; case/gate; command or action performed; actual result; evidence link; blocker and owner; next concrete result. No “80% done” without an observable behavior.
4. **Integrate the boundary immediately.** Producer and consumer inspect the same fixture/real record. If auth, fields, IDs or timing disagree, reopen G0 before either side adds more assumptions. Keep a UI fixture usable but visibly separate from live data.
5. **Run the named case and write a receipt.** A different teammate or coordinator reviews the result. Update this checklist and the [team board](README.md) in the same verified commit; preserve other people's unfinished files.
6. **Publish through main.** Commit only owned changes, fetch, integrate incoming main, rerun affected checks, then push normally. No PRs, additional development branches, force-pushes or resetting a teammate's work.
7. **Cut scope in order when time tightens:** full transcript mirroring/animation → extra workers → persistent memory/automatic startup → extra platforms. Protect real Flower cooperation, live delivery/use, accurate boundaries and one repeatable demo.

This is a manual workflow the team can run now. It does not schedule background checks or claim visibility into another person's unpushed work.

## Evidence receipt template

Create `docs/hackathon/evidence/YYYY-MM-DD-HHMM-CASE.md` for a run. Use only synthetic project material and redact credentials. Link to exact source commits or stable artifacts; avoid copying entire conversations.

```markdown
# WF02 / G3 — short observed result
Date/time and timezone:
Result: PASS | FAIL | BLOCKED
Evidence kind: SOURCE | UNIT | FIXTURE | INTEGRATION | LIVE
Owner and reviewer:
Code SHA(s), dirty-file caveat, relevant configuration/model/app version:
Case version and fresh synthetic marker:
Exact commands or UI actions:
Expected result:
Actual result:
Source event + sequence/revision:
Flower agent identities, request/run/task IDs and terminal states:
Note/delivery ID, exact target Session and stable message ID:
Admission observed:
Promotion into target context observed:
Agent use observed (before/after plan/check/artifact with source):
Latency timestamps and duplicate/job/message counts:
Artifacts/log excerpts (sanitized):
What this proves and what it does not:
Next action and owner if not PASS:
```

For a source/unit-only gate, mark irrelevant runtime fields `not exercised`; do not fill them with example IDs. A fixture containing `example-flower-042` is never a live run receipt.

## Serdar desktop checkpoint — September 29

Native/UI code `f4c8ad9ee4f9c9e411e161e6ea6980099ecc85c0` on serdar/ui: session rail, original coding composer/tools/inline diff, exact-bound panel and motion; focused checks/builds/production comparison recorded in [native receipt](evidence/2026-09-29-serdar-native.md). Full app suite retains one known Punjabi locale failure. Actual native rendering uses synthetic fixtures plus external mock-backed coordination service. Final independent D01–D06 retest remains in the QA receipt; this does not close live WF02/WF10 or sharing/export/awareness contract gates. No main integration by the UI lead.


**Native error-reuse correction:** [receipt](evidence/2026-09-29-error-fix-reuse.md) at UI code `d9609a30aa` records 71 focused app checks, 47 browser checks, typecheck/build and 13 real HTTP client/backend checks with actual isolated patch/test execution. Error reuse and grouped people are test-backend complete; real selected worker fix reports and live Flower discovery remain open. No live gate is closed by these checks.
