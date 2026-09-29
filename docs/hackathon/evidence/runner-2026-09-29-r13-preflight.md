# R13 runner preflight, September 29, 2026

Source commits: `81c5a4ef17b2568f5ff58d86ccbd4b549b5aaebb` for the subprocess and coordinator checks, then `dafcc1745ff2f762dd67a24a55947aad5418f13a` for the pinned Session tests and core typecheck. Bun version: `1.3.14`, matching `package.json`. This receipt covers the repository baseline and R1's foundation. It does not verify R2–R12 or a real coordinator-to-OpenCode turn.

## Commands and results

The host had no Bun executable on `PATH`. I installed Bun `1.3.14` outside the repository, then ran `bun install --frozen-lockfile --ignore-scripts` and `bun run --cwd packages/core fix-node-pty`. The first `bun install --frozen-lockfile` attempt failed only because its postinstall script could not find `bun` on `PATH`. With Bun on `PATH`, the focused commands are:

```sh
cd packages/opencode
bun test test/cli/serve/serve-process.test.ts

cd ../server
bun test test/coordination.integration.test.ts

cd ../core
bun test test/session-runner.test.ts -t 'runs different sessions concurrently'
bun test test/session-prompt.test.ts -t 'resumes through a recorded message without appending another prompt|rejects reuse of one ID with a different prompt'
bun typecheck

cd ../server
bun typecheck

cd ../opencode
bun typecheck
```

| Check | Result | Evidence level |
| --- | --- | --- |
| `opencode serve` starts and answers `/global/health` | **FAIL:** both subprocess tests failed before the server became ready. | Installed OpenCode, no model calls |
| Coordinator HTTP flow with explicit mock runner | **PASS:** 1 test, 51 assertions. | Coordinator service plus mock execution port |
| Pinned Session concurrency and stable prompt identity | **PASS:** 3 focused existing tests, 9 assertions. | SessionRunner with a deterministic LLM double; SessionV2 with an execution double. No runner harness |
| Core typecheck after foundation | **PASS.** | Static check |
| Server typecheck after foundation | **PASS.** | Static check |
| OpenCode typecheck after foundation | **FAIL:** `server.ts:276` still requires `CoordinationAuth` and `CoordinationRuntime`. | Static check |
| R2–R12 integration scenarios | **BLOCKED:** foundation commit and modules were absent at this source commit. | Not run |

The first subprocess run failed because the host had no `bun` on `PATH`. After making the pinned Bun executable available to child processes, the actual startup failure was:

```text
opencode serve did not become ready within 15000ms
Service not found: @opencode/CoordinationRuntime
0 pass; 2 fail
```

At the earlier commits, the OpenCode route graph in `packages/opencode/src/server/routes/instance/httpapi/server.ts` merged `@opencode-ai/server` handlers without the `coordinationLayer` supplied by `packages/server/src/routes.ts`. The coordinator mock test used the latter route graph and passed. R1 received this reproduction. The gap was fixed by incoming `origin/main` commit `e13a0da`, included in the later `serhat` test commit below.

The remote had no `origin/serhat` ref during this preflight. No runner code was changed, no live model was invoked, and no credential value is included here.

## Follow-up at `7b8ee778e7a14314eb2c161698a6bf7f673f6056`

This commit includes R4 Session binding, R7 callback delivery, and the shared OpenCode route fix. The following commands passed with Bun `1.3.14`:

```sh
cd packages/core
bun test test/runner-harness/session.test.ts test/runner-harness/report-delivery.test.ts

cd ../opencode
bun typecheck
bun test test/cli/serve/serve-process.test.ts test/server/httpapi-coordination.test.ts
```

R4 and R7: **11 pass, 52 assertions** with real SQLite. Their tests use coordinator and model substitutes; R7's restart case launches two actual worker processes. OpenCode: **3 pass, 11 assertions** for subprocess startup, scoped shutdown, and the unconfigured coordination route. OpenCode typecheck also passes. These checks confirm installed OpenCode can start without a model call; they do not execute an authorized runner turn.

At `bc639d5`, the R12 security tests also passed: **3 core tests, 29 assertions**, plus **1 server authorization test, 7 assertions**. They cover worker and instance scope, canonical workspace roots, destination/tool policy, and direct runtime access. The assembled runner has not yet called these policies in an integrated test.

At `42e6153`, the R6 event ingestion tests passed: **5 tests, 13 assertions**. They use pinned Session event shapes and verify Run correlation, durable replay, permission matching, and exclusion of unrelated events. Core typecheck passed. R6 had not yet been connected to R5 and R7 in this run.

At `98b7c4d`, the R3 runtime tests passed: **10 tests, 35 assertions**, and core typecheck passed. They use service doubles to check attachment, owner conflict, observation before wake, interruption evidence, and scoped shutdown. They do not verify a real OpenCode drain or process termination.

At `b0cf4c6`, the R2 workspace tests passed: **4 tests, 29 assertions** with disposable Git repositories and worktrees. They cover separate paths, later-turn file persistence, adoption of a bound worktree, path rejection, and guarded cleanup. They do not start a runner turn.

At `8eb61f7`, the R8 approval and R9 cancellation tests passed: **18 tests, 65 assertions**, and core typecheck passed. R8 uses real SQLite with inert native permission actions; R9 uses lifecycle and runtime doubles. The results cover exact decision retry, scope checks, and the distinction between abort acknowledgment and confirmed stop. They do not prove a CLI-driven approval or cancellation of an assembled OpenCode run.

