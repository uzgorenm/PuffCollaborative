# Coordination activity revision recheck

Tested source: [`b3eeb0c`](https://github.com/uzgorenm/PuffCollaborative/commit/b3eeb0ca52de902575c936d2bc54c6ef2aecec40) on `origin/serhat`, September 29, 2026, 14:03 PDT. Evidence kind: process integration with a separate fake runner and real SQLite/EventV2 persistence. The earlier [process receipt](2026-09-29-coordination-process-e2e.md) records the failing run at `e83a0bb`.

From `packages/server`, using Bun 1.3.14 through `npx` on this host:

- `npx --yes bun@1.3.14 test test/coordination-e2e/suite.test.ts` — 9 pass, 0 fail, 1,084 assertions in 45.96 seconds. The runner-output citation regression passed: the durable `run.output` sequence was included in the Thread activity revision, and a work card citing that output was accepted.
- `npx --yes bun@1.3.14 test test/coordination.integration.test.ts` — 1 pass, 0 fail, 51 assertions with the explicit in-process mock runner.

The process suite also exercised concurrent submissions, two active threads, reconnect replay, authorization, approval and cancellation, coordinator `SIGKILL` recovery, and a seeded 20-thread drain. Its stress trace reported seed `12648430`, 100 accepted instructions, 95 starts and 414 events; five instructions were cancelled while queued. Agent 5 separately reported 39 passing core coordination tests with 263 assertions and a passing workspace typecheck at the same pushed source.

`Events.append` now advances a persisted Thread's activity revision inside the event transaction for thread-scoped events, except `work-card.updated`. An existing Thread from another project is rejected. Journal fixture tests without a persisted Thread remain valid.

This run used an external fake execution process. Real OpenCode model and tool execution, frontend interaction and Jev/Flower analysis require separate evidence. The Puff awareness gates remain open.
