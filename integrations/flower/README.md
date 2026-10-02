# Puff Collab Flower integration

The optional Python adapter runs two bounded session analyses concurrently, then passes their validated outputs to one cross-session coordination analysis. These are three Flower runs across two AgentApps (`session` and `coordination`). The retained `guardian` app supports the separate manual worker path. Coding execution uses the OpenCode runtime and does not depend on Flower.

## Set up the optional runtime

You need Python **3.11–3.13**, `uv`, a configured Flower federation, and its model/service credentials. Flower is pinned to **1.39.0** because the transport uses version-specific CLI helpers.

From this directory:

```sh
uv sync --frozen
uv run --project session flwr build --app session
uv run --project coordination flwr build --app coordination
uv run flwr login supergrid
```

The build commands validate local bundles. Login configures access to SuperGrid; it does not submit a run. The adapter defaults to that federation. Set `PUFF_FLOWER_FEDERATION` to another already configured federation if needed. The AgentApps currently select `MiniMaxAI/MiniMax-M3`; the federation must provide its runtime endpoint and credentials.

Start the main workspace with its coding-model configuration and the integration's Python interpreter:

```sh
PUFF_MODEL_PROVIDER=my-provider \
PUFF_MODEL_ID=my-model \
PUFF_PROVIDER_CONFIG=/absolute/path/model.json \
PUFF_FLOWER_PYTHON=/absolute/path/puff-collab/integrations/flower/.venv/bin/python \
bun start
```

Run this command from the repository root. Use the same private product state directory between launches. Keep Flower credentials outside the repository and do not commit `.env`, runtime journals, or bundles.

## Select and review analysis

In a thread's **Team → Thread → Session cooperation** settings, its verified owner can select a feature topic, relationship, and analysis permission. Analysis defaults off. Sharing a conversation grants project members access, but does not grant permission to export it to Flower.

Metadata analysis and instruction/output text are separate permissions. Text selection permits bounded, redacted owner instructions and runner output; it excludes tool arguments, diffs, and comment transcripts. Both source and target threads must have current eligible selections before the launcher can request a cross-session export.

The backend captures identities, bindings, consent versions, and exact source references. `product_export.py` maps that authenticated envelope into the chain. Returned work-card candidates and informational notes are registered and revalidated by the backend. Note admission, transcript promotion, and model use are separate outcomes. A proposed change in task direction requires human approval.

The launcher records Flower attempts and receipts under the private product state directory. A saved selection does not prove that Flower is configured, a hosted job succeeded, or a note reached a model.

## Local checks and recovery

```sh
uv run python -m unittest discover
uv run ruff check .
```

These checks exercise citation validation, redaction, state permissions, retries, and failure handling with local fixtures. They do not prove hosted Flower execution. Hosted execution requires the configured federation and credentials and is not part of the basic source startup.

Requests use a durable private SQLite ledger and journal. Exact retries retain their request and remote run identities; ambiguous submissions are not blindly resubmitted. After a timeout, inspect the journal and use:

```sh
uv run python reconcile.py --project-id PROJECT_ID --request-id REQUEST_ID
```

Use the original state directory. Reconciliation observes known remote runs and requests cancellation; only an observed terminal state resolves them. Do not delete the ledger or switch directories to bypass unresolved work.

`bridge.py` accepts trusted, bounded backend events for standalone analysis. `worker.py`, `approve.py`, and `worker.example.json` retain the manual Guardian workflow; its member/analysis credentials and explicit thread selection require operator configuration. The combined launcher uses the consent-gated export and registered-result path above.
