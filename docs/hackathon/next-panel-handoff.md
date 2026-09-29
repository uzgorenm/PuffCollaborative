# Next panel handoff — source inspection and decision delivery

Owner: panel chat. Checkout: `/Users/mac/Desktop/Coding/Hackathon/Puff/PuffCollaborative-main-integration`. The scoped panel implementation and tests are ready for lead integration. The frontend lead owns hosts and shared i18n, R4 owns controller retry state, and the coordinator alone owns Git.

## Props to add to existing ContextPanelProps

```ts
sourceScope?: string
resolveSource?: (ref: { threadId: string; eventId: string; seq: number }, signal: AbortSignal) => Promise<Coordination.Event>
canRetryDecision?: (approval: Coordination.Approval) => boolean
onRetryDecision?: (approval: Coordination.Approval) => void | Promise<void>
```

`sourceScope` is an opaque, non-secret key identifying the exact connected service/member generation. It must change on account/service change or reconnect; omit it until the host can attest that identity. The panel enables Inspect only when `sourceScope` and `resolveSource` are present and its existing exact target/thread/worker/Session binding is ready. The resolver is the controller's authenticated wrapper, not a new transport. It must verify project/thread/event/sequence equality. The panel repeats that equality check before display and aborts/clears a pending peek when `sourceScope`, resolver, target, snapshot identity, or connection state changes. A late response cannot repopulate another Session.

Pass a stable resolver function reference from the controller, rather than a new inline function on each poll. The panel also invalidates an open peek when the cited WorkCard or its source refs change. Until the resolver and scope are supplied, it shows source IDs with an unavailable label and does not navigate away from B.

`canRetryDecision` is the R4 controller's pure capability check, and `onRetryDecision` is its exact-attempt retry action. The panel neither creates IDs nor calls claim/decide itself. For decided approvals with `deliveryState: pending | failed`, it displays the unresolved delivery; the button appears only when both props are present and the capability is true. On click it checks the capability again before invoking the action. If the attempt was lost on reload or belongs to another actor, return false; no new attempt is invented.

## Shared copy requested from lead

Please add these keys through the existing shared i18n mechanism before final host integration:

- `puff.team.sourceLoading`: `Loading source event…`
- `puff.team.sourceNoAccess`: `You do not have access to this source event.`
- `puff.team.sourceUnavailable`: `Source event is unavailable right now.`
- `puff.team.sourceClose`: `Close source`
- `puff.team.sourceEvent`: `Source event`
- `puff.team.decisionDelivery`: `Tool decision delivery`
- `puff.team.toolApproved`: `Tool decision: allowed`
- `puff.team.toolRejected`: `Tool decision: rejected`
- `puff.team.retryDecision`: `Retry exact decision`
- `puff.team.retryUnavailable`: `Retry requires the original decision attempt.`

The existing `puff.team.source`, `puff.team.sourceMissing`, `puff.pending`, `puff.failed`, `puff.rejected`, `puff.useUnverified`, `puff.team.toolPermission`, and `puff.team.sequence` keys are reused. These requested labels do not imply that a retry or admission occurred.

## Scope and verification

Only `packages/app/src/components/puff/context-panel/` and this note are edited by the panel chat. The inline peek preserves the original conversation mount; no route change, backend call outside the supplied resolver, tool Allow, or native app action. Synthetic focused tests cover mismatched citation, late response after abort/target change, pending/failed delivery, and capability gating. No test fixture is live Flower/OpenCode evidence.

Changed files: `context-panel/index.tsx`, `context-panel/model.ts`, `context-panel/model.test.ts`, `context-panel/source-peek.ts`, `context-panel/source-peek.test.ts`, `context-panel/context-panel.css`, and this note. `model.ts` keeps decided tool approvals with pending/failed forwarding distinct from pending tool requests and from cross-session awareness delivery. The panel never generates a retry identity or calls claim/decide.

## Verification and remaining integration

- Focused command from `packages/app`: `bun test --conditions=solid --preload ./happydom.ts src/components/puff/context-panel/model.test.ts src/components/puff/context-panel/source-peek.test.ts` — **14 pass, 0 fail** after the clicked-citation test. These are synthetic behavior tests for exact citation, mismatched response, citation mutation during a read, aborted late response, access/missing/offline, focus return, A/B binding, pending/failed delivery, and retry gating.
- `bun run build` from `packages/app` — **exit 0**, 2,600 modules transformed. Build does not establish native behavior.
- `bun run typecheck` from `packages/app` currently fails only in R4-owned `pages/puff/team-state.test.ts` because its in-progress `resolveSource` tests refer to a method not yet implemented. There are no panel diagnostics in that run.
- The lead has not yet added the ten shared copy keys listed above or wired the new props into either host. R4's `canRetryDecision`/`retryDecision` methods exist; its resolver awaits the lead's client method. Until those handoffs land, inline Inspect and retry remain unavailable. The coordinator should not treat this source/build result as N1/N2 native or live evidence.
