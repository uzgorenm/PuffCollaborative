# Activity intelligence (Ferit)

Independent Python 3.11+ standard-library module. No AgentApp, Flower manifest,
chain adapter, shared schema, hub, worker, or UI changes are included.

**Integration status after fetching main `59528d2b8`:** the revised MVP makes
`docs/coordination-contract.md` authoritative and retires the old `/puff/v1`
proposal. The snapshot below retains the originally requested ProjectSnapshot
shape as a **provisional Flower input only**, not a published current server wire
contract. C2/C3/C4/C8 owner confirmation remains required. No endpoint is implemented
or called here. Backend WorkCards already have their own storage and CAS checks.

`coordination.selected_event` offers a pure mapping for selected current journal
events: the backend's project-wide `Event.seq` becomes the evidence revision
without renumbering, and the original `{threadId,eventId,seq}` is returned
separately as `sourceRef`. Project sequences start at 0, so revision 0 is valid;
events for one thread are sparse in the project sequence. The local card uses
revision -1 only as its no-event sentinel. It is not a source revision and must
never be cited. The helper checks the captured `Thread.activitySeq` upper bound.
Keep that reference mapping alongside the submitted snapshot. `Thread.activitySeq`
is the captured thread summary revision, while `WorkCard.version` is a separate
compare-and-swap version. The caller retains both `activitySeq` and
`expectedVersion` separately for backend `WorkCards.update`; do not infer either
from the local card revision or snapshot length. The project replay cursor is
also separate; it is not a substitute for a cited event sequence or
`Thread.activitySeq`.
The adapter excludes work-card.updated and trusted awareness/acknowledgment
provenance to prevent feedback refreshes. Unknown journal kinds are excluded,
not interpreted as progress. Run/approval lifecycle projection remains backend
owned; this helper is selected evidence projection, not a complete journal mirror.

From `hackathon/flower`:

```powershell
python -m unittest discover -s activity -v
python -m activity.demo
```

The demo prints **synthetic** selected evidence, not a Flower result. The saved
example is `../fixtures/activity/sample_snapshot.json`. No dependency install is
needed. The real TypeSafe path is implemented but requires `TYPESAFE_API_KEY` in
the process environment; tests use an injected async client and no credentials.

## Flow and integration

1. Construct `Activity(project_id, sessions, workers)` from the hub's authorized
   roster. `shared: true` is a local opt-in gate on each supplied session. Worker
   presence/status is supplied by the hub, never inferred by this module.
2. Save `previous = activity.card(key)`, then `activity.ingest(event)`. Replay is
   deterministic in exact project-`seq` order; a thread's sequence may be sparse.
   Revision 0 is valid. Duplicate IDs are no-ops; conflicting IDs or revisions
   fail. `key` is `(workerId, sessionId)`. Before any event, the card revision is
   -1. The event log is in memory; the hub owns durability and must replay it in
   full, not just the last 20 events.
3. After ingesting an event, call
   `refresh.observe(key, activity.card(key)['revision'], now)`. Revision 0 is
   valid; -1 means no event and is not an observable refresh revision. If it
   returns true, schedule `await jev.classify(activity.classifier_state(key,
   previous))` outside the coding runner, then pass the result to
   `refresh.classified(key, revision_captured_before_await, label)`. Do not label
   an old result with the revision current after awaiting.
4. Independently poll `refresh.due(monotonic_seconds)`. It emits one refresh
   intent for the latest dirty revision after a 2-second quiet period, or by
   15 seconds from first dirty activity. Continued events cannot extend that
   deadline. Valid continuation alone needs no refresh; continuation after a
   meaningful change preserves that pending refresh. Invalid, low-confidence,
   failed, and timed-out Jev answers fall back. The API timeout defaults to 5s.
5. For an intent, the trusted caller explicitly chooses source/target sessions
   and captures each backend thread's `activitySeq`, current WorkCard version,
   deterministic status, topic/relationship/owner selection and permitted event
   references. Call `activity.snapshot(keys)` and retain its `warnings`; also
   retain the `sourceRef` returned by `selected_event` for every event included
   in that snapshot. Event `seq` becomes a sparse Flower evidence revision;
   `Thread.activitySeq` and `WorkCard.version` remain separate values.
6. Pass the full `{snapshot,warnings}` envelope to Agent 1's
   `bridge.coordinate_activity(...)`, along with the two trusted bindings and
   source-reference list. The activity revision must equal the captured backend
   `Thread.activitySeq`; otherwise the bridge refuses the stale snapshot. The
   bridge validates citations, invokes the two
   session-analysis AgentApps plus the coordinator AgentApp, and returns
   WorkCard update candidates with `expectedVersion` and `sourceActivitySeq`.
   The caller must submit those candidates through the backend's
   `WorkCards.update` CAS, using `threadId` as the path parameter and only
   `expectedVersion`, `sourceActivitySeq`, and `card` in the request body. Keep
   `analysisMetadata` as a local diagnostic sidecar. A stale conflict means
   discard and refresh. Model `workState` never sets factual status. Awareness
   notes return as pending candidates only: the current backend has no note
   persistence or safe-boundary delivery API, so this step does not deliver into
   OpenCode.

