# R4 reliability handoff

September 29, 2026. **R4 controller slice ready for consumer wiring** in `packages/app/src/pages/puff/team-state.ts` and `team-state.test.ts`. This is an isolated source/test handoff, not a native receipt.

## Tool decision recovery

The controller exposes stable methods:

```ts
canRetryDecision(approval: Coordination.Approval): boolean
retryDecision(approval: Coordination.Approval): Promise<void>
```

The caller supplies the **current snapshot's** approval. The capability is true only while the same connected service/member compartment retains the exact earlier reject attempt, the current thread and approval match it, and the server reports a decided rejection with that decision ID but `deliveryState` pending or failed. The callback reuses the remembered claimed version and decision ID through the existing `api.decide`; it does not call `claim`, create a new decision ID, or enable Allow. A delivered snapshot removes the remembered attempt. A fresh controller after reload or another member has no retry capability, so the panel should display unresolved delivery without a retry action.

The lead can pass these functions through `team-thread.tsx` to optional panel props. The panel owns the pending/failed/delivered display and copy; R4 edits neither host nor panel.

The repo-pinned Bun 1.3.14 is at `/tmp/puff-toolchain/bun-darwin-aarch64/bun`. The full owned test file passed in both Solid and browser conditions: **20 pass, 0 fail, 116 assertions per run**. No native interaction was attempted.

## Exact source resolver

The lead published and added `source(projectId, ref, signal)` on `createTeamApi`. The controller now exposes:

```ts
resolveSource(ref: { threadId: string; eventId: string; seq: number }, signal: AbortSignal): Promise<Coordination.Event>
```

It resolves against the **visible snapshot thread's project**, even when the sidebar roster has switched to a different project and left that conversation mounted. It captures the authenticated client, connection generation, account, roster project and selected thread at call time. It rejects a late result if the caller aborted, the client/account changed, the roster or target selection changed, the visible thread changed, or the returned event differs from the exact project/thread/event/sequence. The client method owns the replay transport and validates the same exact identity. R4 did not edit `team-api.ts`.

The controller also exposes `state.sourceScope: string`: empty while disconnected, new non-secret value on every successful connection. Hosts can combine it with project/target identity to clear the panel's evidence peek on reconnect. R4's tests cover exact lookup without losing B's draft, an A-thread/B-roster lookup, cancelled and switched-target/project late responses, reconnect as another member, and scope renewal.

Package `bun typecheck` passed after the A-thread/B-roster correction. A separate earlier R3 browser focus run passed four cases and failed its inline evidence-peek case while the panel was still being mounted; the panel/lead own that UI integration. Native interaction belongs to QA's separate checkout/window.

## Polling focus preservation

The lead's narrow QA-checkout fix was ported into the owned controller: roster arrays use `reconcile` inside a batch, and snapshot refresh reconciles keyed rows before updating cursor/loading. This preserves focused controls through routine polling. The lead's native 24-second observation and 42 browser tests apply to the QA checkout; R3 owns the regression port, and this integration checkout has not been native-tested.
