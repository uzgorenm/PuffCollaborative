# Puff team workspace

This is the team's shared task board and feature-status page. Detailed implementation checklists live in [team-plan.md](team-plan.md); behavior, acceptance criteria, and data contracts live in [mvp-spec.md](mvp-spec.md).

## Our tasks

**Ownership check pending:** Teammates are updating assignments in the root README.
Its latest edit assigns Serhat to the shared server, Talha to OpenCode execution,
and Serdar to Flower; the interface role is unnamed. The earlier assignments below
and in the detailed plan are awaiting reconciliation with those edits. Check the
[latest README delegation](../../README.md#task-delegation) before starting work.

| Task | Owner | Deliverable | Status | Verified commit / blocker |
| --- | --- | --- | --- | --- |
| T1 — OpenCode adapter | Serhat | Export selected session activity; deliver approved context to the correct existing session once. | Planned | No merged implementation verified yet. |
| T2 — Shared state and API | Ferit | Shared contract, worker/session records, approval checks, delivery queue, and durable decisions. | Planned | No merged implementation verified yet. |
| T3 — Flower coordinator | Serdar | Real SuperGrid summaries and source-linked overlap/dependency/reuse proposals. | Planned | Standalone template smoke test passed; product integration remains to be built. |
| T4 — Team interface | Talha | Session overview, proposal review, accepted decisions, and delivery/failure states. | Planned | No merged implementation verified yet. |

Open [the task checklists](team-plan.md) and find the numbered task with your name. Each has file ownership, inputs/outputs, acceptance checks, and a scope cut if time gets short.

Status reflects verified shared work on main, not unknown work in another person's local clone. Update your row to **In progress**, **Blocked**, or **Done** as appropriate. For Blocked, write the dependency/error; for Done, link the pushed commit and state the check that passed. Tick your detailed checklist at the same time.

## Our features

| ID | Feature | Main contributors | Priority | Status |
| --- | --- | --- | --- | --- |
| F1 | Selected shared sessions and activity | Serhat, Ferit, Talha | Required | Planned |
| F2 | Current summaries with source revisions | Serdar, Ferit | Required | Planned |
| F3 | Overlap, dependency, and reuse suggestions | Serdar | Required | Planned |
| F4 | Human-approved context handoff | Ferit, Serhat, Talha | Required | Planned |
| F5 | Durable, approved project memory | Ferit, Serdar, Talha | Required | Planned |
| F6 | Visible agent cooperation, run IDs, and failures | All four | Required | Planned |
| F7 | Automatic context checks at session start | Serhat, Serdar | Stretch | Deferred |
| F8 | Native Flower Grid worker queries | Serdar | Stretch | Deferred |

Read [feature acceptance criteria and contracts](mvp-spec.md) before implementing a feature. Summaries describe observed work; only human-approved decisions become accepted project knowledge.

## Shared workflow

- **One default branch: main. No PRs or feature branches.** Use a separate local clone for each person.
- Read this board and your task checklist before editing. Respect the file boundaries; Ferit owns shared schemas and root dependency changes, and Talha owns shared UI entry points.
- Make small, working commits. Verify your slice, fetch origin/main, merge incoming commits, rerun any affected checks, and push to main. Never force-push.
- Update this board and your checklist in the same commit as meaningful progress. Preserve other owners' status updates when integrating.
- GitHub Issues is disabled. This page is the task board; the spec is the feature list and contract reference.

## First checkpoint

Within 45 minutes: Serhat proves real session capture/input; Ferit publishes common fixtures and an API snapshot; Serdar proves a real Flower structured round trip; Talha renders the common fixture. By hour three, connect the complete flow. Reserve the final hour for integration and rehearsal.

## Demo to protect

Two separate coding sessions -> selected shared evidence -> a real Flower proposal -> human approval -> one attributed input into the target session -> a response using the new context. Then show an accepted decision being retrieved in a fresh session.

Keep the original workers, worktrees, and credentials in place. Sharing context is not permission for arbitrary remote commands.
