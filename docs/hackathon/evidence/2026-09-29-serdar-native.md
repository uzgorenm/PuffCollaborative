# Serdar native desktop checkpoint

Tested code commit: `f4c8ad9ee4f9c9e411e161e6ea6980099ecc85c0` on `serdar/ui`. September 29, 2026. Native renderer + schema/controller/unit + production build evidence. Not a real Flower/agent execution acceptance receipt.

## Shipped UI slice

Persistent personal/shared session rail; original local coding Sessions retain their composer, agent/model controls, tool rendering and code review. One extracted ContextPanel sits beside both local and shared conversations. Its exact service/session/thread/worker binding prevents wrong-target context; unbound, missing, stale or offline records stay explicit. Context and sidebar transitions retain the mounted coding view; narrow windows stack context without covering the composer. Escape from the panel returns focus to its toggle; reduced-motion CSS disables host motion.

The existing registered member API powers shared snapshots, replay, comments, queued instructions and cancellation. Credentials remain in memory. Drafts, scroll positions and uncertain request identity survive reconnect only within the same service/member compartment. Old reads are aborted/generation-guarded, roster refresh runs while a thread is open, and capped replay stays nonwritable until caught up. Tool Allow is disabled because no reviewable tool arguments/scope are supplied. Approval decision delivery remains a backend/reconciliation follow-up, separate from the human decision.

The original checkout was preserved byte-for-byte for owned source. No reset, branch switch, stash or main push was performed by this lead. Newer backend code was not merged into this UI branch.

## Verified checks

| Check | Result |
| --- | --- |
| App `bun typecheck` | Pass, `/tmp/puff-final-app-typecheck.log` |
| Desktop `bun typecheck` | Pass, `/tmp/puff-final-desktop-typecheck.log` |
| Focused controller/API/panel/i18n tests | 27 passed, 0 failed, 1080 assertions |
| App full unit suite | 758 passed, 1 existing failure: `desktop-native.test.ts` expects `pa` for `pa-PK`; runtime returned `en`. Not changed by this work. |
| App browser tests | 41 passed, 0 failed |
| Desktop startup/renderer/WSL focused tests | 48 passed, 0 failed, 80 assertions |
| App production build | Pass via production benchmark command |
| Desktop production build | Pass; prebuild prerequisites already prepared, `bun run --ignore-scripts build` |
| Production v2 session switch/review benchmark | Before and after pass; 72 synthetic review diffs, one cold/hot trial with review closed/open; zero wrong/blank/unknown samples and zero review-host missing/replaced samples. |
| Formatting / diff whitespace | Owned lead files formatted; `git diff --cached --check` passed before code commit |

Benchmark stable-observation times (one sample per cell; diagnostic only, no performance guarantee): closed cold 53.7→54.9 ms, closed hot17.7→14.2 ms, review-open cold36.5→35.7 ms, review-open hot18.7→28.9 ms. Raw records: [comparison](assets/2026-09-29-session-switch-comparison.json). Existing Session/timeline implementations were unchanged.

Commands run from `packages/app` with pinned Bun1.3.14: `bun typecheck`, `bun run test:unit`, `bun run test:browser`, `bun test --conditions=solid --preload ./happydom.ts src/pages/puff/team-state.test.ts src/pages/puff/team-api.test.ts src/components/puff/context-panel/model.test.ts src/i18n/parity.test.ts`, and `PLAYWRIGHT_PORT=4477 OPENCODE_PERFORMANCE=1 SESSION_TAB_SWITCH_RUNS=1 bun x playwright test --config e2e/performance/playwright.config.ts timeline/session-tab-switch-benchmark.spec.ts --grep 'v2 session tab switching'`. The first unprivileged full-suite attempt had two loopback-listen failures; rerun with loopback permission left only the known locale failure.

Desktop commands: `bun typecheck`, `bun test src/main/index.test.ts src/renderer/initialization.test.ts src/renderer/wsl`, `bun run --ignore-scripts build`. Existing full desktop suite additionally has a Bun `node:sqlite` environment limitation; the focused startup suite above is the current scope.

## Actual native observation

Electron PID41738, intended checkout, dev profile `/tmp/puff-serdar-ui-desktop`, renderer5175, CDP9223, external OpenCode service4466. Service source was original0a91f6231a plus the frozen legacy-host composition fix. Native app confirms original existing `ses_desktop_compact` / `ses_desktop_expanded` open; A→B→A preserves unsent drafts; panel close retains the exact composer DOM element. The original patch tool expands to an inline code diff beside the original model/composer controls. The transcript and project visibly identify synthetic data. [Native screenshot](assets/2026-09-29-serdar-native-coding.png).

The tool/diff transcript was explicitly seeded static rendering data into the existing isolated compact Session. No model/tool execution occurred. Backend uses a configured mock runner; queued instructions are not proof of target Session admission, promotion or use. No Flower run, sharing-consent enforcement, topic relationship or automatic awareness is claimed.

Final intended-window QA was released exclusively to Agent3 after code freeze; its pending independent result is recorded separately in `serdar-desktop-qa.md`. Initial original-window QA reproduced a narrow overlay hiding focused Send; this source replaces the overlay with stacked context. Final independent native retest and OS reduced-motion observation remain pending at this receipt's creation.

## Running this checkpoint

