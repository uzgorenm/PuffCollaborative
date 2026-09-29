# Integration gates and contract handoffs

Use this page with [acceptance workflows](acceptance-workflows.md) and the [progress checklist](progress-checklist.md). The [MVP spec](mvp-spec.md) and acceptance workflows define the required product behavior. Serhat owns the shared wire contract in [coordination-contract.md](../coordination-contract.md), its schema, protocol, handlers and service interfaces. This page identifies decisions and evidence needed to connect those layers; it does not approve new signatures or routes.

## Observed baseline

Initially reviewed against local commit `e42a799cf6` on September 29, 2026; incoming source was rechecked through `5c8e111931`. Recheck later changes before integration.

- The initial scaffold supplied only `GET /api/coordination/v1/status`. Incoming `d1277d86dd` declares the broader coordination protocol and auth scope, but the [handler](../../packages/server/src/handlers/coordination.ts) at this checkpoint still supplies only status-503. Declarations and newly added services are not proof of complete server composition. See [protocol](../../packages/protocol/src/groups/coordination.ts) and [contract](../coordination-contract.md); its phase-one inventory predates these incoming declarations.
- The earlier `/puff/v1` design was a proposed, unwired product contract; the MVP spec now points to this reconciliation. It is not a second backend to implement by default. Reconcile its required behaviors with Serhat's current coordination API before consumers depend on route names or record shapes.
- The local, uncommitted UI adapter currently calls `/puff/v1` with Bearer credentials. The new backend contract specifies individual Basic credentials. Its preview/types are provisional and do not prove backend integration. Serdar owns `packages/app/src/pages/puff/project-api.ts` and `docs/hackathon/serdar-ui-plan.md`; at this snapshot those files were local work, so their existence is not a published integration artifact.
- New `Approval` records describe tool approval; `WorkCard` describes one thread's summary. Neither represents a source-linked cross-session awareness delivery or approval to redirect another session's work. Current `Thread` lacks explicit topic, alternative relationship and mute/revocation state.
- At the initial snapshot, coordination tests contained a fixture only. Incoming commits add the [event journal](../../packages/core/src/coordination/events/events.ts) and [test source](../../packages/core/test/coordination/events/events.test.ts), plus authoritative Session binding and snapshot read interfaces. These are implementation progress; the coordinator did not execute those tests. Bun was unavailable on the initial reviewer's PATH. The findings below are source inspection, not passing runtime checks.
- Further incoming work adds shared access/projects/comments, runner/approval controls and transactional snapshot composition. The [runner's own scope note](../../packages/core/src/coordination/runner/README.md) explicitly distinguishes mock-port tests from real OpenCode execution. These additions deserve implementation credit while the awareness contract and live consumer proof remain open.

## Producer to consumer handoffs

Every handoff records producer/consumer names, source commit, exact fixture or request/response, check command/result, and any remaining limitation. The consumer acknowledges the same artifact; a producer-only check does not close the handoff.

| Producer → consumer | Required handoff | Evidence that closes it |
| --- | --- | --- |
| Serhat → Talha, Ferit, Serdar | One authoritative schema/mapping and labeled synthetic fixture, including two alternatives owned by one person | Every consumer parses the same fixture; required behaviors map to implemented or explicitly pending operations; no local field renaming hides a mismatch |
| Talha → Serhat | Selected-session evidence, stable worker/session identity, source event ID/revision and capture receipt | One real permitted event is stored once; private sessions export nothing; invalid mappings and older/changed retries are rejected |
| Serhat → Ferit | Bounded authorized evidence, explicit topic/relationship and stable analysis request identity | Recorded request excludes private data and credentials; source references resolve; retries/polling do not launch another run |
| Ferit → Serhat | Actual Flower run/result identity, structured summaries/notes, exact evidence references and bounded failure state | Server validates source/target/consent/revision independently; unsupported, unrelated or stale results create no delivery |
| Serhat → Talha | Persisted, validated awareness delivery with stable message identity and exact destination | Admission reaches the mapped existing Session once; delivery type and retry semantics agree; claim/admission honors revocation rules |
| Talha → Serhat → Serdar | Admission receipt, promotion evidence and subsequent use evidence | UI distinguishes those stages; B's response uses A's specific finding while continuing B's alternative; failure never appears as successful receipt |
| Serhat → Serdar | Real authenticated snapshots/events and implemented action responses | UI connects to the actual registered API; reconnect resumes correctly; preview labels remain until real evidence replaces fixtures |

## Nine integration review dimensions

For G0, agree the required records/interfaces and prove one minimal authenticated exchange. The Stop/Go checks below attach to their corresponding G1–G5 runtime gates; completing C9 is not a prerequisite for beginning integration. Implement only the operations needed by the protected awareness demo first. Unused secondary APIs can remain explicitly unavailable.

### C1 — One contract and complete route wiring

**Owner:** Serhat; **consumers:** all three teammates.

Map required product operations to the current coordination contract: selected sharing/topic/mute, evidence capture, analysis request/result, awareness delivery/receipt and observable state. Work-redirection approval and accepted decisions remain secondary; unapproved redirection must still be rejected. Preserve the existing backend ownership and stack; do not silently substitute shared-thread execution for live awareness.

**Stop:** an operation exists only in prose, a UI adapter, a synthetic handler or a route table. **Go:** each required operation has matching schema, protocol declaration, registered handler, configured service behavior, authorization and an exercised consumer response. Regenerate the public client from the agreed API through the repository's client-generation workflow; never hand-edit generated files. A matching route name alone is insufficient.

Source: root [AGENTS.md](../../AGENTS.md); [coordination interfaces](../../packages/core/src/coordination/contracts.ts); [registered protocol](../../packages/protocol/src/groups/coordination.ts). The current status route remains unavailable until real adapters are composed.

### C2 — Sharing authority, identities and destination binding

**Owner:** Serhat; **capture/delivery:** Talha; **controls:** Serdar.

Freeze server-authoritative ownership, explicit sharing selection, feature topic, alternative/unspecified relationship and mute/unshare semantics. Project membership alone is not session-sharing consent. Resolve member, worker/instance and analysis identities from credentials; resolve Session and worker from the shared Thread, not model-produced IDs or spoofed authors. Agree the UI authentication scheme and transport against the actual backend.

**Stop:** private or unrelated evidence can enter analysis/delivery; missing config falls back to fixture/permissive auth. **Go:** wrong project, worker, instance and spoofed author are rejected; selected same-owner alternatives work; missing adapters/config fail explicitly. Check both export scope and server routing, not only disabled UI buttons.

Source: [MVP sharing rules](mvp-spec.md#sharing-and-security); [development identity](../coordination-contract.md#development-identity); current [authorization middleware](../../packages/server/src/middleware/authorization.ts) still uses instance-level authentication.

### C3 — Evidence revisions, project cursors and meaningful changes

**Owner:** Serhat; **source mapping:** Talha; **analysis inputs:** Ferit; **replay:** Serdar.

Specify how exported session event/revision references map to the coordination journal. The old proposal uses a per-session revision; the new contract uses a project-wide event `seq` and `Thread.activitySeq` for the latest content-changing event. A snapshot cursor, activity revision and WorkCard version are different values. Define which event kinds change summarized content; acknowledgment, delivery, summary projection or copied context must not automatically trigger another analysis loop.

**Stop:** consumers assume dense per-thread sequence numbers, confuse a project cursor with evidence revision, or cannot resolve a cited source. **Go:** unchanged input causes no new job/note; stale analysis is rejected; thread-filtered replay may skip unrelated project sequences but loses no relevant event. Snapshot plus replay/stream reconnect has no gap or duplicate effect. Test empty cursor `-1`, exclusive `after`, invalid/future cursors and page bounds.

**Known fixture issue:** `evt_tool` and `evt_card` both have `projectId: prj_demo, seq: 3` in [fixtures.json](../../packages/core/test/coordination/fixtures.json) (reviewed lines 85–93 and 107–113). Serhat must reconcile this with the single project sequence and add a regression check; consumers must not repair separate copies silently.

### C4 — Ongoing awareness versus queued future work

**Owner:** Talha for execution behavior; **shared signature:** Serhat; **use evidence:** Ferit and Serdar.

The coordination queue reserves a new Run only after the existing Run is terminal. That mechanism alone cannot satisfy awareness while B is still working. Root AGENTS.md requires explicit delivery vocabulary: `steer` promotes at a safe provider-turn boundary; `queue` waits until the Session would otherwise become idle.

**Implementation candidate, not approved:** a separate context-admission port or discriminated command admitting an attributed AwarenessNote through existing `SessionV2.prompt` with explicit `delivery: "steer"`, stable message ID, exact Session and source references. It must not reserve a second coordination Run, interrupt an active tool/provider turn or start a competing runner. Future work can retain the queue path. Serhat and Talha choose the final signature together.

**Stop:** only a queued next Run receives the note, or worker HTTP success is presented as agent use. **Go:** B is active before delivery; the receipt proves durable admission; transcript/inbox evidence proves promotion at a safe boundary; a subsequent B response uses A's source-only fact while preserving B's approach. A concrete plan/check can prove use; a generic acknowledgment cannot. Late arrival after B becomes idle is valid delivery but does not prove this live case.

Source-inspected support, not integrated proof: [session.ts](../../packages/core/src/session.ts) lines 360–383 admits then wakes; [run-coordinator.ts](../../packages/core/src/session/run-coordinator.ts) lines 81–91 coalesces an active wake; [runner/llm.ts](../../packages/core/src/session/runner/llm.ts) lines 187–201 promotes before loading provider history and lines 403–411 distinguish steers from queued continuation. These capabilities still need the real adapter and workflow test.

### C5 — Informational context, redirection and tool approval

**Owner:** Serhat; **classification:** Ferit; **review UI:** Serdar; **execution:** Talha.

Freeze three distinct meanings: informational awareness under prior sharing consent; a proposal that redirects work and needs the target owner's approval; and an existing runner tool approval. The current tool `Approval` record cannot substitute for approval of exact proposal text, target and evidence revisions. Similarity must not select a winning alternative or stop/merge work automatically.

**Stop:** a model chooses an authoritative target, a note contains an unapproved work command, or tool approval is counted as redirection approval. **Go:** validated notes remain observational; changed target/text/version/evidence invalidates redirection approval; a rejected proposal is not automatically repeated for the same evidence. Ordinary tool permissions remain independent.

Source: [MVP approval rules](mvp-spec.md#approval-and-knowledge-rules); [coordination schema](../../packages/schema/src/coordination.ts), including tool `Approval` at reviewed lines 163–178.

### C6 — Atomic state, events, snapshots and outbound intent

**Owner:** Serhat, coordinating backend feature owners; **runner consumer:** Talha.

Use the same Database/EventV2 transaction for each state change and its event. Approval projection and transition into waiting approval must commit together; snapshot state and project cursor must come from one read transaction. Incoming commit `05dcc5c762` adds the previously missing `Queue.runs` and `Runner.approvals` read interfaces; `3c68e3718d` adds transactional snapshot composition. Verify the concrete dependencies and behavior instead of reopening those source gaps. Keep network/Flower calls outside transactions; commit durable delivery intent before sending.

Apply this gate to mutations and snapshots used by the demo. Full instruction-queue or tool-approval integration is required only if that path is exercised; it must not block an awareness-only slice that safely uses the existing Session runtime. Preserve existing tool permissions in either case. Record unused optional surfaces as unavailable rather than implementing all reserved routes first.

**Stop:** partial projections survive failure or outbound calls happen before durable intent. **Go:** forced projection/CAS failure leaves no event or state change; concurrent submissions preserve one active Run; stale WorkCard returns conflict without an event; snapshot/replay matches committed state; restart can discover pending outbound work.

Source: [transaction contract](../coordination-contract.md#transactions-and-retries); [contracts.ts](../../packages/core/src/coordination/contracts.ts) reviewed lines 91–104 and 132–252; [EventV2](../../packages/core/src/event.ts) reviewed lines 239–357 commits before publishing subscriber wakeups.

### C7 — Retry identity, uncertain outcomes and revocation

**Owner:** Serhat for durable identity/policy; **admission reconciliation:** Talha; **status display:** Serdar.

Freeze retry namespaces for requests, callbacks, source notes/targets, messages and approval decisions. Resolve the prose ambiguity between request IDs scoped per actor/thread and cross-actor/thread conflicts. Exact retry preserves result and message identity; changed payload conflicts. Forwarding can retry after a lost response, so promise one effect through consumer deduplication rather than one network call. Reconciliation must not convert unknown outcomes into success or blindly replay provider work.

**Stop:** retry creates another visible input or approval effect, or unshare is represented as erasing already consumed context. **Go:** lost-response/restart tests yield one effect or explicit ambiguity; changed text/Session/delivery mode conflicts. Deterministic mute/unshare-before-claim produces zero admission. Revalidate immediately before admission where feasible. Freeze the in-flight race boundary: after durable admission, record that disclosure, suppress future notes and do not silently interrupt coding to pretend to retract history.

Source: [retry contract](../coordination-contract.md#transactions-and-retries), runner approval delivery rules, and root [AGENTS.md](../../AGENTS.md) lines 153–159. The exact distributed revocation guarantee remains a contract decision until implemented and tested.

### C8 — Flower job/result handoff and bounded failures

**Owner:** Ferit; **job persistence/validation:** Serhat; **visible trace:** Serdar.

Agree the actual callable adapter, bounded permitted input, structured result channel, request/run IDs and terminal/failure handling. Current `WorkCards.update` stores a summary; it does not define a complete analysis job or awareness report. Preserve explicit context-check as fallback, then prove a debounced meaningful-change trigger. Repeated polls, unchanged evidence and note acknowledgments must not create paid reruns or A↔B echo loops.

**Stop:** canned output is labeled live, unsupported references create deliveries, or a local timeout is treated as remote termination. **Go:** actual Flower output over current permitted evidence reaches validation; unrelated/uncertain alternatives remain separate; failure preserves local coding and is visible. Retain remote run identity and establish terminal status before replacement. Multiple-Flower-agent cooperation and publication are separate [readiness gates](../../README.md#official-hackathon-requirements-and-readiness).

### C9 — Consumer proof and the final connected workflow

**Owner:** Serdar for observable UI; **integration owner:** Serhat; **live participants:** Talha and Ferit.

Show the actual owner/session/alternative, evidence reference, Flower run, note destination and distinct pending/admitted/promoted/failed or ambiguous status. Record agent use separately; do not infer it from an API response, spinner completion or work-card refresh. Keep planned work distinct from completed work and synthetic previews distinct from live records.

**Stop:** any link is fixture-only or a consumer uses an unimplemented route/auth contract. **Go:** execute the [acceptance workflows](acceptance-workflows.md), including the same-owner alternatives case and private/unrelated/muted/stale/duplicate/offline controls. Record one correlated chain: source event/revision → Flower request/run/result → validated note/delivery → stable target message → promoted transcript → B's concrete use. Both alternatives continue until a person chooses. Update the [progress checklist](progress-checklist.md) with the exact evidence and remaining limits.

## Release of a handoff

Each owner verifies the affected package, then the receiving owner exercises the real boundary. Passing schemas, service tests, a Flower smoke run, a UI build and live agent use prove different layers. Record commands and observed outcomes separately. Follow main-only integration and ownership rules from root AGENTS.md; do not change another owner's in-progress files to make a demo appear connected.
