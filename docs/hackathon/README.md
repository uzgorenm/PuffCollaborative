# Puff team workspace

This is the team's shared task board. **Start with the [progress checklist](progress-checklist.md)** to see what is evidenced and what blocks the next working flow.

**Native error-reuse correction:** `d9609a30aa` adds automatic error matching, Inspect / Apply fix / No thanks, exact source/revision rechecks, application receipts, and person -> aggregate summary -> sessions in the desktop. The internally synthetic backend applies a real patch to a disposable workspace and runs its tests; the live producer/Flower boundary remains open. [Verification receipt](evidence/2026-09-29-error-fix-reuse.md).

**React backend handoff:** the compact sidebar uses colored status dots with hover/accessibility labels. Source `1497e7cbbf` preserves incoming main and passes 14 tests, typecheck, build, and browser interaction checks. [Receipt and backend integration boundary](evidence/2026-09-29-compact-web-sidebar.md). The React workspace is ready for teammates to connect its local demo actions to the authoritative backend; live gates remain open.

**React browser workflows:** [`apps/web`](../../apps/web/README.md) now groups each person's total work above their individual sessions, with guided setup/task assignment, overlap choices, source review/reuse, private sessions, and an original Puff logo. Source `0c002da6c9` passes 14 tests, package typecheck, production build, and observed browser workflows; [receipt and 2:26 video details](evidence/2026-09-29-react-web-workflows.md). The interactive state and responses are explicitly local demo examples. Real presence and execution remain unconnected; this does not close the live workflow gates.

**Main web sidebar update:** source `790518a2c9688e9fc1d09f3b6b02a29b965c7a03` groups personal threads and each teammate's recent work under the Stanford Hackathon project in the main browser app. The separate `/puff` overview page was removed. [Verification receipt](evidence/2026-09-29-main-web-sidebar.md). The activity remains demo or simulator data; live workflow gates are unchanged.

**OpenCode activity sidebar:** source `dac982301277871c5371f0e2dda02747bcb7e5ea` adds the coordination API activity panel to the OpenCode shell and classic project sidebar. App typecheck, build, and browser rendering passed. The coordination API was unavailable in the browser check, so credentials and live activity remain unverified; no workflow gate is closed. [Receipt](evidence/2026-09-29-opencode-team-activity-sidebar.md).

**Desktop unblock:** the [startup integration receipt](evidence/2026-09-29-desktop-startup-integration.md) records the retained-host repair and independent checks. Follow [desktop access ownership](desktop-coordination.md) so simultaneous chats do not control the same app or push conflicting changes.

**Current development:** [chat assignments and handoffs](next-development.md) track the ongoing frontend work, isolated Project overview scope and backend integration. The [backend quality receipt](evidence/2026-09-29-backend-quality.md) records verified activity-revision and exact-comment-retry fixes at `dec2fb31c0`. These checks do not close live-awareness gates.

**Source-inspection checkpoint:** `e332cbf539` adds exact inline evidence inspection, distinct Session identities and recovery of uncertain tool-decision delivery. The [UI receipt](evidence/2026-09-29-source-inspection.md) records 67 focused and 46 browser tests, typechecks and build; native acceptance is the next QA task.

**Native backend preview:** the [desktop receipt](evidence/2026-09-29-desktop-backend-preview.md) records an Electron window connected to the registered coordination API, two shared Session records, a completed mock runner instruction and exact source inspection at `3147b79f2f`. Run it with `bun run demo:desktop`. Model, Flower and live awareness gates remain open.

- [Ten concrete acceptance workflows](acceptance-workflows.md): exact scenarios, expected behavior and failure controls.
- [Integration gates](integration-gates.md): shared contract decisions and producer/consumer handoffs.
- [Owner checklists](team-plan.md): the next verifiable result for each teammate.
- [Product spec](mvp-spec.md): required behavior; [shared backend contract](../coordination-contract.md): current implementation interfaces.

## Our tasks

**Confirmed ownership:** Serhat — server; Talha — OpenCode execution; Serdar — interface/dashboard; Ferit — intelligence/Flower.

