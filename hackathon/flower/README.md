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

Status: implementation and local checks are available; real Puff run completion
and result retrieval are **unverified**. The first synthetic live attempt was
rejected by SuperGrid authentication. See [verification.md](verification.md).
Do not present local test outputs as model responses or a successful hackathon demo.

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

The code follows the official [first-AgentApp tutorial](https://flower.ai/docs/agent/tutorials/write-your-first-agentapp.html)
and [application event output sequence](https://flower.ai/docs/agent/how-to-guides/use-openai-sdk.html#publish-agentapp-generated-text).
Runtime model credentials are injected by Flower; they are never copied from
the host or placed in manifests. Both apps make one model call, with no tools,
45-second SDK timeouts, no SDK retries and bounded output tokens.

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
insufficient. Remote event retrieval is still blocked by authentication.

The host validates session results against exactly their input events. The
coordination app sees only those validated results and selected session metadata,
not the full history. The final report's citations must be a subset of the
handoff citations. Runtime `events.jsonl` records the explicit handoff and source
run IDs so a reviewer can inspect exactly what crossed between the apps.

## Input Agent 2 supplies

Call `coordinate(request, snapshot, state_dir=...)` from an asynchronous hub job.
The return value matches the spec's `CoordinationReport`; failures raise
`CoordinationFailure` with a structured `.outcome`. For non-Python callers,
spawn `uv run python coordinator.py --state-dir <private-runtime-directory>`
with an argument array and write `{"request": ..., "snapshot": ...}` to stdin.
Exit 0 yields the report, 1 a job failure, and 2 invalid input. Never execute
report text as a command or use classification to gate coding execution.

The repository had no `hackathon/contracts/` schema at the inspected base commit.
`contracts.py` is a small explicit implementation of the names in
the requested `mvp-spec.md` at `5c8e111931`, pending Serhat's integration mapping.
Incoming main `f9035487d` supersedes that provisional wire design with
[`docs/coordination-contract.md`](../../docs/coordination-contract.md).
The backend now has `Event.id/seq`, `Thread.activitySeq` and
`WorkCard.version/sourceActivitySeq`; these are **not interchangeable with a
per-session revision**. Its `WorkCards.update` is a storage port, not a complete
Flower job/report API. C3/C8 in the integration gates remain open. Agent 2 must
provide the explicit permitted-evidence adapter or use the synthetic envelope
until Serhat freezes that mapping. No backend route, identity or sequence mapping
is invented here. This module does not edit or replace his shared contracts.
The temporary snapshot field names are **sharedSessions**
and **events**; translate them at the caller if the shared schema chooses others.

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
- `sharedSessions`: only opted-in sessions, with `workerId`, `sessionId`,
  `ownerId`, `title`, `featureTopic`, `relationship` (`alternative` or
  `unspecified`), authoritative `revision` and `status`.
- `events`: `eventId`, `projectId`, `workerId`, `sessionId`, `revision`, `kind`,
  `occurredAt`, `content`. Message content allows only `role` (`user` or
  `assistant`) and `text`; activity only `toolName`/`status`; status only `status`.
- References select exactly two sessions, including the target. Each event and
  reference must match the authoritative worker/session/project mapping.
- At most 20 recent events per selected session, with a truncation warning.
  Individual content strings are capped at 8,000 characters; total prepared
  input at 350 KB. A reference outside the selected window fails explicitly.
- Do not pass Agent 2's work cards in place of evidence. The session AgentApp
  needs the bounded permitted events; Agent 2 determines when refresh is useful.

The current slice omits accepted-decision lookup (F5). It drops UI state,
delivery/approval machinery and unrelated history. It rejects extra event
payload fields and recognizable credentials. This filter is a backstop; the
worker/server must still enforce consent, authorization and permitted export.

## Failure and authority boundaries

The host allows 80 seconds for the chain, then kills its local network process
and spends up to four seconds requesting cancellation/observing remote states.
An unobserved terminal state stays unresolved. Run IDs are journaled immediately
after submission, before streaming output. A lost submission response is marked
ambiguous rather than retried. A timeout is never reported as remote cancellation.

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
