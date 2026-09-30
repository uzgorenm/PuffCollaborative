# Alice server-error product preview

This launcher connects the React product to the existing OpenCode coordination service. It does not replace the backend. It provisions an isolated SQLite database, two real existing Sessions and two shared Threads, member authentication, the existing real OpenCode runner adapter, and separate Git workspaces. The source repository and its initial commit are disposable fixture data; the product repository is not committed or pushed by the launcher.

Run from the repository with Bun 1.3.14 available:

```sh
bun hackathon/alice-preview/run.ts
```

The backend uses `http://127.0.0.1:4478` by default. Set `PUFF_PREVIEW_SERVER_PORT` to change it. The launcher prints a start command for `apps/web` containing `PUFF_BACKEND_URL` and `PUFF_BACKEND_MEMBER_PATH`, and binds the web proxy with `--hostname 127.0.0.1`. The latter environment variable points to a local `0600` JSON file. Password values are never printed. Run the printed command in a second terminal and open the React product at `http://127.0.0.1:3010/live`.

The member file contains `{url, username, password, userId, names, projectId, sourceThreadId, targetThreadId, runnerAvailability, runnerDiagnostics, credentialsPath, capturePath}`. Its principal is Serdar (`usr_serdar`); Alice owns the source Thread. All requests use the registered `/api/coordination/v1` routes. Member passwords stay server-side in the product proxy.

Alice's source is a **human-authored fixture scenario backed by actual local measurements**. The launcher holds a loopback port, launches a second real Bun server on that port, observes its nonzero exit and `EADDRINUSE`, then launches the same source with `PORT=0` and verifies HTTP 200 from `/health`. It stores the measured finding as Alice's comment, and a completed WorkCard whose evidence points to that exact persisted event ID and sequence. It does not fabricate model messages, runtime events, or model execution. `capture.json` retains the measurement and `checks.json` retains the API checks.

Serdar's task is authored scenario input. His instruction is actually admitted to the shared instruction queue. The launcher attempts a reservation through the existing real adapter. **Without a configured model, preparation is unavailable and no model executes.** The member file reports `runnerAvailability: "model_configuration_missing"`; the actual reserve HTTP response and persisted Run state are retained in `runnerDiagnostics`. There is no mock runner or fixture model fallback.

To enable real OpenCode execution, supply an existing OpenCode JSON config with an explicit `model` of `provider/model`, its provider configuration and approved credentials:

```sh
PUFF_MODEL_CONFIG_PATH=/absolute/path/to/opencode.json bun hackathon/alice-preview/run.ts
```

The launcher provisions a private `0600` `opencode.json` in the isolated global config directory read by the native `Config.Service`, and sets `OPENCODE_CONFIG_DIR` to that directory. It also supplies `OPENCODE_CONFIG_CONTENT` for the legacy CLI loader. The native file loader does not expand CLI variables, so the launcher resolves `{env:NAME}` and `{file:path}` references into the private config before starting the backend. The parent directories are private; resolved credentials and server logs are never printed or returned through the product proxy.

The launcher selects the explicit model for both Sessions, attempts the initial task, and waits briefly for a native result before writing `runnerDiagnostics`. That receipt distinguishes configuration, admitted inputs, native assistant messages, terminal Run state and any provider HTTP error. It polls the real reserve route for later user instructions. The runner is a trusted local worker under the existing runner contract. WorkCard projection is labeled as the recorded human fixture service.

The approved Flower receiving-session test used the official `flower-labs/flwrlabs/endeavor-1.0` model with `@ai-sdk/openai` and the Responses API at `https://api.flower.ai/v1`. The actual reservation succeeded and the task was promoted into the native Session. Its persisted assistant receipt then failed with provider HTTP 401; no successful model output was observed. The configured state alone does not establish usable provider access. Provider setup follows the [official Flower OpenCode guide](https://flower.ai/docs/model/endeavor-opencode.html).

For Flower Endeavor, `opencode.flower.example.json` follows [Flower's official OpenCode setup](https://flower.ai/docs/model/endeavor-opencode.html): the OpenAI SDK uses Responses at `https://api.flower.ai/v1`. Set `FLOWER_API_KEY` in the launching environment, or use a private config with a `{file:/absolute/path/to/key}` reference. No user-wide OpenCode settings are changed. A private file-backed configuration was prepared during this implementation; both the SuperGrid Control preflight and the explicitly approved `/v1/models` check returned HTTP 401 with the supplied credential. Those failures establish that these endpoints rejected the key; they do not establish its expiration or other product scope.

Run the isolated API/process verification from its directory (the repository root intentionally rejects tests):

```sh
cd hackathon/alice-preview
bun test integration.test.ts
bun test web.integration.test.ts
bun test native-config.test.ts
```

This uses backend port 4479 and verifies the measured collision/recovery, exact evidence, invalid evidence rejection, stale WorkCard rejection, exact retries, conflicting retries, outsider access denial, member reserve denial, stale worker callback denial, and exclusion of an unshared Session. Harness mode deliberately closes runtime HTTP routes, including `/api/session/:id/history`; the React source view reads authenticated coordination comments and event replay instead. The product's source reuse action is an explicit queued instruction requested by the owner, not automatic cross-session awareness or an already consumed model input.

The web integration check starts a separate backend on port 4480 and calls the same proxy used by the Next.js route. It checks owner-only writes, cross-origin rejection, source and target revisions, unrelated errors, preserved tasks, one context instruction after retries, and reconciliation after a later source correction.

The native config regression loads the provisioned provider through the actual `Config.Service`, checks migration to the Responses provider, file-reference escaping, and private permissions. It uses a test-only credential and makes no network or inference request.

## Published Flower guardian

`guardian.py` uses the existing Flower 1.39 transport to analyze explicitly selected source and target evidence with `@fertonzi/puff-guardian`. Supply the service credential through an owner-readable local file and an existing Flower Python environment:

```sh
python guardian.py --member /absolute/path/to/member.json --token-file /absolute/path/to/credential --output-dir /absolute/path/to/results --preflight
```

Remove `--preflight` only to run guardian analysis with valid access. The helper retains the correlated run journal and pending identity for ambiguous submission, validates returned citations and unchanged source/target revisions, and never sends its result into the coding instruction queue. This optional helper does not power the current narrow web error matcher. The credential supplied during this implementation was rejected with HTTP 401 before run submission; no paid guardian run or returned analysis was observed. A Flower credential also does not configure the local OpenCode coding model.

`--check-only` verifies and exits while preserving the isolated receipts. Normal execution keeps the service running until interrupted. To repeat with a fresh database, rerun the launcher. Its disposable data directory is printed so it can be inspected or removed after the backend stops.
