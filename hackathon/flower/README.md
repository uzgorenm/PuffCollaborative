# Puff Flower chain (Agent 1)

Two actual Flower 1.39.0 AgentApp projects implement distinct responsibilities:

1. `session/`: one bounded session analysis. Invoked once for A and once for B,
   concurrently, in separate SuperGrid runs and fresh run series.
2. `coordination/`: one bounded cross-session analysis. Invoked only after both
   session runs are `finished:completed` and their outputs pass citation checks.

There are **two AgentApps and three runs** for a two-session request. The local
Python adapter explicitly passes the completed analysis outputs and their run
IDs to the coordination app. This is a host-mediated agent chain, **not native
Grid communication**. No app is published by these commands.

Status: a fresh **synthetic** two-AgentApp chain completed on SuperGrid with
three terminal runs and a source-linked result. See the
[live receipt](../../docs/hackathon/evidence/codex-flower-live.md). Real Puff
session export, receiving-agent use and Flower Hub publication remain unverified.
The earlier authentication failure is recorded in [verification.md](verification.md).
The Activity/Jev producer-to-chain adapter is also locally connected. Its
separate synthetic adapter checkpoint could not reach SuperLink and started no
new hosted run; see the [bridge receipt](../../docs/hackathon/evidence/2026-09-29-ferit-activity-flower-bridge.md).
Local adapter output does not establish a model response or live Puff delivery.

## Guardian mode (default product path)

`guardian/` is a third AgentApp, run once per coding agent whenever Jev reports
a meaningful change in that agent. Its input is the agent's instruction and
last 30 events plus the other agents' board cards; its output is the agent's
own board card and, only when the agent drifts into another agent's files or
feature, a correction instruction for that agent.

```text
OpenCode A/B events -> server -> worker.py -> Jev (reporter, per agent)
  -> guardian:<thread> on SuperGrid (Endeavor) -> PUT work-card (shared board)
  -> overlap? -> correction proposed, or sent with POST /threads/:id/instructions
```

Run from `hackathon/flower/`:

```powershell
copy worker.example.json worker.json   # fill serverUrl, projectId, thread IDs
.\.venv\Scripts\python.exe worker.py --config worker.json
.\.venv\Scripts\python.exe approve.py --config worker.json          # list proposals
.\.venv\Scripts\python.exe approve.py --config worker.json RUN_ID   # send one
```

Secrets live only in the git-ignored `.env`: `TYPESAFE_API_KEY` (Jev),
`PUFF_ANALYSIS_USER`/`PUFF_ANALYSIS_PASSWORD` (the server's `analysis`
identity), and `PUFF_MEMBER_USER`/`PUFF_MEMBER_PASSWORD` (needed to submit
instructions; the server allows only members to do that). With
`"autoSend": false` (default) corrections wait for owner approval in
`.runtime/worker/corrections.jsonl`; `true` sends them immediately.
Guardian-tagged instructions never re-trigger a guardian, and the same
correction is not repeated within `correctionCooldownSeconds`. Instructions are
queued, so the agent receives a correction when its current run ends.
`"mode": "chain"` keeps the two-analysis-plus-coordination chain below.

## Setup and checks

Run these from `hackathon/flower/`, not the repository root:

```sh
uv sync --frozen
uv run python -m unittest discover -v
uv run ruff check .
uv run --project session flwr build --app session
uv run --project coordination flwr build --app coordination
uv run flwr login supergrid
uv run python smoke.py --request-id navigation-001
uv run python smoke.py --request-id unrelated-001 --unrelated
```

Use the same state directory across requests and processes. Runtime input,
validated handoff, run IDs, terminal states, application results and errors are
under ignored `.runtime/`. Do not place runtime data inside either AgentApp
project. FAB inspection should show only `pyproject.toml`, `LICENSE`, `agent/`
and Flower bundle metadata. The original starter checkout is not a dependency.
On POSIX hosts the adapter tightens existing state directories to mode `0700`
and files (including the SQLite ledger and journal sidecars) to `0600`; new
files are created owner-only before writing. It fails closed on hosts without
this permission implementation. This local file boundary does not authenticate
the selected export or replace server-side sharing consent.

