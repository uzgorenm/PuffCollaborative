# R1 backend quality handoff

## Activity revision contract for Flower consumers

`Event.seq` is the project journal cursor; `Thread.activitySeq` is the latest eligible content revision for that Thread. A stored `run.tool`, `run.output`, `run.workspace`, or `run.diff` callback advances the Thread revision to its event sequence in the same transaction that records the event and callback. `run.tool` includes started, completed, and failed tool reports because each is an observable runner activity; consumers may choose which details to summarize. `comment.created` already advances the same revision.

Run lifecycle events (`run.reserved`, `run.started`, approval, cancellation, completion, failure, recovery), instruction queue events, and `work-card.updated` do not advance `Thread.activitySeq`. In particular, writing a WorkCard cannot trigger another analysis cycle. A repeated callback ID with identical data returns the previously accepted result and creates no event or revision. A reused callback ID with different data is a conflict.

An analysis consumer should trigger from a higher `Thread.activitySeq`, not every project event. For a WorkCard, use the exact current `Thread.activitySeq` as `sourceActivitySeq`, and cite journal events whose IDs, Thread IDs, and sequences have been replay verified. A stale version or stale activity revision must be retried with fresh source material.

## Completed checks

- `activity-freshness.test.ts` uses the real SQLite journal, Queue, Access, and WorkCard. It verifies output, tool, workspace, and diff revisions; replayed callbacks; stale card rejection; fresh cited card acceptance; and no revision change from lifecycle or card projection events.
- `comment-retry.test.ts` holds two callers after their initial request lookup so they overlap at the append boundary. Both receive the same durable comment, one journal event is stored, a changed body conflicts, and an unrelated SQLite trigger error remains an error.
- Both focused regressions passed (2 tests, 26 assertions). The existing queue, runner integration, work-card, and shared-access tests passed (15 tests, 151 assertions). `packages/core` typecheck passed.

These are source-level integration checks. No native desktop, live Flower worker, or cross-host concurrency was exercised in this slice. The coordinator owns staging and publication of these files.
