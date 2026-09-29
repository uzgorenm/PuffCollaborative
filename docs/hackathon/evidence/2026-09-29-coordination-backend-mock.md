# Coordination backend mock integration

Date/time: September 29, 2026, 12:44 PDT  
Result: PASS for the multiplayer coordination backend with an explicit mock runner; G0 and WF01–WF07 remain open.  
Evidence kind: INTEGRATION with real SQLite and `EventV2`, plus focused component tests.  
Owner: Agent 1 / Serhat backend area. Reviewer: no second-person review recorded.  
Tested and pushed source: [`4124e1a`](https://github.com/uzgorenm/PuffCollaborative/commit/4124e1a). Documentation updates were pending at the test run.

## Commands and observed results

- From `packages/server`: `bun test test/coordination.integration.test.ts` — 1 pass, 51 assertions, repeated seven times after fixing an order-dependent assertion. The last run was concurrent with the full core suite. Two individually authenticated members shared two Threads, submitted ordered concurrent instructions, ran mock turns on both threads concurrently, read authorized SSE and cursor replay, resolved approvals for each queued turn, cancelled a Run, read activity and a versioned card, received 409 for a stale card, and read the persisted state after reopening the HTTP handler. An outsider received 403; missing and shared-instance credentials received 401. Invalid SSE cursor received 400.
- From `packages/core`: `bun test test/coordination` — 39 pass, 256 assertions. The tests include real SQLite/EventV2 queue concurrency, event rollback, replay, membership revocation during a stream, work-card validation, and restart delivery reconstruction. Several cases use mocked Access or execution ports; their test names identify those boundaries.
- From `packages/core`: `bun run script/migration.ts --check` — passed with no incremental schema drift. A copy of a pre-feature SQLite database started through the current server and applied all four coordination migrations, creating the nine coordination tables; `/api/health` returned 200.
- From `packages/client`: `bun run check:generated` — passed. The generated client matches the registered HttpApi.
- The required pre-push `bun turbo typecheck` — 20 successful tasks across the workspace.

The integration test uses a local roster of Bun password hashes, a trusted project-admission file, existing Project and Session fixture rows, and `OPENCODE_COORDINATION_MOCK_RUNNER=1`. The mock emits planned tool and output events and waits on approval. Its credentials and SQLite file are temporary and removed at test completion.

The seven follow-up server runs used `npx --yes bun` with Bun 1.4.2; the repository specifies Bun 1.3.14. The pre-push typecheck also used 1.4.2 and passed.

This receipt does not establish real OpenCode model/tool execution, an actual worker's Session history consumption, live Jev/Flower analysis, the `/puff` awareness contract, or any WF01–WF07 acceptance case. Normal server startup returns 503 for coordination data until a real `RunnerPort` and `SessionBinding` are injected or explicit local mock mode is configured. Talha owns the real execution adapter; Serdar and Ferit own the UI and analysis integrations.
