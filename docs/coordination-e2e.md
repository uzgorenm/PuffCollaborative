# Coordination verification

Run checks from their package directories after the root `bun install --frozen-lockfile`:

```sh
cd packages/server
bun typecheck
bun test test/coordination.integration.test.ts test/runner-harness-authorization.test.ts test/runner-harness.integration.test.ts test/coordination-model-readiness.test.ts test/coordination-e2e/smoke.test.ts test/coordination-e2e/suite.test.ts
```

The process suite starts the registered route layer, real credential resolver, and SQLite database against a separate fixture execution service. It exercises membership isolation, ordered queues, exact retries, restart persistence, event replay/subscriptions, approvals, cancellation, and stale analysis. Its execution service does not call a model or execute tools.

The native runner integration uses the retained OpenCode CLI and embedded Session runtime with a local deterministic HTTP provider. It covers real worktrees, permission requests, durable callback recovery, continuation, and Flower informational note admission/promotion. Keep that evidence separate from the process fixture and from hosted service execution.

The harness allocates loopback ports and disposable temporary state, then stops its own processes and removes its files. `PUFF_E2E_KEEP=1` preserves a fixture for inspection; its output prints the directory. Do not keep or share fixture credentials beyond the local check.

Browser verification should use two separately authenticated sessions and check shared comments, ownership restrictions, queued instructions, URL/history restoration, draft preservation, and desktop/narrow layouts. A local test provider can exercise those interactions without establishing hosted model behavior.
