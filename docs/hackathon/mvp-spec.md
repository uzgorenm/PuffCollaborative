# Puff Collaborative: scoped hackathon MVP

Status: proposed team implementation scope for review. No product implementation is implied by this document.

## Outcome

One developer can run two OpenCode sessions that deliberately explore alternative solutions to the same feature. Puff exposes selected activity, distinguishes alternatives from redundant work, and gives each agent relevant updates from the other while both remain active. The agent that receives an update can adjust its plan without losing its own session. The same flow also supports sessions owned by different developers. A fresh session can later retrieve a human-accepted decision without being given every earlier conversation.

Core success means a real end-to-end run: local activity -> shared record -> Flower analysis -> source-linked awareness update -> input to a related ongoing OpenCode session at a safe turn boundary after the report is ready -> an observable response using that context. A human approves any instruction that redirects another session's work and chooses which experimental outcome becomes accepted project knowledge.

## Architecture and boundaries

- Two OpenCode coding agents execute on their original machines and worktrees. Their local adapters export only selected session content and accept a narrow, approved context-delivery action.
- One Flower AgentApp on SuperGrid compares permitted summaries, asks for missing evidence through structured proposals if needed, and produces a bounded coordination report. It cannot execute shell commands or accept its own recommendations.
- One collaboration hub owns the fixed demo roster, worker/session mapping, exported events, summaries, proposals, approvals, delivery records, and accepted decisions. It is a single writer with restart-persistent local storage.
- One small page in the existing OpenCode web application displays those records and submits human decisions. Existing conversation screens remain available.

The baseline is three collaborating agents: two OpenCode agents plus one Flower coordinator. This is Flower-mediated collaboration, not a claim that all coding agents run as Flower AgentApps or that native Grid routing is already connected. If native Grid dispatch is added, prove it independently after the baseline works.

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

Use one fixed project, four preconfigured identities, and two isolated worker sessions. They may have the same owner; each needs its own workspace so experiments do not overwrite each other. No sign-up flow, organization management, new database service, vector database, additional agent framework, or native desktop build. Reuse the existing SolidJS UI and repo toolchain. Keep the verified standalone Flower template intact; the integration gets its own project under hackathon/flower/ derived from that template.

The coding agents use OpenCode's configured providers. Flower's runtime model credential is scoped to AgentApp tasks and is not an API credential to reuse in OpenCode.

## Sharing and security

Start with synthetic demo sessions. A person must explicitly select a session for sharing. By default, export selected user/assistant text and tool name/status only; exclude full tool inputs/outputs, arbitrary files, environment contents, authentication material, and other sessions. A preview shows what will be exported. Sanitizing text is a best-effort filter, not a confidentiality proof.

For two experiments on the same feature, the owner labels both opted-in sessions with the same feature topic and marks them as alternative approaches. Similar text alone is insufficient evidence that either experiment is redundant. If the relationship is unclear, Flower reports uncertainty and the agents keep working. A source-linked awareness note shares only relevant permitted findings, with their planned/ongoing/completed status. It is observational context, never a command to stop, change tools, edit files, or choose a winning approach. Coalesce repeated changes and show when a note is pending, stale, or delivered; Flower run time and worker availability mean awareness is timely but not instantaneous.

The hub and authorized project viewers can see exported content. Flower and the hosted model may see the selected content submitted for analysis. Do not claim that raw information remains local if it was included in that request. Do not bundle session data or secrets into a FAB.

Use per-member/per-worker authentication mapped server-side to the fixed roster; do not trust a client-supplied author ID. Keep credentials in runtime configuration outside version control, not in source, URLs, browser bundles, or logs. Keep OpenCode's full API bound locally; the adapter exposes only the approved project operations. Use authenticated TLS transport for cross-machine hub traffic. Connectivity setup must be proven before relying on it; do not silently weaken the boundary to rescue the demo.

## Shared contract v1

Serhat owns the contract and publishes matching synthetic fixtures in the first 25 minutes. Everyone agrees on these names before implementation. Use JSON, schemaVersion=1, UTC timestamps, and opaque string IDs. Reject unknown project/session/worker mappings and invalid shapes.

| Record | Required fields |
| --- | --- |
| Worker | workerId, projectId, ownerId, lastSeenAt, state: online/offline |
| SharedEvent | eventId, projectId, workerId, sessionId, revision, kind: message/activity/status, occurredAt, content |
| Summary | summaryId, projectId, workerId, sessionId, revision, task, approach, workState: planned/ongoing/completed/unknown, progress, blockers, evidenceRefs, generatedAt, runId |
| EvidenceRef | workerId, sessionId, eventId, revision; optional relative artifact path and commit, never an invented source |
| ContextRequest | requestId, projectId, targetWorkerId, targetSessionId, question, evidenceRefs, createdAt |
| CoordinationReport | requestId, runId, summaries, awarenessNotes, proposals, warnings |
| Proposal | proposalId, projectId, requestId, kind: overlap/alternative/dependency/reuse/context, targetWorkerId, targetSessionId, text, rationale, evidenceRefs, version, state: proposed/approved/rejected/delivered/failed/stale |
| Approval | approvalId, proposalId, expectedVersion, decision: approve/reject, finalText, decidedAt; actorId comes from authentication |
| AwarenessNote | noteId, projectId, sourceWorkerId, sourceSessionId, sourceRevision, targetWorkerId, targetSessionId, featureTopic, text, evidenceRefs, state: pending/delivered/failed/stale |
| Delivery | deliveryId, sourceKind: approvedProposal/awarenessNote, sourceId, targetWorkerId, targetSessionId, messageId, state: pending/claimed/delivered/failed, error |
| Decision | decisionId, projectId, text, evidenceRefs, state: accepted/superseded, supersedesId or null, approvedBy, approvedAt |

