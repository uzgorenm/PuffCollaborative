# README review against the team's original goals

Reviewed September 29, 2026 against [Serhat's README at aff8de5](https://github.com/uzgorenm/PuffCollaborative/blob/aff8de5ca03c75385458762e71f4476838f6d99d/README.md). At review time, the local checkout still had the older upstream README and the fork differed from upstream in README.md only. The new main branch starts from aff8de5, preserving that README before adding this planning work. Described product features remain proposed.

## What is already covered

Shared project threads; visibility into activity and blockers; relevant context retrieval; coding across machines; a Flower coordinator; an authenticated bridge; ordered input; author attribution; human-approved handoffs; and deferring automatic assignment, merging, and migration of running sessions.

## Gaps and decisions

| Original goal or practical gap | README coverage | Proposed MVP decision |
| --- | --- | --- |
| Prevent repeated work between people and between one person's sessions | Implied by shared context | Make duplicate-work detection and reuse the central user benefit and demo outcome. |
| Preserve lessons after a session ends | No explicit durable knowledge feature | Store small, human-approved decision records with source references; retrieve these from new and existing sessions. |
| Separate a tentative idea from an accepted decision | Not specified | Summaries are observations. Only explicit approval creates an accepted decision. New evidence can mark it superseded. |
| Keep current sessions informed, not just show a dashboard | Context retrieval mentioned without delivery | A context request produces a brief; an approved action inserts it into the target OpenCode session with attribution. |
| Explain why agents are separate | Distributed execution stated | Two OpenCode agents own different worktrees and session histories. A Flower AgentApp reasons over explicitly exported evidence and cannot operate either machine directly. |
| Make Flower collaboration visible | One coordination AgentApp stated | Display the Flower run ID, input source references, proposal, human decision, and delivery acknowledgment. Native Flower Grid worker routing is optional, not claimed as already implemented. |
| Define privacy and disclosure | Credentials and machine access addressed | Joining the demo does not export every session. Only explicitly shared project sessions and approved fields are exported. Shared material is centrally visible to the hub and may reach hosted models. |
| Decide whether transcripts or summaries are shared | Project-owned conversations emphasized | Support a limited shared thread view for opted-in synthetic demo sessions; keep full tool output, arbitrary files, credentials, and unrelated sessions out of the feed. |
| Make a handoff operationally precise | Continue another person's work | An authorized teammate can propose a follow-up on the same session's existing host. Its worker owner approves execution. Session, worktree, credentials, and host do not move. |
| Prevent duplicate input or conflicting execution | Ordered flow promised | Bind each session to one worker, use stable action/message IDs, and let OpenCode's existing runner serialize execution. Never implement a second coding loop. |
| Account for stale knowledge and failures | Not specified | Version summaries; show last-seen time; mark disconnected workers; invalidate proposals when referenced versions change. |
| Fit four people and 5–6 hours | Broad feature list | One fixed demo project, four fixed members, two workers, three actual agents, one view, one complete coordination loop. |

## Suggested README additions

Add a short problem statement explaining that teams repeat work because useful findings remain trapped in isolated coding conversations.

Add two feature bullets: (1) duplicate-work/dependency detection with source-linked reuse suggestions; (2) approved project memory reused by new and ongoing sessions.

Add a sharing-boundary paragraph: sharing is explicit and project-scoped; exported content reaches the collaboration service and potentially hosted models; local storage alone does not imply local inference.

Clarify the demo handoff: the same worker continues the same session after its owner approves a teammate's attributed instruction. No session or credential migration occurs.

Link to [the scoped MVP](mvp-spec.md) and [the four-person task board](team-plan.md), and distinguish required demo features from stretch features.

## Scope to defer

Automatic task assignment, autonomous merging, full company-wiki generation, support for every coding tool, production account onboarding, arbitrary remote shell access, editing multiple people's live prompts concurrently, native desktop packaging, local model installation, and moving running sessions across machines.

## Inspection limits

Flower's separate official-template build and SuperGrid chat were verified earlier. OpenCode startup, its actual active API/plugin path, multi-machine connectivity, the bridge, and the proposed product flow have not been verified. Bun was absent from this shell during inspection; the repo declares bun@1.3.14. Resolve these execution risks in the first hour, not during the final demo rehearsal.

GitHub Issues is disabled on this fork. Assignments are recorded in the task board; no issue assignments or teammate notifications have been sent.
