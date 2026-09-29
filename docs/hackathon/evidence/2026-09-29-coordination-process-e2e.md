# Coordination backend process test, September 29, 2026

Tested checkout: `e83a0bb71203c14c3ad996ea155187ad5453763d`. Bun 1.3.14 on macOS arm64. The test ran the registered HTTP route layer in a coordinator process against disposable SQLite files. A separate fake execution process stayed alive through coordinator `SIGKILL` and restart. HTTP clients used eight distinct roster credentials, including four project members, an outsider, a stale worker instance, and an analysis service. No OpenCode model or tool execution, frontend, Flower job, or paid service was used. The subsequent receipt edit changed documentation only.

The harness and run instructions are in [coordination-e2e.md](../../coordination-e2e.md). The test entry point uses `createRoutes` with a fake `RunnerPort` and a Session binding adapter that reads real seeded `session` rows. The roster validator, project admission allowlist, route handlers, queue, runner gateway, EventV2 journal, cards, activity service, SQLite engine, and migrations are the backend implementations under test.

## Commands and results

Run from `packages/server` with Bun 1.3.14 on `PATH`:

| Command                                          | Exit | Observed result                                                                                       |
| ------------------------------------------------ | ---: | ----------------------------------------------------------------------------------------------------- |
| `bun typecheck`                                  |    0 | `tsgo --noEmit` completed.                                                                            |
| `bun test test/coordination-e2e/smoke.test.ts`   |    0 | 1 pass, 0 fail, 23 assertions.                                                                        |
| `bun test test/coordination-e2e/suite.test.ts`   |    1 | 8 pass, 1 fail, 1,083 assertions. The failing case is the retained runner-output citation regression. |
| `bun test test/coordination.integration.test.ts` |    0 | Existing in-process mock test: 1 pass, 0 fail, 51 assertions.                                         |

The suite log contains `COORDINATION_STRESS_SEED 12648430` and `COORDINATION_STRESS_RESULT {"seed":12648430,"threads":20,"accepted":100,"starts":95,"events":414}`. Five accepted instructions were cancelled while queued. The remaining 95 started and drained after a simulated worker disconnect was removed. The fake recorded one execution start for each accepted start, and event replay converged with terminal Run snapshots. The suite took 48.73 seconds in this run.

## Scenario results

| Scenario                      | Status                             | HTTP and persistence evidence                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A. Startup and persistence    | Passed                             | Empty SQLite initialization created the required tables and all 21 coordination OpenAPI paths. Restart retained projects, comments, and cursors. A separate upgrade test applied all four coordination migrations to the immediately preceding schema snapshot.                                                                                                                                  |
| B. Access, identity, comments | Passed                             | Alice and Bob's comments retained server-validated attribution and created no Run. Forged author and user fields did not change identity. The outsider could not read, list, subscribe, submit, cancel, approve, or update a card. Browser credentials could not reserve work or submit analysis. Cross-project Session binding was denied.                                                      |
| C. Ordering and concurrency   | Passed with fake worker polling    | Simultaneous submissions were ordered by server `queueSeq`. Concurrent reservation attempts produced one accepted start for a thread. A second thread ran while the first was held. The fake worker polled the public reservation route after completion, and the next accepted instruction started only after the prior Run became terminal.                                                    |
| D. Idempotency and handoff    | Passed at the coordinator boundary | Exact request retries returned the same instruction and Run; changed content returned 409 without another event. Duplicate output and terminal callbacks produced one logical event each. The next start used the same bound Session ID after A's output and completion had committed, and its command contained only B's instruction. Actual OpenCode history assembly remains untested.        |
| E. Events, replay, snapshots  | Passed for exercised paths         | Two members received the same SSE event. Reconnect replay returned missed events in project order. A callback racing stream setup was recovered. A slow unread subscriber did not prevent another thread from completing. Replay IDs and lifecycle events matched snapshots. Invalid, future, and oversized cursors returned 400. A conflicting approval decision left no losing decision event. |
| F. Cancellation               | Passed                             | The runner received an interrupt while a follow-up stayed queued. Failed transport did not free the lane. One termination confirmation freed it; a duplicate confirmation produced no second transition.                                                                                                                                                                                         |
| G. Approval                   | Passed                             | Awaiting approval occupied the lane. Concurrent approve and reject requests yielded one decision and one 409. The fake received one logical decision. Outsider, wrong-thread, missing-approval, and stale decisions were denied. The action was an inert fixture.                                                                                                                                |
| H. Crash recovery             | Passed with fake runner            | `SIGKILL` left the fake alive and preserved A with B/C queued. Restart did not start competing work. A stale worker instance could not report. The suite covered admission before dispatch, start accepted with lost acknowledgment, start rejected before admission then retried with the same message ID, a lost terminal callback acknowledgment, and replay after restart.                   |
| I. Cards and activity         | Failed in one regression           | Version checks, duplicate cards, older result rejection, invalid and cross-project evidence, authoritative working status, queued versus current work, multiple active threads, and the one-hour activity window passed. A `run.output` event could not be cited by a card because `Thread.activitySeq` did not advance.                                                                         |
| J. Seeded fault exercise      | Passed                             | Seed `12648430` used four users, 20 threads, 100 accepted instructions, duplicate submissions/callbacks, five queued cancellations, a worker disconnect, and replay. Ninety-five starts respected each thread's acceptance order. Twenty independent threads were active together; event projection found no overlap or lost instruction.                                                        |

