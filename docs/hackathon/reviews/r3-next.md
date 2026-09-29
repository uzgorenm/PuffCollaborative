# R3 follow-up — shared-thread focus regressions

September 29, 2026, 14:16 PDT. Work in `/Users/mac/Desktop/Coding/Hackathon/Puff/PuffCollaborative-main-integration`; observed HEAD `65dbeee0800e6695927a44d72c4a94481d774c6d`. Only `packages/app/test-browser/puff-focus.test.ts` and this note are R3 writes. The coordinator owns Git. No native app, shared server, persistent fixture, or dependency was changed.

## Regression coverage

`packages/app/test-browser/puff-focus.test.ts` mounts the real `TeamThreadPage`, its `ContextPanel`, the real `createTeamController` and authenticated client, schema-decoded synthetic HTTP responses, and the repository's Solid JSX transform. Narrow mocks supply the controller context and design-system Button primitive because other browser-suite files may have cached those TSX modules; assertions do not target the mocks. The five cases check:

1. Reduced-motion CSS media rules disable shell and panel animation/transition and smooth scroll. This parses the actual CSS with CSSOM; it verifies the rule and declarations, not OS preference rendering.
2. Closing context sets `aria-expanded=false` and `inert`, removing its controls from the active focus region.
3. Escape from a context action closes the panel and returns focus to its visible toggle.
4. Toggling context preserves the same real composer textarea and unsent controller draft.
5. Inline Inspect through the real thread host uses its controller/client to request the exact cited event. An unchanged snapshot refresh while Inspect holds focus keeps that same button. A second refresh while the peek Close button holds focus keeps the same Inspect and Close nodes, the visible cited event and focus. Escape then closes the peek, returns focus to the exact Inspect button, and stays inside the still-open context. The case also checks the same composer, unsent draft, message node and reading position. The transport response and scroll dimensions are synthetic.

The older `puff-team-focus.test.ts` exists in the QA checkout but **not** in this integration checkout. R3 added the missing integrated polling-focus assertion in case 5. Earlier source findings about per-thread positions, cited-event focus and narrow stacking have landed in lead-owned files; native D02–D05 acceptance remains separate.

## Red-to-green finding — panel owner

The fifth test initially failed on panel source SHA-256 `23b2503fcaaeeb8108d7dab82a4045152529bb3fb76bee649a47809846c26fb3`. The real host supplied the resolver and made exactly one request to `/api/coordination/v1/projects/prj_focus/events?after=0&limit=1`, with the correct synthetic event returned. `Inspect` changed to `aria-expanded=true`, but no peek or Close button appeared; the focused run was **4 pass, 1 fail**.

Cause: `openedScope` was a plain variable. The peek visibility expression short-circuited on its empty initial value before reading a reactive signal, so the region did not subscribe to later source changes. The panel owner moved the opened scope into reactive `peekView` state. R3 made no production change. Under updated panel SHA-256 `b81bf36548b58708ef93934d0baa38359b1003a6e359bbf23e6d9b10fdd61b01`, the same real-host case now renders the exact source, survives unchanged polling while Inspect and Close hold focus, and on Escape returns focus to Inspect while keeping context, the composer draft, message node and reading position.

This closes the source-level N1 peek blocker found by R3; native N1 acceptance remains with QA.

## Verification and limits

- Pinned Bun 1.3.14, from `packages/app`: `bun test --conditions=browser --preload ./happydom.ts ./test-browser/puff-focus.test.ts` — **5 pass, 0 fail**, 44 assertions.
- Pinned Bun 1.3.14, from `packages/app`: `bun run test:browser` — **46 pass, 0 fail** across 15 files, 144 assertions.
- Explicit typecheck of this browser test using a temporary `/private/tmp` config extending app `tsconfig.json`: `tsgo -p /private/tmp/puff-r3-typecheck.json --pretty false` — exit 0. Standard app tsconfig excludes `test-browser`.
- Test file SHA-256: `bf45d44b2df1a97cda8a5c5f21ec91702c2c946b9db0caab6e948aa131266be3`. The reviewed lead host `team-thread.tsx` SHA-256 is `5cd5d15b356b8c5a5465f5edcbc1b2618e56c9c56b09b5354377f4fa9151827e`; controller `team-state.ts` SHA-256 is `0c97295b7ce3eddd1977f33b239c8d18c187b4eb8db3ef3802a14dfe04a7c838`.
- Happy DOM checks attributes, events and focus but does not perform OS Tab traversal or evaluate `prefers-reduced-motion` into computed styles. A one-off Playwright Chromium launch was denied by the sandbox with Mach port `Permission denied (1100)`. CSSOM coverage guards declarations; it is not a visual or native reduced-motion result.

QA should check N1/D03/D05 in the native window: Tab past closed context controls; open Inspect; Escape and confirm return focus; confirm B's draft, reading position and Session identity; resize to the agreed minimum width; repeat with OS Reduce Motion. No new production test hook is requested. Live WF02/WF10 remain separate.
