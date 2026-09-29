# Backend freshness and exact comment retry

- Date: September 29, 2026.
- Source: `dec2fb31c0`, reviewed independently in [R2's report](../reviews/backend-quality-review.md).
- Evidence: local integration tests against real SQLite/EventV2, with synthetic identities and mocked execution/access adapters where named. No native, live model, Flower, or cross-host claim.
- Coordinator verification: the scoped suite passed in the active integration checkout, then passed again at committed source `dec2fb31c0` in the clean `PuffCollaborative-publication` checkout with its own frozen-lockfile dependency installation. Both runs: **17 tests, 177 assertions, zero failures**. Core package typecheck passed in both checkouts.

Commands, from `packages/core` with repository-pinned Bun 1.3.14:

```sh
bun test test/coordination/activity-freshness.test.ts test/coordination/comment-retry.test.ts test/coordination/queue/queue.test.ts test/coordination/runner/integration.test.ts test/coordination/work-card/work-card.test.ts test/coordination/projects/shared-access.test.ts
bun typecheck
```

Runner content now advances `Thread.activitySeq` atomically with the durable event. Replayed callbacks, lifecycle transitions and card projections do not create another content revision. Overlapping exact comment requests return one durable comment/event; changed payloads conflict, and unrelated database errors remain errors.

The adjacent activity feed still omits `run.output`; this receipt does not establish a complete outbound analysis feed. Live awareness, private export, promotion and agent use remain open. The [consumer handoff](../next-backend-quality-handoff.md) defines project event sequence versus Thread content revision.
