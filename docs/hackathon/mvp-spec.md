# Puff Collaborative: scoped hackathon MVP

Status: proposed team implementation scope for review. No product implementation is implied by this document.

## Outcome

Two developers work in separate OpenCode sessions. Puff exposes permitted activity, notices duplicated work or a dependency, and delivers useful evidence to the affected session after human approval. A third, fresh session can retrieve an accepted decision without being given every earlier conversation.

Success means a real end-to-end run: local activity -> shared record -> Flower analysis -> source-linked proposal -> owner approval -> acknowledged OpenCode input -> an observable response using that context.

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
| F1 | Required | Selected shared sessions | Two workers appear with distinct identities, session IDs, status, timestamps, and permitted recent activity; an unshared session is absent. |
| F2 | Required | Useful session summaries | Flower produces short current-task/progress/blocker summaries from new exported activity. Each summary names its source revision; unchanged input does not trigger another run. |
| F3 | Required | Overlap/dependency/reuse detection | A real Flower run identifies a seeded overlap or dependency between the two sessions, cites both sources, and gives a concrete next action. A no-overlap case does not force a finding. |
| F4 | Required | Human-approved context handoff | Target worker owner can approve, edit, or reject a versioned proposal. Approval delivers one attributed input to the original session; rejection delivers nothing. |
| F5 | Required, minimal | Durable project memory | A human promotes a finding into an accepted decision. A fresh session and an existing session can request and receive relevant accepted decisions with source references. A superseded decision is not presented as current. |
| F6 | Required | Visible cooperation and failures | The view shows worker ownership, message/proposal flow, Flower run ID, stale/offline state, approval state, and delivery acknowledgment. |
| F7 | Stretch | Automatic checks at session start | Trigger the same context lookup automatically after the explicit flow works. |
| F8 | Stretch | Native Flower Grid worker queries | Real request/reply across eligible nodes; no simulated animation presented as a live exchange. |

## Narrowing rules

Use one fixed project, four preconfigured identities, and two worker machines. No sign-up flow, organization management, new database service, vector database, additional agent framework, or native desktop build. Reuse the existing SolidJS UI and repo toolchain. Keep the verified standalone Flower template intact; the integration gets its own project under hackathon/flower/ derived from that template.

The coding agents use OpenCode's configured providers. Flower's runtime model credential is scoped to AgentApp tasks and is not an API credential to reuse in OpenCode.

## Sharing and security

Start with synthetic demo sessions. A person must explicitly select a session for sharing. By default, export selected user/assistant text and tool name/status only; exclude full tool inputs/outputs, arbitrary files, environment contents, authentication material, and other sessions. A preview shows what will be exported. Sanitizing text is a best-effort filter, not a confidentiality proof.

The hub and authorized project viewers can see exported content. Flower and the hosted model may see the selected content submitted for analysis. Do not claim that raw information remains local if it was included in that request. Do not bundle session data or secrets into a FAB.

Use per-member/per-worker authentication mapped server-side to the fixed roster; do not trust a client-supplied author ID. Keep credentials in runtime configuration outside version control, not in source, URLs, browser bundles, or logs. Keep OpenCode's full API bound locally; the adapter exposes only the approved project operations. Use authenticated TLS transport for cross-machine hub traffic. Connectivity setup must be proven before relying on it; do not silently weaken the boundary to rescue the demo.

## Shared contract v1

Ferit owns the contract and publishes matching synthetic fixtures in the first 25 minutes. Everyone agrees on these names before implementation. Use JSON, schemaVersion=1, UTC timestamps, and opaque string IDs. Reject unknown project/session/worker mappings and invalid shapes.

| Record | Required fields |
| --- | --- |
| Worker | workerId, projectId, ownerId, lastSeenAt, state: online/offline |
| SharedEvent | eventId, projectId, workerId, sessionId, revision, kind: message/activity/status, occurredAt, content |
| Summary | summaryId, projectId, workerId, sessionId, revision, task, progress, blockers, evidenceRefs, generatedAt, runId |
| EvidenceRef | workerId, sessionId, eventId, revision; optional relative artifact path and commit, never an invented source |
| ContextRequest | requestId, projectId, targetWorkerId, targetSessionId, question, evidenceRefs, createdAt |
| CoordinationReport | requestId, runId, summaries, proposals, warnings |
| Proposal | proposalId, projectId, requestId, kind: overlap/dependency/reuse/context, targetWorkerId, targetSessionId, text, rationale, evidenceRefs, version, state: proposed/approved/rejected/delivered/failed/stale |
| Approval | approvalId, proposalId, expectedVersion, decision: approve/reject, finalText, decidedAt; actorId comes from authentication |
| Delivery | deliveryId, proposalId, targetWorkerId, targetSessionId, messageId, state: pending/claimed/delivered/failed, error |
| Decision | decisionId, projectId, text, evidenceRefs, state: accepted/superseded, supersedesId or null, approvedBy, approvedAt |

