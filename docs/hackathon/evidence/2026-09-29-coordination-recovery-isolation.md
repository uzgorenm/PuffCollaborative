# Thread-scoped recovery and worker reconnect

Tested source: [`204d9d6`](https://github.com/uzgorenm/PuffCollaborative/commit/204d9d6) on `origin/serhat`, September 29, 2026. It includes Agent 4's coordinator adapter fix at [`61b04b9`](https://github.com/uzgorenm/PuffCollaborative/commit/61b04b9). Evidence kind: SQLite integration with a mocked execution port, plus real HTTP and SQLite with a separate fake runner process.

The real runner process test found that an uncertain cancellation on Thread A made a later reserve on Thread B return 503 after restart. `RunnerAdapter.claim` had reconciled every pending Run for the worker before reserving on the requested Thread. It now reconciles the requested Thread and its pending approval decisions. An unverifiable Run keeps its own lane occupied; it does not block another Thread of the same worker.

Independent checks with Bun 1.3.14:

- From `packages/core`, `npx --yes bun@1.3.14 test test/coordination/runner/integration.test.ts test/coordination/runner/adapter.test.ts`: 13 passed, 0 failed, 66 assertions. The new regression uses real Queue, SQLite and EventV2 with mocked Access and RunnerPort. Thread A remains `cancelling` and rejects reconciliation while Thread B reserves under the same worker.
- From `packages/server`, `npx --yes bun@1.3.14 test test/coordination-e2e/suite.test.ts`: 9 passed, 0 failed, 1,088 assertions in 48.08 seconds. The stress case used seed `12648430`: 20 threads, 100 accepted instructions, 95 starts and 414 events. After a worker disconnect, the next Run was durably `reserved` but not started. Reconnecting delivered that reservation once. The test also covered authenticated submissions, replay, approval, cancellation, restart and versioned cards through HTTP.
- The required pre-push workspace typecheck completed 20 tasks successfully at this source.

The previous stress assertion expected the second Run to remain `queued` when delivery failed. That depended on a reconciliation failure in an unrelated Thread stopping the claim before reservation. The revised assertion checks the contract's durable reservation and exact reconnect delivery.

The separate retained OpenCode process test is being rerun after this fix. This receipt alone does not prove real model or tool execution after restart.
