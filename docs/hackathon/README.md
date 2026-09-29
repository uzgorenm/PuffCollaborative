# Puff team workspace

This is the team's shared task board and feature-status page. Detailed implementation checklists live in [team-plan.md](team-plan.md); behavior, acceptance criteria, and data contracts live in [mvp-spec.md](mvp-spec.md).

## Our tasks

**Confirmed ownership:** Serhat — server; Talha — OpenCode execution; Serdar — interface/dashboard; Ferit — intelligence/Flower.

| Task | Owner | Deliverable | Status | Verified commit / blocker |
| --- | --- | --- | --- | --- |
| T1 — Shared state and API | Serhat | Shared session topics, current activity, source-linked awareness delivery, approval checks, and durable decisions. | Planned | No merged implementation verified yet. |
| T2 — OpenCode adapter | Talha | Export selected activity; deliver relevant awareness at a safe turn boundary and approved instructions to the correct session. | Planned | No merged implementation verified yet. |
| T3 — Team interface | Serdar | Show simultaneous experiments, progress, source-linked updates, decisions, and delivery/failure states. | Planned | No merged implementation verified yet. |
| T4 — Flower coordinator | Ferit | Real SuperGrid summaries that distinguish parallel alternatives from duplicates and find shared constraints. | Planned | Standalone template smoke test passed; product integration, multiple-Flower-agent collaboration, and our own Hub publication remain unverified. See the [official brief review](../../README.md#official-hackathon-requirements-and-readiness). |

Open [the task checklists](team-plan.md) and find the numbered task with your name. Each has file ownership, inputs/outputs, acceptance checks, and a scope cut if time gets short.

Status reflects verified shared work on main, not unknown work in another person's local clone. Update your row to **In progress**, **Blocked**, or **Done** as appropriate. For Blocked, write the dependency/error; for Done, link the pushed commit and state the check that passed. Tick your detailed checklist at the same time.

## Our features

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

One person runs two opted-in coding sessions exploring different approaches to the same frontend feature -> both see each other's current approach -> one finds a constraint relevant to both -> Flower produces a source-linked update -> the other active agent receives it at a safe boundary and visibly adapts. The person chooses an approach and approves any work-redirection instruction. Show a saved decision in a fresh session if the core flow is stable.

Keep the original workers, worktrees, and credentials in place. Sharing context is not permission for arbitrary remote commands.
