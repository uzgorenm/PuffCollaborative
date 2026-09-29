# Puff team workspace

This is the team's shared task board and feature-status page. Detailed implementation checklists live in [team-plan.md](team-plan.md); behavior, acceptance criteria, and data contracts live in [mvp-spec.md](mvp-spec.md).

## Our tasks

**Confirmed ownership:** Serhat — server; Talha — OpenCode execution; Serdar — interface/dashboard; Ferit — intelligence/Flower.

| Task | Owner | Deliverable | Status | Verified commit / blocker |
| --- | --- | --- | --- | --- |
| T1 — Shared state and API | Serhat | Shared contract, worker/session records, approval checks, delivery queue, and durable decisions. | Planned | No merged implementation verified yet. |
| T2 — OpenCode adapter | Talha | Export selected session activity; deliver approved context to the correct existing session once. | Planned | No merged implementation verified yet. |
| T3 — Team interface | Serdar | Session overview, proposal review, accepted decisions, and delivery/failure states. | Planned | No merged implementation verified yet. |
| T4 — Flower coordinator | Ferit | Real SuperGrid summaries and source-linked overlap/dependency/reuse proposals. | Planned | Standalone template smoke test passed; product integration remains to be built. |

Open [the task checklists](team-plan.md) and find the numbered task with your name. Each has file ownership, inputs/outputs, acceptance checks, and a scope cut if time gets short.

Status reflects verified shared work on main, not unknown work in another person's local clone. Update your row to **In progress**, **Blocked**, or **Done** as appropriate. For Blocked, write the dependency/error; for Done, link the pushed commit and state the check that passed. Tick your detailed checklist at the same time.

## Our features

| ID | Feature | Main contributors | Priority | Status |
| --- | --- | --- | --- | --- |
| F1 | Selected shared sessions and activity | Talha, Serhat, Serdar | Required | Planned |
| F2 | Current summaries with source revisions | Ferit, Serhat | Required | Planned |
| F3 | Overlap, dependency, and reuse suggestions | Ferit | Required | Planned |
| F4 | Human-approved context handoff | Serhat, Talha, Serdar | Required | Planned |
| F5 | Durable, approved project memory | Serhat, Ferit, Serdar | Required | Planned |
| F6 | Visible agent cooperation, run IDs, and failures | All four | Required | Planned |
| F7 | Automatic context checks at session start | Talha, Ferit | Stretch | Deferred |
| F8 | Native Flower Grid worker queries | Ferit | Stretch | Deferred |

Read [feature acceptance criteria and contracts](mvp-spec.md) before implementing a feature. Summaries describe observed work; only human-approved decisions become accepted project knowledge.

## Shared workflow

- **One default branch: main. No PRs or feature branches.** Use a separate local clone for each person.
- Read this board and your task checklist before editing. Respect the file boundaries; Serhat owns shared schemas and root dependency changes, and Serdar owns shared UI entry points.
- Make small, working commits. Verify your slice, fetch origin/main, merge incoming commits, rerun any affected checks, and push to main. Never force-push.
- Update this board and your checklist in the same commit as meaningful progress. Preserve other owners' status updates when integrating.
- GitHub Issues is disabled. This page is the task board; the spec is the feature list and contract reference.

## First checkpoint

Within 45 minutes: Talha proves real session capture/input; Serhat publishes common fixtures and an API snapshot; Ferit proves a real Flower structured round trip; Serdar renders the common fixture. By hour three, connect the complete flow. Reserve the final hour for integration and rehearsal.

## Demo to protect

Two separate coding sessions -> selected shared evidence -> a real Flower proposal -> human approval -> one attributed input into the target session -> a response using the new context. Then show an accepted decision being retrieved in a fresh session.

Keep the original workers, worktrees, and credentials in place. Sharing context is not permission for arbitrary remote commands.

## Repository setup

The [desktop cleanup](https://github.com/uzgorenm/PuffCollaborative/commit/19076859c4d43ef59c0ec96b3b4ad565d8927c10) retains the desktop app, shared UI, runtime, server, and SDK. It removes 14 unused workspace packages, 21 translated READMEs, and upstream publishing and hosting tooling. All 21 workspace type checks, the desktop build, and 42 server/API/SDK checks passed locally.