| Task | Owner | Deliverable | Status | Verified commit / blocker |
| --- | --- | --- | --- | --- |
| T1 — Shared state and API | Serhat | Shared topics/evidence, validated awareness routing, state and events. | Process HTTP suite passes with fake runner; awareness integration open | The [recovery isolation receipt](evidence/2026-09-29-coordination-recovery-isolation.md) at `204d9d6` records nine passing process cases, including concurrent work, replay, restart and a 20-thread drain. The [activity-feed receipt](evidence/2026-09-29-coordination-activity-feed.md) covers authenticated `run.output` delivery. An [independent runner recheck](evidence/2026-09-29-coordination-real-runner-recheck.md) also passed; the Puff awareness contract and G0 remain open. |
| T2 — OpenCode adapter | Talha | Export selected activity; admit awareness into an already active Session and reconcile retries. | Runner execution verified with a local model; awareness admission open | The [runner integration receipt](evidence/runner-2026-09-29-r13-integration.md) at `a694a8f` records two passing process cases and 93 assertions with pinned OpenCode, persistent workspaces and Sessions, approval, cancellation and restart. R1 and Agent 1 repeated both cases at published `46dc9e8` with 93 assertions; [Agent 1's receipt](evidence/2026-09-29-coordination-real-runner-recheck.md) records the server typecheck. G1 and WF02 still need selected activity and admission into an already active Session. |
| T3 — Team interface | Serdar | Show distinct experiments, inspectable evidence and admission/promotion/use. | Native desktop connected to the backend with a mock runner; main browser sidebar verified with demo data; final independent QA and live awareness open | `beab6436ea` integrates UI `f4c8ad9ee4` with the repaired main backend. Original coding sessions remain beside an identity-bound context panel. [Native receipt](evidence/2026-09-29-serdar-native.md); [integrated verification](evidence/2026-09-29-main-desktop-checkpoint.md); [desktop/backend preview](evidence/2026-09-29-desktop-backend-preview.md); [main web sidebar](evidence/2026-09-29-main-web-sidebar.md). G0/G5 and live WF02 remain open. |
| T4 — Flower coordinator | Ferit | Real cooperating Flower agents distinguish alternatives and produce a usable finding. | Guardian mode and chain run live on SuperGrid (synthetic input); live server/OpenCode run open | Agent 1: two AgentApps, validated host handoff, bounded adapter and local checks under `hackathon/flower/`. [Receipt](evidence/2026-09-29-flower-chain.md): SuperGrid authentication rejected the synthetic attempt; no Puff run IDs returned. G2/WF10 remain open; C3/C8 need Serhat's authoritative mapping. No publication attempted. |

Open [the task checklists](team-plan.md) and find the numbered task with your name. Each has file ownership, inputs/outputs, acceptance checks, and a scope cut if time gets short.

Status distinguishes merged work, explicitly observed local work and unverified integration. The [baseline receipt](evidence/2026-09-29-coordinator-baseline.md) names the inspected commit and limits. For **Blocked**, name the dependency/owner; for **Done**, link a pushed commit and passing workflow receipt. Update the progress checklist at the same time. Do not infer another person's progress from absent commits.

## Our features

Ferit's activity/Jev slice: **unit/fixture verified, integration pending**. Separate
implementation in `hackathon/flower/activity/` includes deterministic cards,
bounded refresh scheduling, injected/real Jev clients, and selected evidence.
See its README for C2/C3/C8 contract questions. This does not close G2/WF10 or
claim Agent 1's Flower chain is integrated. Exact receipt follows in
`evidence/2026-09-29-activity-intelligence.md`.

| ID | Feature | Main contributors | Priority | Status |
| --- | --- | --- | --- | --- |
| F1 | Selected related sessions and activity | Talha, Serhat, Serdar | Required | Planned |
| F2 | Current approach/progress summaries with source revisions | Ferit, Serhat | Required | Planned |
| F3 | Alternative/duplicate/dependency/reuse detection | Ferit | Required | Planned |
| F4 | Live awareness inside an ongoing agent; approval for work redirection | Serhat, Talha, Serdar | Required | Planned |
| F5 | Durable, approved project memory | Serhat, Ferit, Serdar | Secondary | Planned |
| F6 | Visible agent cooperation, run IDs, and failures | All four | Required | Planned |
| F7 | Automatic context checks at session start | Talha, Ferit | Stretch | Deferred |
| F8 | Native Flower Grid worker queries | Ferit | Stretch | Deferred |

Read the [feature acceptance criteria](mvp-spec.md) and [workflow cases](acceptance-workflows.md) before implementing. Feature completion is not established by the partial workstream progress above. F1–F4/F6 are evidenced by WF01–WF07; F5 by WF09. Multiple-Flower cooperation is separately required by WF10 even while the particular native-Grid option F8 remains stretch.

## Shared workflow

- **One default branch: main. No PRs or feature branches.** Use a separate local clone for each person.
- Read this board and your task checklist before editing. Respect the file boundaries; Serhat owns shared schemas and root dependency changes, and Serdar owns shared UI entry points.
- Make small, working commits. Verify your slice, fetch origin/main, merge incoming commits, rerun any affected checks, and push to main. Never force-push.
- Update this board and the [progress checklist](progress-checklist.md) with a named gate/case and evidence receipt in the same commit as meaningful progress. Preserve other owners' status updates when integrating.
- GitHub Issues is disabled. This page is the task board; the spec is the feature list and contract reference.

## First checkpoint

Within 45 minutes: Talha proves real session capture/input; Serhat publishes common fixtures and an API snapshot; Ferit proves a real Flower structured round trip; Serdar renders the common fixture. By hour three, connect the complete flow. Reserve the final hour for integration and rehearsal.

## Demo to protect

One person runs two opted-in coding sessions exploring different approaches to the same frontend feature -> both see each other's current approach -> one finds a constraint relevant to both -> Flower produces a source-linked update -> the other active agent receives it at a safe boundary and visibly adapts. The person chooses an approach and approves any work-redirection instruction. Show a saved decision in a fresh session if the core flow is stable.

Keep the original workers, worktrees, and credentials in place. Sharing context is not permission for arbitrary remote commands.

## Repository setup

The [desktop cleanup](https://github.com/uzgorenm/PuffCollaborative/commit/19076859c4d43ef59c0ec96b3b4ad565d8927c10) retains the desktop app, shared UI, runtime, server, and SDK. It removes 14 unused workspace packages, 21 translated READMEs, and upstream publishing and hosting tooling. All 21 workspace type checks, the desktop build, and 42 server/API/SDK checks passed locally. GitHub Actions workflows have been removed; run checks locally.
