# Puff Collaborative: scoped hackathon MVP

Status: product behavior specification. Backend scaffolding and local UI work exist; the [progress checklist](progress-checklist.md) records their evidence and the unverified live flow. The [workflow cases](acceptance-workflows.md) determine whether a feature works.

**Hackathon alignment, checked September 29:** The [official requirements and readiness review](../../README.md#official-hackathon-requirements-and-readiness) identifies a remaining gap: the brief asks for collaboration among multiple Flower Agents on SuperGrid and a published Flower Hub app. The single-Flower baseline below is an engineering checkpoint, not verified satisfaction of that challenge. Prove the additional Flower-agent interaction or obtain mentor confirmation of an alternative before claiming hackathon readiness; native Grid routing is one possible implementation, not the only accepted pattern described by the brief.

## Outcome

One developer can run two OpenCode sessions that deliberately explore alternative solutions to the same feature. Puff exposes selected activity, distinguishes alternatives from redundant work, and gives each agent relevant updates from the other while both remain active. The agent that receives an update can adjust its plan without losing its own session. The same flow also supports sessions owned by different developers. A fresh session can later retrieve a human-accepted decision without being given every earlier conversation.

Core success means a real end-to-end run: local activity -> shared record -> Flower analysis -> source-linked awareness update -> input to a related ongoing OpenCode session at a safe turn boundary after the report is ready -> an observable response using that context. A human approves any instruction that redirects another session's work and chooses which experimental outcome becomes accepted project knowledge.

## Architecture and boundaries

- Two OpenCode coding agents execute in isolated workspaces on their original workers. Their adapters export selected session content and admit informational awareness at a safe provider-turn boundary; commands that change the assigned work require the appropriate owner approval.
- Flower agents on SuperGrid exchange permitted evidence and produce a bounded coordination result. One analysis role can supply a finding to a coordination role that relates it to the other session. Demonstrate the useful exchange in WF10; merely assigning different role names in one prompt is insufficient. These agents cannot execute host shell commands or accept their own recommendations.
- The existing coordination backend owns the fixed demo roster, worker/session mapping, exported events, summaries, proposals, approvals and delivery records, using its existing SQLite/EventV2 stack. Accepted-decision persistence follows the working awareness loop.
- One small page in the existing OpenCode web application displays those records and submits human decisions. Existing conversation screens remain available.

Two OpenCode sessions plus one Flower call remain a useful engineering checkpoint. Hackathon readiness additionally requires actual collaboration among Flower Agents and publication of the working app. Native Grid dispatch is one possible transport; do not confuse that optional implementation choice with the required cooperation evidence.

The hub host launches Flower through an isolated, project-compatible CLI process. Submit only permitted content, capture the run ID, wait for a terminal status, and read a single validated structured report emitted by our AgentApp. The report is an application result, not instructions to the host shell. Flower process logs and frontend run events are different channels; verify the chosen result channel in the first-hour smoke test. A hosted AgentApp cannot reach a developer's localhost by assumption.

## Features and acceptance

| ID | Priority | Feature | Acceptance |
| --- | --- | --- | --- |
| F1 | Required | Selected shared sessions | Two separate sessions appear with identities, owners, status, timestamps, permitted recent activity, and a user-selected shared feature topic; an unshared session is absent. The same owner may run both sessions. |
| F2 | Required | Useful session summaries | Flower produces short current approach/task/progress/blocker summaries from new exported activity. Each summary names its source revision and distinguishes planned, ongoing, and completed work; unchanged input does not trigger another run. |
| F3 | Required | Relation and reuse detection | A real Flower run distinguishes deliberate alternative approaches from duplicated effort, identifies a shared constraint or useful finding, cites both sessions, and gives a concrete suggestion. A no-relation case does not force a finding. |
| F4 | Required | Live awareness in another agent | A source-linked informational update from one opted-in session reaches a related ongoing session at a safe turn boundary after the report is ready; the target agent visibly uses it without being ordered to stop or switch approaches. Duplicate revisions cause no repeat input. A proposed instruction to redirect work still requires the target worker owner's approval. |
| F5 | Secondary, minimal | Durable project memory | A human promotes a finding into an accepted decision. A fresh session and an existing session can request relevant accepted decisions with source references. A superseded decision is not presented as current. Finish the live F1-F4 loop first. |
| F6 | Required | Visible cooperation and failures | The view shows worker ownership, message/proposal flow, Flower run ID, stale/offline state, approval state, and delivery acknowledgment. |
| F7 | Stretch | Automatic checks at session start | Trigger the same context lookup automatically after the explicit flow works. |
| F8 | Stretch | Native Flower Grid worker queries | Real request/reply across eligible nodes; no simulated animation presented as a live exchange. |

## Narrowing rules

Use one fixed project, four preconfigured identities, and two isolated worker sessions. They may have the same owner; each needs its own workspace so experiments do not overwrite each other. No sign-up flow, organization management, new database service, vector database, additional agent framework, or new desktop-packaging effort. Reuse the retained desktop/web entry points, existing SolidJS UI and repo toolchain. Keep the verified standalone Flower template intact; the integration gets its own project under hackathon/flower/ derived from that template.

The coding agents use OpenCode's configured providers. Flower's runtime model credential is scoped to AgentApp tasks and is not an API credential to reuse in OpenCode.

## Sharing and security

Start with synthetic demo sessions. A person must explicitly select a session for sharing. By default, export selected user/assistant text and tool name/status only; exclude full tool inputs/outputs, arbitrary files, environment contents, authentication material, and other sessions. A preview shows what will be exported. Sanitizing text is a best-effort filter, not a confidentiality proof.

For two experiments on the same feature, the owner labels both opted-in sessions with the same feature topic and marks them as alternative approaches. Similar text alone is insufficient evidence that either experiment is redundant. If the relationship is unclear, Flower reports uncertainty and the agents keep working. A source-linked awareness note shares only relevant permitted findings, with their planned/ongoing/completed status. It is observational context, never a command to stop, change tools, edit files, or choose a winning approach. Coalesce repeated changes and show when a note is pending, stale, or delivered; Flower run time and worker availability mean awareness is timely but not instantaneous.

The hub and authorized project viewers can see exported content. Flower and the hosted model may see the selected content submitted for analysis. Do not claim that raw information remains local if it was included in that request. Do not bundle session data or secrets into a FAB.

Use per-member/per-worker authentication mapped server-side to the fixed roster; do not trust a client-supplied author ID. Keep credentials in runtime configuration outside version control, not in source, URLs, browser bundles, or logs. Keep OpenCode's full API bound locally; the adapter exposes only the approved project operations. Use authenticated TLS transport for cross-machine hub traffic. Connectivity setup must be proven before relying on it; do not silently weaken the boundary to rescue the demo.

## Contract authority and integration

This document defines product outcomes. The shared implementation contract is [coordination-contract.md](../coordination-contract.md), owned by Serhat, together with the repository's coordination schema, protocol and service interfaces. The earlier `/puff/v1` endpoints and standalone JSON hub were an unwired proposal; do not build a parallel backend or assume that renaming those endpoints yields integration.

At source checkpoint `5c8e111931`, the protocol declares broader coordination routes, while the handler file still supplies only `/api/coordination/v1/status`, deliberately reporting unavailable adapters. New service modules are implementation progress; the complete server/consumer composition has not been verified by the coordinator. Recheck incoming changes and reconcile the local UI adapter's provisional schema/auth through [C1–C9 integration gates](integration-gates.md) before live integration is claimed. Do not confuse the backend's tool `Approval` with a source-linked proposal to redirect work.

| Product requirement | Shared contract must establish |
| --- | --- |
| Same-owner parallel alternatives | Stable owner, worker, Session/Thread and workspace mapping; selected sharing; explicit feature topic and alternative relationship; mute/unshare behavior |
| Evidence with provenance | Source event identity, a defined revision/activity sequence mapping, captured time and permitted content; project cursor, activity sequence and summary version remain distinct |
| Useful current summaries | Approach, task, blockers and planned/ongoing/completed/unknown state, backed by the exact source evidence |
| Actual analysis | Stable request identity; bounded authorized input; participating Flower agents, run/task/result identity and terminal/failure state; unchanged input does not create paid reruns |
| Informational awareness | Source-linked brief, validated destination, current selection, provenance that distinguishes newly learned findings from copied context/acknowledgments |
| Active-session admission | Explicit delivery meaning; stable message identity; safe admission/promotion into the existing Session; no second runner; retry/reconciliation and in-flight revocation boundary |
| Observable result | Separate pending/admitted/promoted/failed or ambiguous evidence and subsequent agent use; no inference of use from an HTTP success |
| Work redirection and later memory | Exact target/version/text/source binding plus authenticated owner decision; accepted versus superseded knowledge, if this secondary scope is implemented |

All four owners use the same agreed synthetic fixture and source commit. Serhat finalizes wire shapes with their consumers; the [team plan](team-plan.md) gives each person the next verifiable output. Do not treat model-supplied identities or source claims as authorization. A hosted AgentApp cannot be assumed to reach a developer's localhost.

## Approval and knowledge rules

An informational awareness note may enter another opted-in session with the same selected feature topic without approval for each note, because the owners already selected those sessions for sharing. It must cite a real source event/revision, avoid imperative instructions, and be deduplicated per target and source revision. The worker admits it as attributed context at a supported safe boundary. The agent may adapt its plan but remains subject to its normal tool permissions. The coordinator does not cancel an experiment, merge work, select a winner, or issue a new assigned goal automatically. Incorporating a relevant fact within the current assignment is the intended adaptation. A person can mute awareness or remove a session from the shared topic.

The hub validates every model-produced note against its stored source event, selected topic, and permitted target before it creates a delivery. It never treats a model-supplied target or claim of completion as authority by itself. A target receives only the brief and evidence references, not the source transcript.

Approval applies to any proposal that instructs a session to change its work: one proposal version, exact target session, exact final text, and cited evidence revisions. Changed content or newer source revisions invalidate approval. A busy session receives an ordered queued input using existing OpenCode behavior; the adapter never starts a competing runner. The source thread stays on its original worker. Approval to add context does not grant shell access, merge permission, or approval for future tool actions.

Summaries are tentative descriptions. Accepted decisions require an explicit human action. Rejection is recorded and excluded from automatic re-proposal for the same evidence revision. No model training or autonomous self-improvement is claimed; the feedback loop is correction, evidence, and decision revision.

## Demo and failure behavior

One developer opens two isolated sessions for a frontend feature: A explores a compact navigation design, B explores a full navigation design. Both are deliberately marked as alternatives under one feature topic. B sees that A is exploring a different approach, not a finished component to reuse. A discovers a keyboard-navigation constraint affecting both designs. The next Flower report cites that finding; B receives a brief at a safe boundary, acknowledges it in its plan, and continues the full-navigation experiment with the constraint in mind. The developer compares the results and explicitly chooses one approach. A human-approved decision can survive a hub restart and be returned to a fresh session.

If a worker disconnects, display offline and do not claim successful delivery. If Flower fails, preserve local coding, show coordination failure, and permit an explicit retry with a new requestId after the previous run is terminal. If time is short, cut full transcript display and accepted-decision persistence before cutting the live cross-session awareness loop. Preserve an explicit check as a fallback if the debounced trigger fails, and report that limitation rather than claiming automatic awareness.

## References

- [Reviewed README](https://github.com/uzgorenm/PuffCollaborative/blob/aff8de5ca03c75385458762e71f4476838f6d99d/README.md)
- [Flower runtime and boundaries](https://flower.ai/docs/agent/explanations/agentapp-runtime.html)
- [Flower SuperGrid workflow](https://flower.ai/docs/agent/how-to-guides/run-on-supergrid.html)
- [OpenCode plugins](https://opencode.ai/docs/plugins/)
- Local evidence: packages/plugin/src/index.ts; packages/server/src/handlers/session.ts; packages/protocol/src/groups/session.ts; packages/server/src/auth.ts; root and package AGENTS.md.