`SharedEvent.content` is a bounded object containing only the permitted fields for its kind. Limit text to 8,000 characters per event and reject larger events; do not silently send raw files. Analysis input is capped at 20 recent exported events per requested session, with a visible truncation warning. `revision` is monotonically increasing per session and exported snapshots retain their revision. A source reference is checked against stored events before a proposal can be accepted.

Local APIs to implement (Puff APIs, not existing OpenCode or Flower endpoints):

| Method and route | Owner | Contract |
| --- | --- | --- |
| POST /puff/v1/events | Ferit | Worker-authenticated SharedEvent upsert; duplicate eventId is a no-op; old revisions never overwrite newer state. |
| POST /puff/v1/workers/heartbeat | Ferit | Authenticate worker; update server-recorded lastSeenAt; 10-second heartbeat, stale after 30 seconds. |
| GET /puff/v1/projects/:id | Ferit | Authenticated authorized snapshot of workers, shared sessions, summaries, proposals, decisions, and deliveries. UI polls every 2 seconds for MVP. |
| POST /puff/v1/context-requests | Ferit | Validate ContextRequest, deduplicate requestId, enqueue one coordinator job; return requestId and status. |
| GET /puff/v1/context-requests/:id | Ferit | Return pending/completed/failed and report. |
| POST /puff/v1/proposals/:id/approval | Ferit | Compare expectedVersion and source revisions; authenticate target worker owner; create one delivery on approval. |
| POST /puff/v1/workers/:id/claim | Ferit | Authenticated worker claims its next delivery; one outstanding action per session. |
| POST /puff/v1/deliveries/:id/ack | Ferit | Only owning worker can acknowledge with stable OpenCode messageId or failure. |
| POST /puff/v1/decisions | Ferit | An authenticated member explicitly accepts or supersedes a source-backed decision; approval attributed. |

`ProjectSnapshot` contains projectId, workers, shared sessions, permitted recent events, summaries, proposals, decisions, and deliveries using the records above. Each shared-session entry contains workerId, sessionId, ownerId, title, revision, and status. The hub supplies only the requesting identity's authorized project view. The coordinator input excludes credentials, approval tokens, and delivery machinery even though the full UI snapshot contains delivery status.

Serdar's callable boundary: `coordinate(request: ContextRequest, snapshot: ProjectSnapshot) -> CoordinationReport`, invoked asynchronously by the hub job queue. The adapter must return or fail within 90 seconds and propagate run status and failure details. Deduplicate on requestId; do not launch a second paid run merely because the client polls or retries. A local timeout does not prove the remote run stopped: retain its run ID, request cancellation or mark its remote state unresolved, and require an observed terminal state before a replacement run. Start with an explicit context-check action; add one debounced idle-update trigger after explicit invocation works. An unchanged event revision never triggers another run.

Serhat's callable boundaries: `captureSession(sessionId) -> SharedEvent[]` and `deliverContext(delivery) -> {messageId, state, error}`. Match the actual running OpenCode API version, not a guessed combination of old docs and new types. Carry deliveryId into a stable OpenCode message identity; if retry reconciliation cannot be verified, leave an ambiguous delivery failed for human review instead of blindly replaying it. Deliver at a supported safe boundary through the existing prompt admission path.

## Approval and knowledge rules

Approval applies to one proposal version, exact target session, exact final text, and cited evidence revisions. Changed content or newer source revisions invalidate approval. A busy session receives an ordered queued input using existing OpenCode behavior; the adapter never starts a competing runner. The source thread stays on its original worker. Approval to add context does not grant shell access, merge permission, or approval for future tool actions.

Summaries are tentative descriptions. Accepted decisions require an explicit human action. Rejection is recorded and excluded from automatic re-proposal for the same evidence revision. No model training or autonomous self-improvement is claimed; the feedback loop is correction, evidence, and decision revision.

## Demo and failure behavior

Alice's session owns an auth helper and its interface; Bob's session is beginning a client integration with an incompatible assumption. The first Flower report identifies the dependency and recommends reuse. Alice changes the interface; an old approval is rejected as stale. A fresh report is approved and delivered to Bob's original session, which responds using the corrected interface. An accepted decision survives a hub restart and is returned to a new session.

If a worker disconnects, display offline and do not claim successful delivery. If Flower fails, preserve local coding, show coordination failure, and permit an explicit retry with a new requestId after the previous run is terminal. If time is short, cut automatic triggers and full transcript display before cutting the real Flower run, two-worker evidence, human approval, or actual context delivery.

## References

- [Reviewed README](https://github.com/uzgorenm/PuffCollaborative/blob/aff8de5ca03c75385458762e71f4476838f6d99d/README.md)
- [Flower runtime and boundaries](https://flower.ai/docs/agent/explanations/agentapp-runtime.html)
- [Flower SuperGrid workflow](https://flower.ai/docs/agent/how-to-guides/run-on-supergrid.html)
- [OpenCode plugins](https://opencode.ai/docs/plugins/)
- Local evidence: packages/plugin/src/index.ts; packages/server/src/handlers/session.ts; packages/protocol/src/groups/session.ts; packages/server/src/auth.ts; root and package AGENTS.md.
