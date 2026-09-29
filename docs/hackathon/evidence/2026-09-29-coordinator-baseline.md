# Coordinator baseline — September 29, 2026

Result: product readiness **NOT VERIFIED**. Evidence kind: **SOURCE**, with previously recorded setup evidence noted separately.

Reviewed source: `e42a799cf6aefe1cc6d6907310b3ff8bf467ed43`, after fetching origin/main and fast-forwarding the local checkout while preserving unrelated unfinished UI files. Three review agents independently reviewed workflow behavior, contract integration and readiness. The coordinator checked their findings against the files below. No review agent started servers or performed a live product run.

## Observed progress

- [x] Reviewed the current root README, product spec, team plan, board and newer shared backend contract.
- [x] Located the merged scaffold introduced by `c7c6fde34a` and distinguished it from working feature services.
- [x] Located local UI work without staging or claiming it as integrated.
- [x] Identified concrete contract/behavior mismatches and assigned closure to [integration gates](../integration-gates.md).
- [x] Rechecked the public organizers' forum content through its JSON endpoint when the web renderer could not open the page. Multiple Flower Agents cooperating on SuperGrid, team-owned Hub publication, submission details and a 3–5 minute presentation are required by that brief. See the [official source](https://discuss.flower.ai/t/collaborative-agent-hackathon-stanford-ca-2026/1275).
- [ ] Reproduce real Puff session capture, Flower cooperation, active-session delivery and target-agent use.

## Backend at the initial e42a799cf6 snapshot

- [Protocol declaration](../../../packages/protocol/src/groups/coordination.ts) registers the coordination status endpoint.
- [Handler](../../../packages/server/src/handlers/coordination.ts) returns `ServiceUnavailableError`, with a different explanation for missing configuration versus missing adapters. This was verified by reading the code, not by starting the server.
- [Core contracts](../../../packages/core/src/coordination/contracts.ts) define interfaces, not feature implementations.
- [Shared schema](../../../packages/schema/src/coordination.ts) and [fixture](../../../packages/core/test/coordination/fixtures.json) provide initial records. The fixture assigns project sequence 3 to both `evt_tool` and `evt_card`; that conflicts with the documented project-global sequence and must be corrected through the contract owner.
- The [coordination contract](../../coordination-contract.md) explicitly says only status is registered and the remaining routes are reserved. Its opening claim of no implementation predates the scaffold; treat the implementation inventory above as this audit's evidence.

## Local UI: unfinished and provisional

At inspection, the checkout contained untracked Puff API/state/preview/test files and components, an untracked UI plan, and a modification to English i18n. The local file `packages/app/src/pages/puff/project-api.ts` targets `/puff/v1` with Bearer authentication; the current shared backend contract targets `/api/coordination/v1` with individual Basic credentials. No interoperability run was performed. Local untracked paths in this paragraph are observations, not published file links.

The local `packages/app/src/pages/puff/preview.ts` already contains a fictional target response, example run identity and delivered notes. It is presentation data. It cannot show that a real agent received or used a finding. Page/navigation code was being added to the local checkout during this review; no browser or desktop walkthrough was performed by the coordinator. These files belong to another ongoing UI task and may change after this snapshot; the coordinator did not edit or commit them.

## Historical Flower setup evidence

The separate local `FLOWER_SETUP.md` records upstream-template greeting run `12037878883441469089` with `finished:completed`. The root README also records that setup. This audit did not rerun it. It proves a previously working account/runtime path, not Puff analysis, multiple cooperating Flower agents, local-to-hosted integration, or publication of the team's app. No tracked `hackathon/flower` product implementation was found at this source checkpoint.

## Incoming source update through b5a0344b83

The checkout advanced during document review. The coordinator read the incoming diff and relevant source before finalizing this package:

- `05dcc5c762` adds authoritative `SessionBinding.resolve`, membership admission and the missing `Queue.runs`/`Runner.approvals` snapshot read declarations. The declaration gap is resolved; runtime composition remains unverified.
- `af5f812494`, `edc3c16889` and `b5a0344b83` add the [event-journal implementation](../../../packages/core/src/coordination/events/events.ts) and [test source](../../../packages/core/test/coordination/events/events.test.ts), including replay/stream/cursor and projection-failure cases. Test presence is observed; the coordinator did not execute them or claim their result.
- The status-only route registration, provisional UI API/auth mismatch and lack of a demonstrated active awareness/Flower chain remain open. The board credits the incoming implementation without closing a runtime gate.

## Incoming source update through 5c8e111931

A subsequent fetch/fast-forward brought shared access/projects/comments, runner/approval controls, transactional snapshot composition, broader protocol/auth declarations and related test sources. The coordinator checked the incoming file inventory, concrete snapshot/handler source, access/runner scope notes and relevant declarations. This was a targeted integration inventory, not a full code review or test run.

The protocol now declares more than the status route, superseding the earlier declaration inventory. The server handler file still implements only the unavailable-status response at this checkpoint. The runner README states that adapter tests use mocked dependencies and do not verify real OpenCode execution. The board now credits these service modules. The private/alternative/awareness contract, full HTTP composition and source→Flower→active-session use still require their named receipts.

## Checks and limits

Read-only commands used included `git status --short`, `git log`, `git show`, targeted `rg`/file reads and inspection of the relevant contracts and handlers. `command -v bun` returned no path in the audit shell; this does not establish whether another task has a separate local runtime.

No product tests, typechecks, builds, server requests, browser flow or Flower jobs were run by the review agents. The task board's earlier cleanup build/typecheck claims were left attributed to that earlier work. They do not verify the new coordination flow. GitHub Actions workflows have been removed.

The documentation check passed for all nine coordinator files: 86 relative links and heading anchors resolve to tracked or included files, ten workflow IDs and seven gate IDs are unique and complete, all four owners are present, and runtime gates remain unchecked. `git diff --check` passed for these files. An independent final review confirmed the incremental G0 handoff and fresh-session WF02 controls. These checks verify the planning package only.

This receipt closes the inventory review only. No core workflow case WF01–WF07 or readiness gate G0–G6 is marked passed on the strength of it.
