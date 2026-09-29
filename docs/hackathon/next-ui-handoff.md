# Frontend composition plan and handoff

Owner: frontend lead. Checkout: `PuffCollaborative-main-integration`; coordinator alone writes Git. Spec: [next-development.md](next-development.md). **Ready and frozen for coordinator integration.** No native interaction is assigned to this slice.

## Published client contract

```ts
source(
  projectId: string,
  ref: { threadId: string; eventId: string; seq: number },
  signal?: AbortSignal,
): Promise<Coordination.Event>
```

This method is implemented on `createTeamApi` in `pages/puff/team-api.ts`. It uses the existing authenticated project replay endpoint with `after=seq-1&limit=1`. It rejects invalid/unsafe sequences, empty results, multiple results, and project/thread/event/sequence mismatches with `ProjectApiError("invalid")`; current HTTP access/availability errors remain unchanged. It captures the requested citation before awaiting transport, so a caller's changing reference cannot authorize a different event. It never searches similar text or another project. Caller abort is forwarded, and an aborted late result is rejected.

R4 has implemented `resolveSource(ref, signal)` against this signature, preserving its captured service/member generation and selected target. Both hosts pass the controller's non-secret `state.sourceScope`, which changes on each connection generation, and stable `resolveSource`, `canRetryDecision`, and `retryDecision` references directly. A service URL alone does not establish member/reconnect identity.

## Scoped implementation plan

- [x] Add source-lookup regressions in `team-api.test.ts`, observe failure, implement the method and verify exact identity/auth/abort cases.
- [x] Add panel-requested shared labels in `i18n/puff-en.ts`; mount the supplied source/retry props in `team-thread.tsx` and `team-shell.tsx` after R4 supplies scope/resolver.
- [x] Mount R2's `SessionIdentity` in the shared rail/header, using actual Thread metadata and only a matching authoritative nonterminal Run. Preserve the original local coding children, composer, reading-position lifecycle and panel host transitions. Personal rail rows also show the actual Session ID; no unknown owner/worker/status is invented.
- [x] Run focused client/panel/identity/controller tests, i18n parity, browser regressions and app typecheck/build. Publish source-only results and remaining native acceptance limits here for coordinator review.

Review focus: wrong or missing citation; delayed response after abort/identity change; stable callback identity across polling; decided-but-undelivered tool permissions; same-prefix session titles with full accessible identity. R4 owns controller races/recovery, the panel owns evidence-peek behavior, and R3 owns browser coverage. Those files are not edited by the lead.

Ruling: use this existing handoff as the plan/verification ledger within the assigned write area. Keep the published `serdar/ui` checkpoint and running native app unchanged. Coordinator owns the later combined review, commit and publication.

## Ready source boundary and checks

The lead's six implementation/test files above are ready, reviewed and frozen. `team.css` only adds host flex/overflow constraints for the supplied identity component and keeps the context toggle from shrinking. Original Session/timeline implementations and shared composer/scroll lifecycles are unchanged. No API schema/backend or native input was changed by this lead.

- Client red: 20 new tests failed because `source` was missing. A later mutable-citation test independently failed because a changed reference could accept a replacement event; capturing the request identity fixed it.
- Client green: **25 passed, 0 failed, 46 assertions** (`/tmp/puff-next-source-green.log`). Tests cover the real client through synthetic HTTP transport, not live shared-service behavior.
- App typecheck passed after branded fixture/table corrections (`/tmp/puff-next-app-typecheck.log`). The initial two test-only diagnostics are resolved.
- Combined focused client/controller/panel/identity/i18n checks passed **65 tests, 1191 assertions** after the final mutable-reference regression (`/tmp/puff-next-focused.log`).
- App production build passed (`/tmp/puff-next-app-build.log`), with existing Vite import/chunk warnings.
- Historical browser failure: R3's real-host Inspect case found `aria-expanded=true` but no source-peek DOM. Agent 2 replaced the plain `openedScope` visibility guard with reactive store state. This was a production component defect, not a harness-only failure; final passing results follow below.