The code follows the official [first-AgentApp tutorial](https://flower.ai/docs/agent/tutorials/write-your-first-agentapp.html)
and [application event output sequence](https://flower.ai/docs/agent/how-to-guides/use-openai-sdk.html#publish-agentapp-generated-text).
Runtime model credentials are injected by Flower; they are never copied from
the host or placed in manifests. Both apps make one model call, with no tools,
120-second SDK timeouts, no SDK retries and bounded output tokens.

## Handoff and output channel

`transport.py` pins Flower to 1.39.0 and uses the same version-specific Python
CLI internals as `flwr chat`: `build_local_agent`, `start_chat_run` and the
authenticated Control HTTP client. This thin compatibility layer is not a
stable public Flower SDK and must be reverified before upgrading Flower.

Each AgentApp parses its model JSON and emits a single application envelope
through `agent.events.emit(response.output_text.delta)`, followed by
`response.completed`. The envelope contains `schemaVersion`, `runId`, `result`.
The host consumes **StreamRunEvents**, bounds output, checks the envelope run ID,
and separately polls **ListRuns** for `finished:completed`. It never reads a
printed log as an application result. Completion of a model response alone is
insufficient. The synthetic live receipt verifies result retrieval through this channel.

The host validates session results against exactly their input events. The
coordination app sees only those validated results and selected session metadata,
not the full history. The final report's citations must be a subset of the
handoff citations. Runtime `events.jsonl` records the explicit handoff and source
run IDs so a reviewer can inspect exactly what crossed between the apps.
Historical events can remain in an analysis and can provide target-session
context. Every non-target source citation in a pending note or proposal must
match that source session's captured `revision`. If A has a later correction
and a finding cites A's older event, report assembly fails instead of labeling
the note with a newer `sourceRevision`. A retained B event may be cited without
claiming B is still current; the server must recheck B's state at delivery.
For the Activity bridge, Flower's `revision` carries each exact project
`Event.seq`; captured `Thread.activitySeq` and `WorkCard.version` remain
separate server values. The synthetic low-level smoke fixture retains its
provisional revision values. Both apps use the configured
`openai/gpt-5.6-sol` model; execution, credentials and result transport run
through Flower.

## Activity/Jev handoff

Use `bridge.py` for the producer-to-consumer boundary. `coordinate_activity(...)`
accepts Agent 2's `{snapshot,warnings}` activity envelope, a request, two trusted
thread bindings and a source-reference list. It validates the selected evidence,
calls the existing three-run Flower chain, and maps the result back to server-
shaped work-card updates and pending note/proposal candidates.

A non-Python background worker can call
`uv run python bridge.py --state-dir <private-runtime-directory>` from this
directory. Send one JSON object on stdin with exactly these keys:

```json
{
  "request": {
    "requestId": "stable-job-id",
    "projectId": "puff-demo",
    "targetThreadId": "thread-B",
    "question": "Which finding from A is useful to B?",
    "evidenceRefs": [
      {"threadId":"thread-A","eventId":"event-A","seq":4},
      {"threadId":"thread-B","eventId":"event-B","seq":7}
    ],
    "createdAt": "2026-09-29T19:00:00Z"
  },
  "activitySnapshot": {"snapshot": {}, "warnings": []},
  "bindings": [],
  "sourceRefs": []
}
```

`activitySnapshot` is the selected output of `Activity.snapshot()`. Each of the
two `bindings` must include the authoritative project/thread/worker/session and
owner identities, title/topic/relationship, `shared: true`, captured
`activitySeq`, expected `WorkCard.version`, deterministic WorkCard status and
contributors. The current `Thread` schema does not provide all session-sharing
metadata; the caller must not infer consent, topic, relationship or owner from a
title or project membership.

`sourceRefs` is a JSON list pairing Flower's internal citation with the exact
backend event reference:
`{"flowerRef":{"workerId":"...","sessionId":"...","eventId":"...","revision":4},"sourceRef":{"threadId":"thread-A","eventId":"event-A","seq":4}}`.
The bridge keeps this mapping outside model input and rejects missing, mismatched
or stale citations. Event `seq` is a project-wide sequence, sparse within each
thread, and may start at 0; selected events cannot reuse a project sequence. It
becomes Flower's evidence revision. `Thread.activitySeq` is carried separately
as `sourceActivitySeq`, and `WorkCard.version` stays separate as
`expectedVersion`.

The session analysis returns objective (`task`), current step (`progress`),
blockers, evidence-backed `recentOutcome` or null, and approach. The bridge maps
the outcome to the backend's `recentVerifiedOutcome`; an unverified requirement
or plan stays null. Contributors and factual status come from trusted bindings,
not model output.

After the chain returns successfully, stdout includes the three completed
Flower run IDs, two `workCardUpdates`, source-linked
`awarenessNoteCandidates` marked pending/not attempted, approval-required
`proposalCandidates`, and both producer and Flower warnings. The CLI does not
write work cards, persist awareness notes, or deliver context into OpenCode.
For each work-card candidate, use `threadId` as the endpoint path parameter and
send only `expectedVersion`, `sourceActivitySeq`, and `card` as the request
payload. `analysisMetadata` is a diagnostic sidecar, not a server field. A
successful chain state means Flower completed and candidates were mapped; it
does not mean the server persisted them or OpenCode delivered them.
The current server has no published session-level sharing/topic controls or
awareness delivery/admission API, so those remain server/OpenCode integration
gates (C2/C4/C8). A returned candidate is never evidence of delivery or use.

Run `python bridge_demo.py` from this directory for the local producer-to-
consumer walkthrough. It uses the checked-in synthetic navigation history and a
synthetic structured Flower report to show field and citation mapping. It does
not call Flower, write through the backend, or send a message to OpenCode.

`coordinator.py` remains the lower-level interface for an already normalized
Flower request/snapshot; `smoke.py` supplies synthetic inputs for that path.
Do not pass work cards in place of bounded source events. The server must still
enforce consent, authorization and a fresh `activitySeq`/version CAS before
accepting any update or note.

## Low-level normalized chain input

Call `coordinate(request, snapshot, state_dir=...)` only when the caller has
already produced the normalized input below. The higher-level producer should
use `bridge.py`. Failures raise `CoordinationFailure` with a structured
`.outcome`. For non-Python callers of this lower-level entry point, spawn
`uv run python coordinator.py --state-dir <private-runtime-directory>` with an
argument array and write `{"request": ..., "snapshot": ...}` to stdin. Exit 0
yields the report, 1 a job failure, and 2 invalid input. Never execute report
text as a command or use classification to gate coding execution.

`contracts.py` describes the normalized input used inside the Flower chain; it is
not a replacement for the current server contract in
[`docs/coordination-contract.md`](../../docs/coordination-contract.md). The
server distinguishes `Event.seq`, `Thread.activitySeq`, and `WorkCard.version`;
the bridge keeps them separate. The current server can compare-and-swap WorkCard
updates, but it does not expose a complete Flower job/result or awareness-note
delivery API. Session consent/topic/relationship metadata is also missing from
the published `Thread` schema. C2/C4/C8 therefore remain open; this bridge does
not edit or replace shared backend schemas.

**Selected export remains unimplemented.** `prepare` validates the envelope it
receives but cannot authenticate an owner or prove that `sharedSessions` came
from current opt-in decisions. A production caller must first resolve the
authenticated owner's selected A/B Threads, project membership, worker/Session
binding, sharing and mute state from the backend; capture only permitted events
from those Threads; and resolve each cited `Event.id` with its project-wide
`Event.seq` separately from the captured `Thread.activitySeq` and replay cursor.
That trusted capture must precede `coordinate`, and the server must repeat
source/target consent, identity and currentness checks before saving or
delivering a result. No such producer or authenticated Flower job/result port
is implemented here. A client-supplied JSON envelope, local field filtering,
and owner-only `.runtime` permissions are not evidence of private export consent.

```json
{
  "request": {
    "requestId": "unique-stable-id",
    "projectId": "puff-demo",
    "targetWorkerId": "worker-B",
    "targetSessionId": "B",
    "question": "Which finding is relevant to B?",
    "evidenceRefs": [
      {"workerId":"worker-A","sessionId":"A","eventId":"event-A","revision":1},
      {"workerId":"worker-B","sessionId":"B","eventId":"event-B","revision":1}
    ],
    "createdAt": "2026-09-29T19:00:00Z"
  },
  "snapshot": {
    "schemaVersion": 1,
    "projectId": "puff-demo",
    "workers": [],
    "sharedSessions": [],
    "events": [],
    "summaries": [], "proposals": [], "awarenessNotes": [],
    "decisions": [], "deliveries": []
  }
}
```

The empty lists above are shape placeholders, not executable input. Use
`python smoke.py --request-id example --write-input input.json` for a complete
synthetic envelope (do not write it inside an AgentApp project).

- `workers`: matching `workerId`, `projectId`, `ownerId`; extra server fields are
  not forwarded.
- `sharedSessions`: exactly the selected sessions, with `workerId`, `sessionId`,
  `ownerId`, `title`, `featureTopic`, `relationship` (`alternative` or
  `unspecified`), latest selected evidence `revision`, and deterministic `status`.
- `events`: `eventId`, `projectId`, `workerId`, `sessionId`, `revision`, `kind`,
  `occurredAt`, `content`. Message content allows `role` (`user` or `assistant`)
  and `text`; activity allows `toolName`/`toolStatus`; status allows `transition`,
  optional `instructionId`, `objective`, `approach`, `currentStep`, `blocker`,
  and `recentOutcome`. Attributed `actorId` is stripped before Flower sees input.
- References select exactly two sessions, including the target. Each event and
  reference must match the authoritative worker/session/project mapping.
- At most 20 recent events per selected session, with a truncation warning.
  Individual content strings are capped at 8,000 characters; total prepared
  input at 350 KB. A reference outside the selected window fails explicitly.
- Flower `revision` carries the original sparse, nonnegative `Event.seq`, not a
  dense per-session counter. It is evidence identity only; captured
  `Thread.activitySeq` and `WorkCard.version` remain separate server CAS values.
- Do not pass Agent 2's work cards in place of evidence. The session AgentApp
  needs bounded permitted events; Jev determines when a refresh is useful.

The current slice omits accepted-decision lookup (F5). It drops UI state,
delivery/approval machinery and unrelated history. It rejects extra event
payload fields and recognizable credentials. This filter is a backstop; the
worker/server must still enforce consent, authorization and permitted export.

## Failure and authority boundaries

The host allows 300 seconds for the two sequential model stages, each with a
120-second SDK timeout plus remote startup overhead, then kills
its local network process and spends up to four seconds requesting
cancellation/observing remote states.
An unobserved terminal state stays unresolved. Run IDs are journaled immediately
after submission, before streaming output. A lost submission response is marked
ambiguous rather than retried. A timeout is never reported as remote cancellation.
Cancellation and reconciliation read complete journal lines even if a killed
writer left a partial final line; the next record starts on a new line.

An embedded standard-library SQLite ledger reserves request IDs atomically;
it is not a new database service. Same-ID retries return the saved result/failure;
different evidence under the same ID is rejected. This first fixed-project
adapter serializes chain requests within its state directory. Pending or
unresolved previous jobs block **new coordination submissions only** until
inspected; OpenCode coding remains independent. Do not bypass this by switching
state directories or deleting the ledger.

For known run IDs after a timeout, use:

```sh
uv run python reconcile.py --project-id puff-demo --request-id navigation-001
```

This observes statuses/requests cancellation without resubmitting. Only observed
terminal states clear known unresolved runs. An interrupted host or lost
submission response with no run ID requires operator inspection in SuperGrid;
there is deliberately no blind replay/reset command. Failures preserve run IDs,
terminal states, safe error categories and warnings rather than raw auth traces.

The hub must revalidate snapshot revisions and opt-in/mute state **at delivery**.
An immutable snapshot cannot establish that evidence is still current later.
Reports do not authorize delivery. Proposed redirections always remain
`state: proposed`; no approval is fabricated. Informational notes use factual
wording, cite both sessions, and pass a conservative redirection-word check.
This lexical check is not a semantic safety proof; the server owns final routing
and human review of uncertain instructions. No-relation reports have empty
notes/proposals. Alternative labels cannot become overlap proposals.

Agent 1 owns these two projects, adapter and tests. Agent 2's `activity/` and
`fixtures/` directories are untouched. No worker, hub, dashboard, publication
or submission is implemented here.