The immediately preceding snapshot is `packages/core/src/database/schema.gen.ts` at `71104c652958df87ac7300081eb1b837e296fdbd`, extracted into `packages/server/test/coordination-e2e/previous-schema.sql`. The tested upgrade used the registered migrations `20260929190000_coordination_runner_approval`, `20260929190010_coordination_access`, `20260929190020_coordination_work_card`, and `20260929193000_coordination_queue`. Fresh initialization used the current `schema.gen.ts` snapshot and marked the migration IDs complete; restart used that database unchanged.

The contract uses numeric project sequences and retains historical events. It defines no expiring or scope-encoded cursor. The exact instant between an event commit and its live broadcast was not fault-injected. Replay after coordinator restart and a stream handoff race passed, but that narrower failure window remains **not run**.

## Smoke event trace

The trace below is from the passing smoke run at the tested checkout. Shared thread `thr_1fb04840-0006-4b7e-8754-c93835625d8b` had Alice's first Run `run_a6f2d651-4a6e-43ba-a889-1db8425d5f36` and Bob's queued Run `run_dbb96c9b-c1e6-4627-aa87-618c795d5b5d`. Dan used independent thread `thr_8eecaa00-a07b-4105-9bb0-4527e1e82d8c`.

| Project seq | Observed event                                                                           |
| ----------: | ---------------------------------------------------------------------------------------- |
|        6, 7 | Bob and Alice each commented in the shared thread. No Run existed yet.                   |
|    8, 9, 10 | Alice, Bob, and Carol submitted instructions to that thread in durable acceptance order. |
|          11 | Dan submitted in the independent thread.                                                 |
|      12, 13 | Alice's Run was reserved and started while Bob and Carol remained queued.                |
|      14, 15 | Dan's Run was reserved and started in the independent thread.                            |
|      16, 17 | Alice emitted fixture output; Dan emitted an inert fixture tool event.                   |
|          18 | Alice's Run completed. Dan's thread was still active.                                    |
|      19, 20 | Bob's accepted Run was reserved and started in the shared thread.                        |

The trace includes stable event IDs in the replay API. The table omits UUID suffixes for the other fixture Runs for readability. Output and tool records are scripted fixture events, not coding results.

## Failure and remaining work

The retained test `I regression: runner output must advance the citable activity revision` observed `run.output` at project sequence 8 while `Thread.activitySeq` remained 4. `WorkCard.update` requires a cited event sequence no newer than `sourceActivitySeq`, which must match the thread's current `activitySeq`. The resulting card update is rejected. Agent 3's queue runner-activity projection is the responsible module. The smallest likely repair is to update the thread activity revision for summary-relevant runner output in the same `Events.append` transaction, then rerun the regression and card checks. No production behavior was changed in this test task.

An end-to-end run with Talha's real OpenCode port still needs to prove stable start deduplication, Session-history assembly after a prior turn commits, reconciliation, cancellation confirmation, ownership enforcement, and approval delivery. Serdar's frontend needs a live authenticated run covering snapshots, SSE replay, queue state, cancellation, and approvals. Ferit's Jev/Flower service needs to submit source-cited analysis with its service credential and prove real multi-agent results. This receipt is backend process evidence with external simulators. It does not close G0 through G7 or WF01 through WF10 in the hackathon progress checklist.
