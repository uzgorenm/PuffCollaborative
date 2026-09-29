# Coordination contract

Agent 1 owns this contract and the backend composition. The current repository has no coordination implementation on `origin/main`. Changes to a shared signature or route go through Agent 1 before a feature owner depends on them.

## Existing stack

- Runtime: Bun and TypeScript. The HTTP entry point is `packages/server/src/routes.ts`, which builds the Effect `HttpApi` from `packages/protocol/src/api.ts`.
- Persistence: the existing SQLite database from `packages/core/src/database/database.ts`, with Drizzle tables in `packages/core/src/**/*.sql.ts` and core migrations.
- Durable events: `EventV2.Service.publish` in `packages/core/src/event.ts`. Its `commit(seq)` callback runs in the same SQLite transaction as the event. Replay uses the aggregate sequence. Do not add another event table or in-memory event bus.
- Execution: `SessionV2.prompt` admits durable input; `SessionExecution` owns process-local execution for a Session. Teammate 2 owns the OpenCode runner and workspace integration. Coordination requests turns without implementing a model/tool loop.
- Authentication: `ServerAuth` and the server authorization middleware currently support one instance-level Basic credential. That credential does not identify a project member. Agent 2 extends this boundary with a fixed member/runner roster loaded from runtime configuration. A missing resolver makes coordination routes explicitly unavailable.
- Tests: Bun package tests and `bun typecheck` from package directories. The root test script intentionally fails. This checkout currently has no Bun binary or installed dependencies.

The server runs as one process for the MVP. Each Thread binds to an existing OpenCode Session ID and its original worker. Two threads may run concurrently. One thread has at most one active Run, including a Run waiting for tool approval.

## Exclusive ownership

Agent 1 reviews and makes shared-file changes requested by another agent. Teammates 2 through 4 retain ownership of OpenCode execution, the multiplayer UI, and Jev/Flower jobs respectively.

| Owner | Write area | Responsibility |
| --- | --- | --- |
| Agent 1 | `docs/coordination-contract.md`; `packages/schema/src/coordination*.ts`; `packages/schema/src/durable-event-manifest.ts`; `packages/protocol/src/groups/coordination.ts` and `packages/protocol/src/api.ts`; `packages/server/src/handlers/coordination.ts`, `packages/server/src/api.ts`, `packages/server/src/handlers.ts`, `packages/server/src/routes.ts`; `packages/core/src/coordination/contracts.ts` and `sql.ts`; `packages/core/src/database/migration/*coordination*.ts` and `migration.gen.ts`; central config; `packages/core/test/coordination/integration.test.ts` and `fixtures.json` | Shared types, tables, route declaration, dependency wiring, configuration and integration. |
| Agent 2 | `packages/core/src/coordination/access/**`; `packages/core/test/coordination/access/**` | Member and runner identity; project and thread authorization. |
| Agent 3 | `packages/core/src/coordination/queue/**`; `packages/core/test/coordination/queue/**` | Atomic ordered submission, one active Run per thread, cancellation and next-run selection. |
| Agent 4 | `packages/core/src/coordination/runner/**`; `packages/core/test/coordination/runner/**` | Coordination-side reservation and lifecycle adapter to Teammate 2's runner port. No OpenCode model/tool loop or workspace code. |
| Agent 5 | `packages/core/src/coordination/events/**`; `packages/core/test/coordination/events/**` | Durable coordination event append, replay and live subscription on `EventV2`. |
| Agent 6 | `packages/core/src/coordination/work-card/**`; `packages/core/test/coordination/work-card/**` | Versioned work cards and stale Jev/Flower summary rejection. |

Feature owners do not edit `packages/app/**`, `packages/opencode/src/session/**`, `hackathon/flower/**`, root manifests or shared composition. They request shared changes from Agent 1 with the exact signature and reason. The older `docs/hackathon/**` plan describes a different product slice and does not assign these coordination files.

## IDs and records

All IDs are opaque strings. `projectId` reuses the existing OpenCode `Project.ID`. The fixture uses `prj_`, `usr_`, `thr_`, `ins_`, `run_`, `evt_` and `wc_` prefixes for readability. `sessionId` is an existing OpenCode `Session.ID` and is never inferred from `threadId`. API timestamps are UTC ISO 8601 strings; SQLite stores epoch milliseconds.

