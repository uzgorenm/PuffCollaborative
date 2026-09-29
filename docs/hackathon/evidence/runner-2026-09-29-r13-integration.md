# R13 assembled runner integration, September 29, 2026

**Tested commit:** `a694a8f3a4d3763c4c447e9ccaea8b7e2a45ac93` on the `serhat` feature branch. **Runtime:** pinned OpenCode `1.18.33`, Bun `1.3.14`. This receipt tests the assembled R2–R12 runner independently of the frontend and Flower jobs. The coordinator gateway is the real embedded `/api/coordination/v1` service. The model endpoint is a deterministic local HTTP fixture; no paid model was called.

## Commands

Run from package directories with Bun `1.3.14` on `PATH`:

```sh
cd packages/server
bun test test/runner-harness.integration.test.ts
bun typecheck

cd ../core
bun test test/runner-harness/report-delivery.test.ts test/runner-harness/recovery.test.ts test/coordination/runner/adapter.test.ts test/coordination/runner/integration.test.ts
bun typecheck

cd ../opencode
bun test test/cli/serve/serve-process.test.ts
```

The server test is both the smoke command and the assembled integration command. Its first case starts the installed `opencode serve` process with the real R1 factory, coordinator routes, R2–R12 modules, a disposable SQLite database, three disposable Git worktrees, and the local model fixture. Its second case starts the same server route graph in a separate process and wraps only the coordinator callback port with a file-controlled `unavailable` response. The test driver preprovisions existing OpenCode Session rows and creates shared projects, Threads, instructions, reservations, approval decisions, and cancellation through authenticated HTTP. The `R13_*_TRACE` lines omit credentials, model endpoint URLs, and absolute paths.

## Results at the tested commit

| Check | Result | Evidence boundary |
| --- | --- | --- |
| Assembled process suite | **PASS:** 2 tests, 93 assertions. The retained host made 9 deterministic model calls; the callback-outage case made 1. | Real coordinator gateway, SessionV2 and SessionExecution, R2–R12 runner, SQLite, Git worktrees, process control; fixture model. Only the second case substitutes the callback response. |
| Callback delivery, recovery, and coordinator adapter suites | **PASS:** 42 tests, 177 assertions. | Real SQLite; coordinator callbacks and several runtime boundaries are simulated. The delivery suite also restarts two actual worker processes. The coordinator adapter integration uses real Queue and EventV2 with a simulated execution port. |
| Server and Core typechecks | **PASS:** `bun typecheck` in each package. | Static verification. |
| OpenCode serve smoke | **PASS:** 2 tests, 5 assertions. | Real subprocess startup, health, and scoped shutdown; no model call. |
| Paid or live model execution | **NOT RUN:** requires a separate explicit opt-in. | No credits spent. |
| Frontend and separately deployed coordinator | **NOT RUN:** outside this test boundary. | HTTP driver replaces the frontend; coordinator is embedded as specified by the current runner contract. |

The assembled process test verified these paths without internal runner mocks:

- An authorized Run used its assigned Git worktree and existing Session. The first coordinator events were `instruction.submitted` → `run.reserved` → `run.started` → `run.output` → `run.completed`, in that order.
- Repeating the same instruction request returned the same Run. A reserve with no pending instruction returned no Run, and the model call count stayed at one. A later instruction reused the Session and worktree. The second model request contained the first prompt and answer; the local Session held two user messages, with the expected assistant messages between them.
- A model-response barrier held one Thread while a second Thread completed. A second start on the held Thread remained queued; a reserve returned no Run. The independent model request had no first-Thread answer, and files in the worktrees stayed separate.
- The pinned V2 `write` tool requested approval through the coordinator. An authenticated HTTP approval resumed the tool, created `artifact.txt` in the intended worktree, and completed the Run. The coordinator received tool, approval, output, and terminal events in order. R11's local terminal artifact report attributed `artifact.txt` to this Run and the preexisting `opencode.json` to work before the Run.
- Direct `POST /api/session/:id/prompt` returned 403 in harness mode. A member reserve and a callback from a stale runner instance also returned 403.
- A hanging model response was cancelled through HTTP. The immediate response was `cancelling`; the independently observed state became `recovery_required`, with `interrupt_abort=acknowledged`, `interrupt_state=stopped`, and no `terminal_at`. This is a safe hold: the runner did not treat abort acknowledgment as proof that every tool or descendant had stopped.
- After killing and restarting the real server against the same SQLite file, that uncertain Run remained `recovery_required`. First-Session input rows stayed at five and model calls stayed at eight. A new Run on another Thread then completed with one further model call while the uncertain Run stayed held. The restart did not repeat uncertain provider work or block unrelated work.

The separate callback-outage case used the real runner and coordinator with one controlled external substitute: the coordinator callback port returned typed `unavailable` while a fixture flag existed. The model response was held until `run.started` reached the coordinator. The runner then persisted `run.output` and a terminal callback in its SQLite outbox; the output callback was unacknowledged and had a failed attempt while the coordinator still showed `running`. The test killed the runner process, removed the fault flag, and restarted it. All three outbox callbacks were acknowledged in order; the coordinator received `run.started` → `run.output` → `run.completed`. The Session still had one admitted input and the model still had one call.

Sanitized trace excerpt from the process suite:

```text
first Run: instruction.submitted > run.reserved > run.started > run.output > run.completed
approval Run: run.tool > run.approval.requested > run.approval.resolved > run.output > run.completed
artifact report: during=[artifact.txt], prior=[opencode.json]
cancel: acknowledged=cancelling, observed=recovery_required, terminal_at=null
restart: first-Session input rows 5 > 5; uncertain Run still held; other Thread completed
callback outage: output failed attempts=1; callbacks acknowledged after restart=3; input rows=1; model calls=1
```

## Remaining verification

The R7/R10 tests separately prove typed coordinator callback outages and retry with stable callback IDs against real SQLite, including one two-process restart. The assembled suite's callback fault is at the coordinator `Runner.report` response boundary. It does not simulate a network partition between two deployed services, because the current coordinator and runner share one process. An attempted SQLite insert trigger was discarded: it caused a shared database defect, not a coordinator service outage, so it was not counted as a passing outage test.

The process cancellation left an uncertain Run held. A confirmed `cancelled` terminal state under a provably idle runtime remains unverified end to end. R9's component tests cover confirmed stop, lost abort response, and outstanding tool cases with controlled runtime substitutes. R3's post-wake idle monitor has component coverage; this receipt does not claim a real process reproduction of every pre-stream failure. The current runtime readiness path checks model availability before prompt admission.

The runner contract states that the pinned V2 spawner still inherits the host environment and that per-Run tool environment and permission policy are not yet enforced at the process boundary. This receipt therefore covers trusted local workers. No frontend, Flower job, external deployment, or live model participated. The [R13 preflight receipt](runner-2026-09-29-r13-preflight.md) keeps earlier component and mock-backed checks separate from the assembled process evidence above.