Use the prepared checkout on `serdar/ui` and repository-pinned Bun. Ordinary retained native launch is `bun run dev` from `packages/desktop` after workspace dependency installation; its predev builds the retained server and native resources. That branch's older bundled backend does not contain the newer member coordination handlers. Integrate the separately owned backend before expecting shared API support there.

To use an **already running** configured backend for native development without spawning another one:

```sh
cd /Users/mac/Desktop/Coding/Hackathon/Puff/PuffCollaborative-serdar-ui/packages/desktop
OPENCODE_DESKTOP_SERVER_URL=http://127.0.0.1:4466 \
OPENCODE_DESKTOP_PROFILE=/tmp/puff-serdar-ui-desktop \
OPENCODE_DESKTOP_RENDERER_PORT=5175 \
bun run --ignore-scripts dev -- --remoteDebuggingPort 9223
```

This command assumes predev resources exist and Electron is installed; don't run it while that profile/port is already active. The observed test launch reused the original installed Electron executable through `ELECTRON_EXEC_PATH`; all app entry/source and built assets came from the intended checkout. Explicit external URL/profile overrides are development-only and ignored by packaged apps. No installer publication or bundled-sidecar relaunch is claimed.

## Integration handoff

Ready UI commit `f4c8ad9ee4f9c9e411e161e6ea6980099ecc85c0`. Coordinator owns any later main integration; this lead publishes only `serdar/ui`. The frozen original server composition fix is outside this commit; newer backend dependencies and hashes are in [desktop handoff](../serdar-desktop-handoff.md). Panel ownership and props: [panel handoff](../serdar-context-panel-handoff.md). Review/QA drafts and R1's separately reserved integration test are excluded from this code commit until their owners finish and results are reviewed.

## Independent target QA addendum — September 29, 13:43 PDT

Agent3 completed a bounded pass on the intended native Electron renderer5175/CDP9223 with a dedicated agent-browser session. Reviewed source hashes remained those of code `f4c8ad9ee4`; HEAD's later changes were documentation only. Input control was released back to the lead, and the initial1280×800/DPR2 renderer geometry was restored.

- QA-N02 passes in both local and shared760×800 renderer layouts: keyboard-focused Send and its ring stay visible with context open; center hit-testing confirmed the control is exposed. This is native-renderer viewport emulation, **not** an OS minimum-window-size test. [Narrow focus capture](assets/2026-09-29-serdar-native-narrow-focus.png), also visually inspected by the lead.
- Local A/B preserved the lead's original distinct unsent drafts, and the exact Session context updated after loading. The expanded static inline patch survived navigation and toggles. Traversing from the original composer into context, then pressing Escape, closed the panel and returned focus to Team context.
- Shared A's temporary unsent marker survived A→B→A while B stayed empty. QA cleared its marker. The normal review pane opened beside coding with context stacked; this fixture has no tracked repository changes, so only the static inline diff was exercised.
- QA restored compact local Session, original unsent A/B drafts, expanded inline patch, open context, expanded sidebar, closed review and composer focus. No sends, Session creation, backend controls, process restarts or OS-preference changes.

Still untested: exact source-citation/receipt navigation, long-history restoration, native minimum window geometry, OS reduced motion and offline failure behavior. There was no fresh integrated-main launch, installer test or Flower execution. These bounded passes do not close all D01–D06 subcases or WF02/WF10. The detailed Agent3 receipt remains separately owned while its final write completes.

## Polling focus regression follow-up

After the independent pass, the lead reproduced its focus caveat on the same native target: focus Stop request without activating it, allow ordinary polling, then inspect the focused node. Before the fix, the saved button was disconnected, its replacement was a different node, and focus was on `BODY`. Snapshot and roster replacement remounted keyed rows on each refresh.

The controller now reconciles snapshots and roster records by identity. A browser-condition regression test verifies that unchanged rows retain identity and changed approval versions still update. Solid's server store intentionally has different reconciliation behavior, so this belongs in `test-browser/puff-team-focus.test.ts`.

On the existing Electron renderer5175/CDP9223 after the change, Stop request remained the same connected, focused `BUTTON` from timestamp1790715204343 through1790715228990 (24.647 seconds, spanning multiple normal two-second refresh intervals). Escape then closed context (`aria-expanded=false`, panel inert) and focused the Team context toggle. The lead reopened context and returned focus to the original Prompt; its `QA: compact draft retained` text remained unchanged. No action was submitted or canceled, and no process was restarted. HMR had cleared in-memory team credentials; the existing synthetic member was reconnected before testing.

Fresh checks: app browser suite **42 passed, 0 failed, 106 assertions**; focused app controller/API/panel tests **22 passed, 0 failed, 101 assertions**; app typecheck and production build passed. Desktop production bundling also passed with `bun x --no-install electron-vite build`, using the already prepared resources. The attempted package build invoked prebuild despite `--ignore-scripts` and could not fetch models.dev in the sandbox; direct bundling avoids rebuilding the unchanged backend. No packaged installer or fresh sidecar launch was tested.

The full independent [Agent3 receipt](serdar-desktop-qa.md) is now complete; its historical focus caveat is resolved only for the controlled lead retest above. All other untested boundaries remain unchanged. The lead has finished native input and explicitly releases CDP9223, renderer5175 and profile `/tmp/puff-serdar-ui-desktop` for the next coordinated owner; no automation remains active.