| Record | Required fields | Rule |
| --- | --- | --- |
| `Thread` | `id`, `projectId`, `sessionId`, `workerId`, `title`, `createdBy`, `createdAt`, `activitySeq` | `activitySeq` is the latest project event sequence that changes summarized content. Membership is checked separately. |
| `InstructionRequest` | `id`, `requestId`, `threadId`, `actorId`, `text`, `queueSeq`, `submittedAt`, `runId` | `queueSeq` increases inside a thread in the submission transaction. `actorId` comes from auth, never the request body. |
| `Run` | `id`, `threadId`, `instructionId`, `state`, `attempt`, `runnerMessageId`, `executionOwner`, `leaseUntil`, `createdAt`, `startedAt`, `endedAt` | One Run per instruction. `runnerMessageId` stays stable on retry. `executionOwner` binds a worker and instance. Terminal Runs have `endedAt`. |
| `Event` | `id`, `projectId`, `threadId`, `seq`, `kind`, `occurredAt`, `actorId`, `runId`, `instructionId`, `payload` | `id` is an `EventV2.ID`. `seq` is the durable project aggregate sequence. Optional references are omitted when unrelated. |
| `WorkCard` | `id`, `threadId`, `version`, `sourceActivitySeq`, `currentTask`, `progress`, `blockers`, `status`, `updatedAt`, `summaryJobId` | Version increases on each accepted update. A summary must cite current `Thread.activitySeq`. |

`Approval` has `id`, `threadId`, `runId`, `toolCallId`, `version`, `state`, `requestedAt`, optional claim owner/expiry and optional decision actor/time. `ExecutionOwner` has `workerId` and `instanceId`. A worker credential must match the worker bound to the Thread and owner reference.

`Event.kind` is one of `thread.created`, `instruction.submitted`, `instruction.cancelled`, `run.reserved`, `run.started`, `run.tool`, `run.output`, `run.workspace`, `run.diff`, `run.approval.requested`, `run.approval.resolved`, `run.cancel.requested`, `run.completed`, `run.failed`, `run.cancelled`, `run.recovery.required` or `work-card.updated`. These are payload kinds inside the existing durable `EventV2` record. Runner activity uses the `RunnerActivity` union: tool name/status/optional summary, output text, workspace ID/reference, or diff reference/optional summary. Text fields are capped at 8,000 characters. Raw tool inputs, full outputs, patches, files and secrets stay with the OpenCode session.

## Run lifecycle

`queued -> reserved -> running -> completed` is the normal path. The complete transition set is:

| From | To |
| --- | --- |
| `queued` | `reserved`, `cancelled` |
| `reserved` | `running`, `cancelling`, `failed`, `recovery_required` |
| `running` | `waiting_approval`, `cancelling`, `completed`, `failed`, `recovery_required` |
| `waiting_approval` | `running`, `cancelling`, `failed`, `recovery_required` |
| `cancelling` | `cancelled`, `failed`, `recovery_required` |
| `recovery_required` | `running`, `cancelled`, `failed` after reconciliation |

`completed`, `failed` and `cancelled` are terminal. A pending approval keeps the thread lane occupied. The queue starts the next Run only after the previous Run is terminal. On restart, an expired nonterminal lease becomes `recovery_required`. The adapter checks stable `runnerMessageId` against durable Session input before resuming or failing; it never blindly submits a second prompt.

## Shared services

The TypeScript signatures live in `packages/core/src/coordination/contracts.ts`. Agents implement their assigned service behind them.

- `Access.authorize(principal, projectId, threadId?, action)` derives the actor from `ServerAuth`. Its actions include `approve` for member approval controls. `Access.getThread(principal, threadId, action)` returns an authorized Thread so runner commands resolve its project, Session and worker without direct table queries. `Access.snapshot` reads Thread, queue, Runs, approvals, work card and the latest project event sequence in one SQLite read transaction. A runner principal contains authenticated `workerId` and `instanceId`; callbacks must match both against the Run's `executionOwner`. A user outside the project receives 403; an invalid credential receives 401.
- `Queue.submit(principal, threadId, requestId, text)` assigns a queue position and creates a queued Run. `Queue.reserveNext(principal, threadId, executionOwner, leaseUntil)` atomically reserves the first queued Run only when the thread has no active Run. `Queue.transition` owns all Run state writes and validates the typed `RunnerCallback` and `callbackId`. Activity callbacks keep the Run in `running` or `waiting_approval`; state callbacks follow the lifecycle table. `Queue.cancel` records queued cancellation or requests active interruption. `Queue.getRun` is a read-only internal lookup used to check the authenticated worker and instance before a callback. `Queue.pending(executionOwner)` returns Thread, instruction and Run together to reconstruct reserved deliveries after a restart.
- `Runner.claim` calls `Queue.reserveNext` and sends a stable `RunnerCommand` to Teammate 2's port after reservation commits. `Runner.report` calls `Queue.transition` for authenticated callbacks. `Runner.cancel` calls `Queue.cancel` and, for an active Run, `RunnerPort.interrupt`. `Runner.recoverPending` checks each stable `runnerMessageId` with `RunnerPort.reconcile` before retrying delivery. The Run's `executionOwner` binds the original worker instance and Session ID.
- `Runner.claimApproval` takes `approvalId` and `expectedVersion` to claim a pending approval for a member. `Runner.decideApproval` takes `decisionId`, `expectedVersion` and approve/reject, commits one decision, then calls `RunnerPort.resolveApproval` with the stable `decisionId`. Competing decisions fail the version check; a repeated exact decision returns the first result and never forwards twice.
- `Events.append(event, project)` calls `EventV2.publish` with `project(seq)` as its commit callback. `Events.replayProject` and `replayThread` return bounded pages with the project sequence cursor. `Events.subscribeProject` and `subscribeThread` replay then stream without a cursor gap.
- `WorkCards.update(threadId, expectedVersion, sourceActivitySeq, card)` checks the current card version and thread activity revision. A stale summary returns 409 without an event.