The integrated source has not been run in the native window. N1/N2/N3 native checks, long-history behavior, narrow layout, OS reduced motion, and real Flower/admission/use remain distinct acceptance work. The prior native24-second focus result applies to `serdar/ui`, not this combined checkpoint. Overview/navigation is a later explicitly transferred ownership slice and is not included here.

## Independent review

The existing read-only desktop reviewer checked the six owned files against the integrated controller/component contracts. One material P2 was reproduced: changing the sidebar's selected project from A to B leaves A's shared conversation open, but the controller resolver queried B's replay. R4 corrected its resolver to use the authorized displayed snapshot's project while retaining async selection/account guards. The reviewer independently rechecked the correction and ran both targeted regressions: **2 passed, 9 assertions**. No remaining blocking findings were reported in the reviewed lead slice. The panel visibility defect is also resolved and covered by R3's real-host test.

Frozen SHA-256 values for coordinator review:

| File | SHA-256 |
| --- | --- |
| `pages/puff/team-api.ts` | `85fed593b971216402f4e654150afd26a3c0ec8b62e8d4709e3449998d7fb92a` |
| `pages/puff/team-api.test.ts` | `155612648196d99599c8217a4282212a4cc3dfd228dcae4ed5b9991bd8a6d361` |
| `pages/puff/team-thread.tsx` | `5cd5d15b356b8c5a5465f5edcbc1b2618e56c9c56b09b5354377f4fa9151827e` |
| `components/puff/team-shell.tsx` | `0c6ba94b8a014b9d2b8404ef77b562aea6ff74bf7607a5e1cc9f5c1ba5b3e59b` |
| `components/puff/team.css` | `fc4b8ec8ae9274bc0d3b625b7ede45ac917f0b7367b50fc0b69ebf483d8eb608` |
| `i18n/puff-en.ts` | `6f162dd26b5fd53b369fcf8cf608db0a4570b8329e0da18cf5c5c0143e15244c` |

Paths in this table are relative to `packages/app/src`.

## Final combined verification and release

Verified against detached HEAD `65dbeee0800e6695927a44d72c4a94481d774c6d` plus the frozen lead hashes above and ready peer source. No commit, stage, push, native action or runtime restart was performed by this lead in this checkout.

From `packages/app` with repository-pinned Bun1.3.14:

- `bun test --conditions=solid --preload ./happydom.ts src/pages/puff/team-api.test.ts src/pages/puff/team-state.test.ts src/components/puff/context-panel/model.test.ts src/components/puff/context-panel/source-peek.test.ts src/components/puff/session-identity/model.test.ts src/i18n/parity.test.ts`: **67 passed, 0 failed, 1200 assertions**. Log `/tmp/puff-next-focused.log`.
- `bun run test:browser`: **46 passed, 0 failed, 136 assertions**. Log `/tmp/puff-next-browser.log`. R3's real-host case exercises the authenticated client/controller, exact project replay, visible source peek, focus return, and retained composer/draft in synthetic DOM fixtures.
- `bun typecheck`: passed. Log `/tmp/puff-next-app-typecheck.log`.
- `bun run build`: passed. Log `/tmp/puff-next-app-build.log`; existing Vite import/chunk warnings remain.
- Prettier check and scoped diff whitespace check: passed for the six owned files.

Peer source hashes at final verification: `team-state.ts` = `0c97295b7ce3eddd1977f33b239c8d18c187b4eb8db3ef3802a14dfe04a7c838`; `context-panel/index.tsx` = `b81bf36548b58708ef93934d0baa38359b1003a6e359bbf23e6d9b10fdd61b01`; `test-browser/puff-focus.test.ts` = `741c4abc2380eb97fb3fc04b1c3523e073aa06d264ccd27eefb8f8fc58a0f777`.

The lead releases this source checkpoint for coordinator review/publication and later explicit host-ownership transfer. Native N1–N3 acceptance remains pending on a released integrated build; these checks do not establish real Flower execution, target admission or agent use.