`SharedEvent.content` is a bounded object containing only the permitted fields for its kind. Limit text to 8,000 characters per event and reject larger events; do not silently send raw files. Analysis input is capped at 20 recent exported events per requested session, with a visible truncation warning. `revision` is monotonically increasing per session and exported snapshots retain their revision. A source reference is checked against stored events before a proposal can be accepted.

Local APIs to implement (Puff APIs, not existing OpenCode or Flower endpoints):

| Method and route | Owner | Contract |
| --- | --- | --- |
| POST /puff/v1/sessions/:id/sharing | Serhat | Authenticate the session owner; select/unselect sharing, featureTopic, relationship: alternative/unspecified, or mute awareness. Revoke future note delivery on mute/unshare. |
| POST /puff/v1/events | Serhat | Worker-authenticated SharedEvent upsert; duplicate eventId is a no-op; old revisions never overwrite newer state. |
| POST /puff/v1/workers/heartbeat | Serhat | Authenticate worker; update server-recorded lastSeenAt; 10-second heartbeat, stale after 30 seconds. |
| GET /puff/v1/projects/:id | Serhat | Authenticated authorized snapshot of workers, shared sessions, summaries, proposals, decisions, and deliveries. UI polls every 2 seconds for MVP. |
| POST /puff/v1/context-requests | Serhat | Validate ContextRequest, deduplicate requestId, enqueue one coordinator job; return requestId and status. |
| GET /puff/v1/context-requests/:id | Serhat | Return pending/completed/failed and report. |
| POST /puff/v1/proposals/:id/approval | Serhat | Compare expectedVersion and source revisions; authenticate target worker owner; create one delivery on approval. |
| POST /puff/v1/workers/:id/claim | Serhat | Authenticated worker claims its next approved instruction or informational awareness note; one outstanding action per session. Recheck that notes still have selected source and target sessions with the same feature topic and an unmuted target. |
| POST /puff/v1/deliveries/:id/ack | Serhat | Only owning worker can acknowledge with stable OpenCode messageId or failure. |
| POST /puff/v1/decisions | Serhat | An authenticated member explicitly accepts or supersedes a source-backed decision; approval attributed. |

`ProjectSnapshot` contains projectId, workers, shared sessions, permitted recent events, summaries, proposals, awareness notes, decisions, and deliveries using the records above. Each shared-session entry contains workerId, sessionId, ownerId, title, featureTopic, relationship: alternative/unspecified, revision, and status. The owner chooses the topic and relationship for each opted-in session; neither is inferred from similarity alone. The hub supplies only the requesting identity's authorized project view. The coordinator input excludes credentials, approval tokens, and delivery machinery even though the full UI snapshot contains delivery status.

Ferit's callable boundary: `coordinate(request: ContextRequest, snapshot: ProjectSnapshot) -> CoordinationReport`, invoked asynchronously by the hub job queue. The adapter must return or fail within 90 seconds and propagate run status and failure details. Deduplicate on requestId; do not launch a second paid run merely because the client polls or retries. A local timeout does not prove the remote run stopped: retain its run ID, request cancellation or mark its remote state unresolved, and require an observed terminal state before a replacement run. Prove the explicit context-check path first, then add a debounced trigger on meaningful progress from a selected related session for the core demo. An unchanged event revision never triggers another run.

Talha's callable boundaries: `captureSession(sessionId) -> SharedEvent[]` and `deliverContext(delivery) -> {messageId, state, error}`. Match the actual running OpenCode API version, not a guessed combination of old docs and new types. Carry deliveryId into a stable OpenCode message identity; if retry reconciliation cannot be verified, leave an ambiguous delivery failed for human review instead of blindly replaying it. Deliver at a supported safe boundary through the existing prompt admission path.

## Approval and knowledge rules

An informational AwarenessNote may enter another opted-in session with the same selected feature topic without approval for each note, because the owners already selected those sessions for sharing. It must cite a real source event/revision, avoid imperative instructions, and be deduplicated per target and source revision. The worker admits it as attributed context at a supported safe boundary. The agent may adapt its plan but remains subject to its normal tool permissions. No session is stopped, merged, or redirected automatically. A person can mute awareness or remove a session from the shared topic.

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
