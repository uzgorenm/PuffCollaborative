# Coordination backend process tests

The process suite starts the registered server route layer against a disposable SQLite database. It launches a fake execution service in a separate process, then talks to the coordinator through authenticated HTTP requests. The fake stays alive while the coordinator is killed with `SIGKILL` and restarted. No model, tool command, workspace operation, Flower job, or paid service runs.

## Run

Use Bun 1.3.14. From the repository root:

```sh
bun install --frozen-lockfile
cd packages/server
bun typecheck
bun test test/coordination-e2e/smoke.test.ts
bun test test/coordination-e2e/suite.test.ts
```

The smoke test prints `COORDINATION_TRACE`, an ordered project event trace for Alice and Bob in one thread while Dan's separate thread executes. The broader suite prints `COORDINATION_STRESS_SEED` and its accepted, started, and event counts. At `b3eeb0c` on `origin/serhat`, the suite passed all nine cases, including the runner-output citation regression.

Each test allocates local ports and a fresh directory under the system temporary directory. The harness writes eight distinct Bun password hashes, a trusted project admission file, real OpenCode `project` and `session` fixture rows, and the database created by the normal server migration layer. Its Session binding adapter reads the seeded `session` table and returns the stored project. Project admission comes from the configured allowlist. Server handlers use the production identity resolver and authorization checks. The test entry point passes only the external Session binding and RunnerPort into `createRoutes`.

The fake implements `RunnerPort.start`, `interrupt`, `resolveApproval`, and `reconcile` over local HTTP. Its control endpoint can hold a run, emit fixture callbacks, request an inert approval, confirm cancellation, fail or complete a run, duplicate a callback, reject a start, lose or delay a start acknowledgment, simulate a lost callback acknowledgment, disconnect, and reconnect. It records received start attempts, accepted starts, confirmed simulated execution starts, callbacks, interrupts, decisions, and worker polls. Repeated start commands use the same Run ID and message ID. The fake has no instruction queue. When `autoPoll` is enabled, it asks the public worker reservation route for the next instruction after a terminal callback.

## Inspect and clean up a fixture

The harness removes its temporary files and stops both child processes after each test. To keep one smoke fixture for inspection:

```sh
cd packages/server
PUFF_E2E_KEEP=1 bun test test/coordination-e2e/smoke.test.ts
```

Copy the exact `Kept disposable fixture:` path printed by the test, then inspect or remove that directory:

```sh
fixture_dir='/tmp/puff-coordination-e2e-REPLACE_WITH_PRINTED_SUFFIX'
sqlite3 "$fixture_dir/opencode.sqlite" "SELECT name FROM sqlite_master WHERE name LIKE 'coordination_%' ORDER BY name;"
sqlite3 "$fixture_dir/opencode.sqlite" "SELECT id, thread_id, state FROM coordination_run ORDER BY created_at;"
sqlite3 "$fixture_dir/opencode.sqlite" "SELECT seq, json_extract(data, '$.kind'), json_extract(data, '$.threadId') FROM event WHERE aggregate_id = 'coordination:project:prj_e2e_main' ORDER BY seq;"
rm -r "$fixture_dir"
```

The fixture contains local test credential hashes. Keep it on the test machine and remove it when finished.

## What the checks prove

The server process uses `packages/server/src/routes.ts` and the same `coordinationLayer` as the application. A fresh database is initialized from `packages/core/src/database/schema.gen.ts`; `migration.gen.ts` supplies the IDs marked complete for that snapshot. Restart reads the same database without replaying those migrations. The upgrade case starts from the preceding `schema.gen.ts` snapshot at `71104c652958df87ac7300081eb1b837e296fdbd`, stored as `packages/server/test/coordination-e2e/previous-schema.sql`, and applies the four registered coordination migrations through `migration.gen.ts`. The suite checks all 21 coordination OpenAPI paths, required tables, restart persistence, authenticated access, the queue and runner gateway, durable EventV2 replay and SSE, approval and cancellation controls, cards, and activity. It tests one project with four members and another project with a different owner and an outsider.

The smoke and suite verify backend behavior through real HTTP and SQLite. The test harness seeds the external OpenCode project and Session rows directly because the execution teammate's service is unfinished. The activity age test changes timestamps in its disposable database to avoid waiting an hour. These are fixture setup operations; the coordinator's reads and writes still use its registered API and journal. The fake's output and tool events are labeled fixtures. Matching Session IDs and committed event order prove the coordinator's handoff boundary, while actual OpenCode history assembly and tool execution remain unverified.

The MVP keeps historical numeric event cursors indefinitely. An out-of-scope or expired cursor format is not defined by the current contract. The suite tests malformed, future, and oversized cursors.

## Runner-output citation repair

At `e83a0bb`, `I regression: runner output must advance the citable activity revision` failed: a `run.output` event committed at sequence 8 while the thread's `activitySeq` remained 4. A card citing sequence 8 was rejected. The event journal now advances the activity revision in the same transaction as a thread event, excluding card updates. The test passed at `b3eeb0c`, and the card citation received HTTP 200. The [recheck receipt](hackathon/evidence/2026-09-29-coordination-activity-revision.md) records that run.

The process entry point uses the real route layer and migrations but is not the normal `opencode serve` CLI. The live OpenCode RunnerPort, workspace and Session history implementation, frontend subscribers, and Jev/Flower analysis service still require their own integration runs.
