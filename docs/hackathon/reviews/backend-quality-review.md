# R2 review: R1 backend quality slice

Reviewed the current uncommitted `queue.ts`, `comments/index.ts`, `activity-freshness.test.ts`, `comment-retry.test.ts`, and R1 handoff in the main integration checkout. The four source/test files had the same SHA-256 hashes at the start and end of this review.

## Release decision for this slice

No release-blocking defect found in R1's owned changes by source review. R1 reports 2 focused tests (26 assertions), 15 related tests (151 assertions), and the core typecheck passing. I did not rerun these checks; the coordinator is running combined verification. This review does not establish native desktop, live Flower worker, or cross-host behavior.

## Findings

1. **Adjacent activity-feed gap; follow up with the activity owner.** `packages/core/src/coordination/activity/activity.ts:92-108` omits `run.output` from `meaningfulKinds`, although the queue now advances `Thread.activitySeq` for `run.output`. The feed's `outcome()` at lines 232-235 also omits the output `text` field. A runner output can therefore make a WorkCard stale and trigger analysis while remaining absent from `recent`. If the release expects runner outputs in that feed, include `run.output`, extract its text, and add a focused feed assertion. This is outside R1's owned files and is not a blocker for the revision contract itself.
2. **Add a queue overlap regression before relying on cross-process retry behavior.** `activity-freshness.test.ts` covers a sequential exact callback replay and stale/fresh WorkCard updates. It does not overlap two `transition()` calls at the append boundary or test a changed callback payload under that overlap. The queue rechecks callback ID inside the event transaction and re-reads the recorded callback after an `Aborted` retry, so the path looks correct by inspection. A gated overlap test like `comment-retry.test.ts` would protect that guarantee.

## Checks against the requested invariants

- `EventV2.publish` runs its commit projection inside an immediate SQLite transaction (`packages/core/src/event.ts:237-353`). For both changed services, callback/comment row, activity revision, and journal sequence/event commit together or roll back together.
- Comment retries re-read the `(thread, author, requestId)` row inside that transaction. Only the explicit `ExactRetry` defect is absorbed; the final read compares bodies and returns `conflict` on changed data. The SQLite trigger test demonstrates an unrelated database failure still fails and leaves no extra journal event.
- Runner callbacks use a globally unique callback ID and compare the stored callback with the new payload on both initial lookup and post-race recovery. Activity updates set `activity_seq` only for callback kind `activity`; lifecycle callbacks leave it alone.
- WorkCard writes leave `activity_seq` unchanged. The real SQLite freshness test verifies the exact revision is required and a stale revision conflicts, avoiding a projection-generated analysis loop.
