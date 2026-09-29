# Recent runner output in the activity view

Tested source: [`a0ee1dd`](https://github.com/uzgorenm/PuffCollaborative/commit/a0ee1dd203c217ea9cf343de211b3859a48ffd8e) on `origin/serhat`, September 29, 2026. The activity read model now includes `run.output` events in the last-60-minute feed and caps displayed output text at 8,000 characters.

Independent checks with Bun 1.3.14:

- From `packages/core`, `npx --yes bun@1.3.14 test test/coordination/activity/activity.test.ts`: 3 passed, 0 failed, 16 assertions. This uses fixture events and checks recent output, expired output, membership and work-card freshness behavior.
- From `packages/server`, `npx --yes bun@1.3.14 test test/coordination.integration.test.ts`: 1 passed, 0 failed, 51 assertions. This uses real HTTP handlers and SQLite with the explicit mock runner; it does not separately assert the output event in the activity feed.

At [`c2f24b5`](https://github.com/uzgorenm/PuffCollaborative/commit/c2f24b5), Agent 1 extended the existing process regression to read the authenticated activity route after a `run.output` callback. From `packages/server`, `npx --yes bun@1.3.14 test test/coordination-e2e/suite.test.ts -t 'I regression'` passed 1 case and 14 assertions. Bob saw the exact output event ID, sequence, kind and text through HTTP, and the same event remained citable by a work card. This uses the separate fake worker and real SQLite.

The event owner previously verified `run.output` in the durable journal and content revision. This receipt covers its read-model projection and HTTP route. A live frontend view and the real OpenCode runner need separate evidence.
