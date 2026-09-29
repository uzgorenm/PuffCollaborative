# Instruction queue

`CoordinationQueue` stores accepted instructions and their Runs in the shared SQLite database. The idempotency key is `(threadId, authenticated userId, requestId)`. A retry in that scope with identical text returns the stored instruction and Run. Reusing the key with different text returns `conflict`. The same request ID may be used in another thread or by another member.

Acceptance assigns `queueSeq` inside the durable event transaction. The database's unique `(thread_id, queue_seq)` index protects the order, and a partial unique index permits only one active Run per thread. Submission and reservation do not rely on a client timestamp or a process mutex. Runner calls happen after the reservation commits.

`runnerMessageId` is created once with the queued Run. A restarted runner uses `pending` and reconciles that ID with OpenCode before dispatch. An expired reservation becomes `recovery_required` and continues to occupy the thread. A late start confirmation from the same execution owner may move that Run back to `running`. A later Run can start only after the current Run reaches a confirmed terminal state.

A cancellation request stays `cancelling` across lease expiry so recovery can retry the interrupt. It remains occupied until the runner confirms cancellation or failure.

Runner callbacks have globally unique `callbackId` values. Exact retries produce no new event; changed reuse returns `conflict`. Entering `waiting_approval` requires `approvalId`, `toolCallId`, and Agent 4's `commitApproval` projection callback. That callback runs in the same transaction as the Run transition and event.

The queue stores instruction text, not a conversation snapshot. The execution adapter must read the committed OpenCode Session history when it starts the reserved turn. Instructions still queued for later turns are excluded from that turn's commands.
