# Embedded coding runner

The runner lives in `packages/core/src/runner-harness` and composes through the server's coordination layer. It executes admitted coordinator Runs using the retained OpenCode Session runtime. It does not replace Session orchestration with an in-memory tool loop.

## Start and ownership

The source launcher writes private identity, admission, provisioning, and runner configuration, then starts the backend with `OPENCODE_RUNNER_CONFIG_PATH`. A runner credential must match its configured worker and instance. Member, runner, analysis, and direct runtime credentials have separate authority.

The provisioner reserves a stable Session/workspace identity, creates a worktree from an approved repository revision, and shares the resulting Session with the project. The runner verifies the directory, Git identity, Session, and owner before admitting work. It records one durable Session input using the Run's stable message ID before scheduling execution.

Different Sessions can execute concurrently. Within a Session, durable inputs are promoted at safe provider boundaries. The coordinator serializes its instruction queue independently of the model loop. Reusing a Session adopts its existing history; conflicting message-ID reuse fails.

## Activity and permissions

The runner correlates tool, output, workspace, and diff observations to the admitted Run. Shared activity contains bounded, redacted summaries and references. Complete tool inputs, patches, files, and raw output remain with the coding Session.

Native permission requests are process-local. The runner persists the exact Run/Session/request/tool/approval mapping before entering an approval wait. Native reply requires a verified durable coordinator decision. Approve maps to a one-time permission. Missing or conflicting native requests remain unknown or require reconciliation; an HTTP acknowledgment cannot fabricate delivery.

Cancellation targets the active process-local execution chain. It records acknowledgement and observed stopping separately. A lost terminal observation can require recovery even after interruption was acknowledged.

## Recovery and limits

The durable runner ledger tracks admission, activity receipts, approvals, and callback delivery. Exact retries reconcile existing input and output. Pending callbacks can drain after restart. Provider work is not blindly replayed after a crash; uncertain work requires reconciliation.

This embedded mode is intended for trusted local workers. Location/worktree separation and permission checks are not an operating-system sandbox. Tool processes can inherit host environment, and public multi-tenant hosting is not established by this implementation.

The retained native integration checks in `packages/server/test/runner-harness.integration.test.ts` run the real embedded runtime with a deterministic local HTTP model. They exercise workspace isolation, permissions, cancellation, callback recovery, continuation, and informational note promotion. They do not establish hosted model or Flower acceptance. See [process checks](coordination-e2e.md).