Queue, runner and work-card modules receive the same `Database.Service` and `Events` service. They must not create a separate connection, transaction manager or event publisher.

## Transactions and retries

Every durable state change and its coordination event commit together through `Events.append`. This includes queue positions, Run transitions, approval state, cancellation, recovery state and work-card versions. The `project(seq)` callback writes projections in the ambient transaction. No outbound runner call or Jev/Flower job runs inside it.

`requestId` is unique per authenticated actor and thread. An exact retry returns the original InstructionRequest and Run. Reuse with different text, thread or actor returns 409. `runId` and `runnerMessageId` stay stable. A runner callback carries a unique `callbackId`; an exact retry is a no-op, while changed data for that ID is a conflict. Tool event IDs follow the same rule. Work-card updates compare `expectedVersion` and exact `sourceActivitySeq`. SQLite enforces one active Run per thread and unique `(threadId, queueSeq)`.

The `EventV2` aggregate ID is `coordination:project:<projectId>`. Events include `threadId` in their payload. One project sequence supports a single ordered dashboard feed; thread replay filters that feed and keeps the project cursor. Sequences start at 0. The empty-project cursor is -1; `after` is exclusive. A value below -1, a fraction, NaN, a future cursor or a page limit outside 1..256 returns 400 (`Failure.code = "invalid"`). The MVP retains the full event journal, so a valid historical cursor does not expire. A slow live subscriber is disconnected with its last delivered cursor and reconnects through replay. An event becomes visible after commit. Session delivery is reconciled by `runnerMessageId` after a crash.

## HTTP ownership

Agent 1 owns declaration and handler registration for every `/api/coordination/v1` route. The named feature owner supplies service behavior and tests.

| Route | Service owner | Meaning |
| --- | --- | --- |
| `GET /api/coordination/v1/projects/:projectId/threads` | Agent 2 | Authorized thread list. |
| `GET /api/coordination/v1/threads/:threadId` | Agent 2 | Authorized thread state, queue, current Run and latest committed project event cursor. |
| `POST /api/coordination/v1/threads/:threadId/instructions` | Agent 3 | Submit with `requestId`; return instruction, Run and queue position. |
| `POST /api/coordination/v1/threads/:threadId/instructions/:instructionId/cancel` | Agent 4 | User-facing cancellation; invokes Agent 3's `Queue.cancel`. |
| `POST /api/coordination/v1/runner/threads/:threadId/reserve` | Agent 4 | Authenticated worker reservation. |
| `POST /api/coordination/v1/runner/runs/:runId/events` | Agent 4 | Authenticated callback with `callbackId` and lifecycle/tool/approval data. |
| `POST /api/coordination/v1/threads/:threadId/approvals/:approvalId/claim` | Agent 4 | Claim one pending approval at an expected version. |
| `POST /api/coordination/v1/threads/:threadId/approvals/:approvalId/decision` | Agent 4 | Approve or reject once with `decisionId` and expected version. |
| `GET /api/coordination/v1/projects/:projectId/events?after=:seq` | Agent 5 | Authorized ordered project replay. |
| `GET /api/coordination/v1/projects/:projectId/events/stream?after=:seq` | Agent 5 | Authorized project live stream beginning with replay. |
| `GET /api/coordination/v1/threads/:threadId/events?after=:seq` | Agent 5 | Authorized replay. |
| `GET /api/coordination/v1/threads/:threadId/events/stream?after=:seq` | Agent 5 | Authorized live stream beginning with replay. |
| `GET /api/coordination/v1/threads/:threadId/work-card` | Agent 6 | Current versioned card. |
| `PUT /api/coordination/v1/threads/:threadId/work-card` | Agent 6 | Jev/Flower update with version and source revision; service identity required. |

No runner endpoint accepts an arbitrary Session ID. The server resolves it from Thread. Teammate 3 owns the shared page; Teammate 4 owns classification and summary generation.

## Fixture and unfinished adapters

`packages/core/test/coordination/fixtures.json` is synthetic. It contains two members, an unauthorized user, two threads, one running Run, one queued instruction, a tool event, pending approval and a work-card update. Tests that supply fake auth, runner or Jev/Flower callbacks must say so. Passing them does not verify real OpenCode execution or hosted analysis.

Until Agent 2's member resolver and Teammate 2's runner port are connected, coordination routes must fail explicitly with an unavailable adapter error. The fixture is never a production fallback.