At `f4e7e52`, the R11 artifact tests passed: **2 tests, 37 assertions** with disposable Git changes. They distinguish new work from a dirty baseline and reject another Thread's baseline. The result has not yet traveled through R7 to the coordinator.

At `e83a0bb`, the coordinator process smoke passed: **1 test, 23 assertions** through authenticated HTTP, real SQLite, and the registered coordinator routes. Its separate execution process is explicitly a fake. The sanitized trace ordered `instruction.submitted` → `run.reserved` → `run.started` → `run.output` → `run.completed`; another Thread started while the first was active. This is gateway evidence, not a coordinator-to-OpenCode runner pass.

The focused coordinator regression at the same commit **failed**: `bun test test/coordination-e2e/suite.test.ts -t 'runner output must advance the citable activity revision'`. A committed `run.output` event had sequence 8 while the Thread's `activitySeq` remained 4. The coordinator therefore rejected a work card citing the output. The assertion remains intact; the responsible queue/activity projection belongs to the coordinator team.

The coordinator corrected that projection in `4d0f19a`, included in `b3eeb0c`. R13 reran the same process case at `b3eeb0c`: **1 pass, 12 assertions**. This closes that recorded regression under the fake runner gateway fixture; it does not establish a real runner callback path.

At `127b473`, the R10 recovery tests passed: **13 tests, 42 assertions** with persisted SQLite records and dependency doubles. They hold ambiguous execution, avoid waking a promoted drain after replacement, and retry unacknowledged callbacks with stable identities. A real runner process restart remains unverified.

At `04d1885`, R5's lifecycle and affected cancellation tests passed: **24 tests, 86 assertions**. The lifecycle tests use real SQLite with dependency doubles for the unassembled modules. They cover duplicate and conflicting starts, separate Thread concurrency, ambiguous admission, callback ordering, and failure handling. Normal completion through a real embedded Session drain remains an integration requirement.

At `53e1b4a`, R6's observer readiness follow-up passed: **6 tests, 15 assertions**, and core typecheck passed. The new case checks that observation readiness follows listener registration, durable replay, and pending permission inspection. R3's runtime and R5's lifecycle still need to consume the same readiness contract in the assembled runner.

Other affected follow-ups passed before this source commit: R7 callback delivery at `ec781c2` (**8 tests, 31 assertions**); R2 workspace plus R9 cancellation at `fa6b5da` (**15 tests, 63 assertions**); R9 duplicate cancellation intent at `d2665be` (**11 tests, 36 assertions**). These remain component checks. They do not replace an embedded OpenCode turn, a process restart, or delivery through the real coordinator gateway.

At `2ba8dae`, the coordinator added a deferred `runnerFactory` port. Server typecheck and its existing HTTP integration test passed (**1 test, 51 assertions**). That test still supplies an explicit mock runner. The factory allows the real runner to be constructed after the coordinator's shared database and access services exist, then bound to `Runner.report` before routes become ready. The R1 runner factory and fixture have not yet been published at this commit.

At `968c64e`, the shared R3/R5 contracts and implementations for observer readiness, natural drain settlement, artifact persistence, and runtime reattachment landed. R13 ran the affected R3/R5/R6/R9/R10 tests together: **58 pass, 212 assertions**, plus core typecheck. These tests still use module doubles at their boundaries. The assembled runner must prove the corresponding behavior with one real SessionExecution and the configured callback path.

At `7d53fbd`, R3 preserved ownership of a woken Session after its observer fails so shutdown still interrupts the drain. R13 reran its affected runtime suite: **15 pass, 49 assertions**. The check uses a SessionExecution service double; real process cleanup remains a separate observation.

## Runner scenario ledger at the foundation commit

All rows below are **NOT RUN** against an assembled runner. They remain open until the named real modules are connected and the exact tested commit is recorded.

| Scenario | Required runner modules |
| --- | --- |
| Authorized Run reaches its workspace and existing Session | R2, R4, R5, R12 |
| Separate Threads run concurrently without overwrites | R2, R3, R5 |
| Same-Thread conflict and duplicate start are safe | R5, foundation active-Run guard |
| Later turns retain Session history and workspace files | R2, R4, R5 |
| Messages, tools, artifacts, and terminal outcome reach the coordinator in order | R6, R7, R11 |
| Human tool approval and cancellation work through a CLI driver | R8, R9 |
| Cancellation acknowledgment waits for confirmed termination | R3, R9 |
| Callback outage drains persisted output in order | R7, R10 |
| Restart reconciles uncertain execution without repeating it | R5, R10 |
| Stale ownership and unauthorized commands are rejected | R4, R12 |

R3 and R5 identified two integration gaps after the component checks: the observer registration must be acknowledged before R5 admits a prompt, and naturally idle drains need an exact terminal observation before R5 can report completion. Their follow-up changes are pending. R13 will require a real embedded Run to reach local `completed` and an ordered coordinator terminal callback before closing either scenario.

R3 and R9 also distinguish abort delivery from OS descendant termination. Pinned `cross-spawn` can leave a child after the Session drain is removed; without independent process proof, `activeTools` must remain unknown and the Run must remain occupied for reconciliation. A safe child barrier is required for R13's cancellation check. Descendant cleanup will be reported separately from coordinator cancellation acknowledgment.
