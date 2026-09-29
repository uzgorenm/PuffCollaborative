# Coordination content revision recheck

Tested source: `8bf5459` on the local `serhat` integration line, September 29, 2026. It includes the event-journal fix published at [`e3e4552`](https://github.com/uzgorenm/PuffCollaborative/commit/e3e4552). Evidence kind: real SQLite/EventV2 persistence and HTTP process integration with a separate fake runner.

At `612575c`, the focused `activity-freshness.test.ts` failed: `run.started` advanced `Thread.activitySeq` to 2 when the content revision should have stayed 0. The accompanying comment-retry test passed. The event journal now advances the revision only for `comment.created`, `run.tool`, `run.output`, `run.workspace` and `run.diff`. It still records every event in the project journal, and a thread event referring to a Thread in another project is rejected.

From the package directories with Bun 1.3.14:

- `packages/core`: `npx --yes bun@1.3.14 test test/coordination/activity-freshness.test.ts test/coordination/comment-retry.test.ts` — 2 passed, 0 failed, 26 assertions. The freshness case covers content events, lifecycle and card projection events, duplicate callbacks and stale card rejection with actual SQLite.
- `packages/server`: `npx --yes bun@1.3.14 test test/coordination-e2e/suite.test.ts` — 9 passed, 0 failed, 1,084 assertions in 45.49 seconds. This includes two active threads, ordered concurrent submissions, authentication, replay and SSE, approval, cancellation, restart recovery, output citation and the seeded 20-thread drain. Seed `12648430` accepted 100 instructions, started 95 Runs and recorded 414 events.

The event owner also ran the full core coordination suite at `e3e4552`: 41 passed, 289 assertions, plus core and workspace typechecks. Those are owner-reported checks; the two commands above were independently rerun in the Agent 1 checkout.

The process suite uses a fake execution worker. A separate real OpenCode process check is underway. The 60-minute activity view still omits `run.output`; Agent 6 owns that follow-up. These results do not close the Puff awareness or Flower gates.
