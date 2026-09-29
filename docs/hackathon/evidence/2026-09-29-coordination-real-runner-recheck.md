# Coordination real runner recheck, September 29, 2026

**Tested source:** `46dc9e8` on `origin/serhat`, after the R13 assembled process test, per-Thread recovery repair and concurrent frontend merges. This is an Agent 1 recheck of the [R13 runner receipt](runner-2026-09-29-r13-integration.md), not a new product acceptance claim.

From `packages/server`, using Bun 1.3.14:

```sh
bun test test/runner-harness.integration.test.ts
bun typecheck
```

The process suite passed **2 tests and 93 assertions**. The server typecheck passed. The first test ran the installed OpenCode server with the embedded coordination gateway, real SQLite and Git worktrees, and a deterministic local model endpoint. It checked authenticated instructions, ordered events, concurrent Threads, Session continuation, an approved `write` tool, cancellation held as `recovery_required`, and completion on another Thread after restart. The second test held a typed coordinator callback response unavailable, restarted the worker, and observed the persisted output and terminal callbacks delivered in order without a second model call.

The model endpoint and HTTP clients are test fixtures. The callback fault is at the coordinator port in a process that embeds both services. This recheck does not verify a paid model, separately deployed services, frontend use, Jev/Flower analysis or Puff awareness delivery. The [fake runner process receipt](2026-09-29-coordination-recovery-isolation.md) separately covers a broader nine-case coordinator suite against an external simulator.