The evidence projection contains `sessions`, `events`, and `workers`, plus empty
result/delivery collections. It does not copy existing approvals, deliveries,
secrets, arbitrary files, or tool inputs/outputs. Each requested shared session
contributes at most 20 events; omissions are reported. Relationship and topic
must come from explicit trusted selection, never be inferred from similar text.
`Activity.apply_summary(...)` remains a local reducer helper; it is not a
substitute for the backend WorkCard CAS.

The scheduler emits intents, **not runs**. A consumed intent is not automatically
retried. The hub/chain adapter owns terminal-run checks, explicit retries, and
durable deduplication across restarts. Persist scheduler state or restore a
watermark before replay if restart-triggered duplicate requests must be avoided.
On unshare, call `set_sharing(key, False)` and `refresh.forget(key)`; cancel local
classification tasks and recheck selection before chain submission/delivery.

Jev implements the documented TypeSafe `POST /v1/systemone` choice interface,
model `jev-latest`, response `answers.change`. See
[TypeSafe quickstart](https://docs.typesafe.ai/introduction/quickstart).
It only returns one of continuation, added_scope, pivot, meaningful_progress,
blocker_change, or None. Provider error bodies are never returned or logged.
An injected client is an async callable accepting the request dict and returning
the same response shape. The confidence threshold defaults to 0.5.

## Provisional contract for Serhat / Talha

The initially inspected main (`5c8e11193`) specifies the SharedEvent envelope but does not
publish `hackathon/contracts/` or concrete `content` schemas. This module does
not claim to define those shared schemas. Confirm these narrow mappings:

* `revision` is the original immutable, project-wide `Event.seq`, a non-negative
  integer with a stable event ID. Project sequences start at 0; revision 0 is
  valid. A thread's replay is sparse in that sequence. Never renumber events into
  a dense per-session counter. The local card revision is the latest selected
  event sequence, or -1 before any event. Retain captured `Thread.activitySeq`
  and `WorkCard.version` separately: the former must match the current thread
  when submitting a summary, and the latter is the work-card compare-and-swap
  version.
* `message.content`: role (user/assistant), selected text, optional actorId.
  `activity.content`: toolName, toolStatus, optional actorId. Unknown fields are
  dropped. Neither message text nor tool status changes session execution state.
* `status.content`: transition, optional instructionId/actorId and descriptive
  objective, approach, currentStep, blocker, recentOutcome. Transitions are queued,
  started, progress, blocked, completed, failed, stopped. queued/started require
  instructionId. Queued fields stay in upNext until started for that ID. A start
  clears the previous blocker; progress never silently resumes a blocked session.
  Explicit replacement objectives implement a pivot; explicit expanded objectives
  implement added scope. Natural-language messages are summarized later by Flower.
* actorId must already have been attributed by the authenticated hub/worker.
  This module performs mapping checks, not authentication or permission checks.
* Snapshot uses `sessions` and `events` collection names. `shared` is a local gate,
  not exported. Summaries/proposals/decisions/awarenessNotes/deliveries are empty
  on purpose: this is input evidence, not fabricated prior chain output. Accepted
  decision retrieval is not implemented in this slice.

## Remaining shared integration decisions

The Flower bridge now consumes this producer envelope and emits backend-shaped
WorkCard update candidates. The remaining decisions belong at the live server /
OpenCode boundary:

* add or expose explicit per-thread share/mute/revocation, topic, relationship,
  and trusted owner metadata so bindings are server-selected rather than
  synthesized by the caller;
* let the background job trigger on Jev refresh intents and invoke the bridge
  with a durable request ID and current snapshot;
* persist source-linked awareness notes and admit them into the exact active
  OpenCode Session at a safe boundary, with stable message identity and separate
  admitted/promoted/used receipts.

These gaps are recorded in C2/C4/C8 of
[`docs/hackathon/integration-gates.md`](../../../docs/hackathon/integration-gates.md).
No live TypeSafe or SuperGrid execution or target-session delivery is claimed by
the local fixture demo.

## Fixtures and expectations

All fixtures are synthetic, with expected card projections, injected classifier
labels, and per-event refresh expectations (each event tested after debounce).
They do not assert a live model's response.

| Fixture | Expected behavior |
| --- | --- |
| deliberate_alternatives | Compact/full cards remain running and distinct; both keep alternative labels |
| keyboard_constraint | Compact recentOutcome carries keyboard focus/Escape constraint; refresh |
| added_scope | Objective expands to include settings access; refresh |
| abandoned_objective | Objective changes to command search; refresh |
| queued_vs_started | Settings stays up next at revision 2, becomes current at revision 3 |
| unrelated_sessions | Navigation and billing topics remain distinct; chain must not force a relation |
| continuation | Ordinary assistant continuation advances revision without a refresh |
| blocker_change | Blocker appears then clears on explicit start; refresh |

The reducer preserves factual status independently of these classifier labels.
Work-card text is capped at 1000 characters per field; evidence references retain
the latest 20 events. The selected event log rejects more than 8000 text characters
per event rather than truncating evidence. Selection/preview must happen upstream:
allowlisting structure cannot prove that free text contains no secrets. Only use
approved synthetic text for the demo. No full conversation importer is provided.
