# Puff web workspace

The copied Next.js interface now defaults to a real authenticated coordination service. It groups recorded work by person, then by individual Session; one person can run several Sessions in parallel. The original sample workspace is available through **Try demo** and stays separate from live data.

## Run the combined product

From the repository root, with Bun on PATH:

```sh
bun run product
```

Open <http://127.0.0.1:3006>. The launcher owns a loopback-only backend, Next.js process, isolated SQLite database and approved Git worktrees. It stops its own children on Ctrl-C. Data and individual local member credentials persist in the private sibling `.puff-product-runtime` directory. Another launcher cannot use that same runtime concurrently; the backend address remains stable across restarts.

The fixed local roster is Serdar, Serhat, Talha and Ferit. The default browser identity is Serdar. `PUFF_PRODUCT_MEMBER=serhat` selects the default login for a new connection; an existing browser connection retains its identity until explicitly changed. Connection settings can authenticate another member with its local credential. Display names do not grant access.

The root Bun dependencies and this package's npm dependencies must be installed. This package retains its own npm lockfile:

```sh
cd apps/web
npm ci
```

For a standalone interface, `npm run dev` listens on port 3006 and Connection settings accepts a running loopback coordination backend. Without a connected backend, live mode shows the connection error and never invents teammate activity. `npm run build` and `npm start` provide a production preview of the interface.

## Coding model configuration

A model provider is required before a real coding Session can be created. Configure the launcher with an existing OpenCode provider configuration; do not commit that file or paste keys into chat:

```sh
PUFF_MODEL_PROVIDER=provider-id PUFF_MODEL_ID=model-id PUFF_PROVIDER_CONFIG=/absolute/private/opencode.json bun run product
```

The provider configuration stays in the isolated global OpenCode config directory, outside agent worktrees. Each provisioned Session has a durable owner and a separate approved worktree. The model readiness check confirms the registered/native-supported model, not a successful paid model request.

## Live workflows

- Save a versioned project brief and your personal focus. Person totals combine recorded Session summaries and label their freshness separately from stated focus.
- Create an explicitly shared Session and send owner instructions. New Sessions do not replace existing parallel work. Failed or interrupted requests retain the exact request identity through reload.
- Read teammate conversations and add comments. Only a provisioned Session's verified owner can instruct, cancel its Run, or decide a tool permission.
- Inspect exact cited events before sending reviewed context. Source identity and target identity remain distinct. This creates a human instruction; receipt, execution and actual use are separate evidence.
- Review the actual native tool, arguments and permission scope before approving. The scope is rechecked after a versioned claim. Missing or changed review details keep Allow unavailable. A recorded decision awaiting forwarding is shown separately from delivery.
- Opt selected Sessions into Flower analysis with a topic and open/complementary/alternative relationship. Deliberate alternatives remain valid. Analysis defaults off and requires owner consent. A separate text choice permits bounded owner instructions and already-redacted runner output; metadata-only analysis excludes that text. Runtime journals retain run IDs, mapped reports and pending proposals.

Private Sessions are not implemented by this provisioning service (`privateSessions:false`); the live UI explicitly creates shared Sessions. Demo privacy controls remain illustrative.

## Flower processing

Install the pinned environment described in [the Flower README](../../hackathon/flower/README.md), authenticate Flower separately, and provide its Python executable:

```sh
PUFF_FLOWER_PYTHON=/absolute/path/to/flower/.venv/bin/python bun run product
```

The serialized background connector captures only server-authorized selected evidence, executes the existing two-AgentApp/three-run chain, validates citations and revisions, and submits source/version-checked WorkCards. A trusted analysis identity registers informational findings. When the target owner opted into notifications, the existing active Session can admit the finding and promote it at the next safe boundary. A stopped or changed target can leave delivery pending/stale; it is not reported as use. Lost responses remain an unknown outcome until a durable receipt confirms admission. Historical receipt reconciliation never replays stale analysis or delivery. Redirection proposals are never automatically adopted.

Hosted analysis depends on Flower login, service availability and provider configuration. Local fixture tests do not establish successful live model execution, hosted analysis or receiving-agent use. The legacy simulator `/api/sessions` route remains separate and is not used by the live controller.

## Verify

From `apps/web`:

```sh
npm test
npm run typecheck
npm run build
```

Transport tests use a real local HTTP fixture; controller tests exercise identity switching, exact retries, source references and permission review. Core/server fixtures verify real worktrees, ownership, the embedded OpenCode runner and safe-boundary admission against a deterministic test model. Browser acceptance and actual hosted execution are separate checks. Integration evidence is recorded in [next-product-integration.md](../../docs/hackathon/next-product-integration.md).

The Puff logo remains `public/puff-logo.png`.

## Repeat the original demo

Choose **Try demo**, then **Reset workspace** and confirm to restore the source interface's six starting Sessions for You, Sam and Alice. **Undo reset** restores the previous demo workspace, including after reload. These controls affect browser demo storage; the live service remains separate.

The original walkthrough supports project setup/task assignment, reviewing Sam's overlapping frontend work, starting complementary work or an alternative, and inspecting Alice's recorded `EADDRINUSE` finding before adding it as context. Its compact sidebar shows five Session rows before an expandable overflow and a collapsed recent-update view. Custom tasks produce independent illustrative plans; an unrelated server error never inherits the port-conflict finding. Choose **Return to live workspace** to resume the authenticated service.

## Render the walkthrough video

`scripts/render_walkthrough.py` turns screenshots captured from the running interface into one MP4. It retains the captured application UI, adds a bottom caption band, and overlays an animated mouse cursor and click rings. This is a screenshot-based walkthrough of browser interactions, with cursor animation added during encoding; it is not a continuous screen recording or evidence of live agent execution.

Requires a Python runtime with Pillow and an `ffmpeg` executable. For this machine:

```sh
/opt/homebrew/bin/python3 scripts/render_walkthrough.py /absolute/path/to/manifest.json --ffmpeg /opt/homebrew/bin/ffmpeg
```

Example manifest:

```json
{
  "title": "Puff • Interactive demo walkthrough",
  "output": "puff-walkthrough.mp4",
  "steps": [
    {
      "image": "frames/01-project-overview.png",
      "caption": "Review each person's total work and open a session.",
      "duration": 4.5,
      "cursor": [420, 260],
      "click": true
    }
  ]
}
```

Image and output paths are relative to the manifest unless absolute. Cursor coordinates use the original screenshot's pixels. `duration` defaults to 4.5 seconds; `cursor` and `click` are optional. The encoder preserves screenshot proportions inside a 1280 × 720 area, adds a 90-pixel caption band, and streams H.264 video at 24 fps to a 1280 × 810 MP4. No audio track is added.
