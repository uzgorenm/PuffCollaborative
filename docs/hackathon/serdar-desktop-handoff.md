## Ready code checkpoint

`f4c8ad9ee4f9c9e411e161e6ea6980099ecc85c0` is the coherent verified UI/native-startup commit on `serdar/ui`. App and desktop typechecks/builds pass; focused app27/27, desktop48/48, browser41/41. Full app758pass plus known Punjabi locale failure. Production before/after session/review benchmark passed. [Full receipt](evidence/2026-09-29-serdar-native.md). No main push or backend merge by this lead. The native target is now exclusively released to Agent3 QA (Electron41738/profile `/tmp/puff-serdar-ui-desktop`, renderer5175/CDP9223); lead will not interact during its bounded retest. Original9222 is idle and no longer under active QA.

# Desktop lead handoff — September 29, 2026

**Publication update:** the coordinator integrated UI source `f4c8ad9ee4` onto the newer main backend as `beab6436ea`, after publishing startup fix `e13a0da154`. See the [combined verification](evidence/2026-09-29-main-desktop-checkpoint.md). The branch-specific backend limits below describe the earlier UI-branch checkpoint. The [central access record](desktop-coordination.md) supersedes the historical window-ownership table: final native input has been released to QA.

Target: `/Users/mac/Desktop/Coding/Hackathon/Puff/PuffCollaborative-serdar-ui`, branch `serdar/ui`. Sole Git writer: Agent 1. Original checkout remains on main with every unfinished file preserved. A byte-verified backup and manifest live at `/tmp/puff-desktop-handoff-20260929`.

15 owned app/desktop/plan files were copied after verifying each existing destination matched the original UI base `3f75718234`. The newer backend was **not** copied or merged. The original helper's legacy-host wiring patch and regression test are preserved in that backup and original checkout.

## Panel boundary

Agent 2 was explicitly released to edit `packages/app/src/components/puff/context-panel/` and `docs/hackathon/serdar-context-panel-handoff.md`. The lead extracted the existing section to `context-panel/index.tsx`; there is one component, `ContextPanel`.

Existing host: `pages/puff/team-thread.tsx`. Additional local-chat host: `components/puff/team-shell.tsx` (lead implementing). Mounting, toggle/focus, outer aside/grid, transitions and shared i18n remain Agent 1's files. The original Session/composer/timeline/tool/review components remain unchanged.

Current props: `target?: { sessionId; workerId?; threadId? }`, `snapshot?: TeamThread`, `related?: readonly Coordination.Thread[]`, `connected`, `loading`, `error?`, `writable`, `busy`, `onCancel(run)`, `onReject(approval)`. All data comes from the lead's existing client/provider; the panel creates no network requests or runner. Exact identity is required before showing context. Allow is disabled because the current API has no reviewable tool arguments/permission scope.

Reuse extracted WorkCard task/progress/blockers/outcome/evidence refs, queued runs and permission content. Agent 2 moves panel-internal styles to its directory and reports removed host-CSS blocks. Shared copy keys requested in its handoff will be integrated by the lead. Old source WorkCards are explicitly stale; missing admission/promotion/use receipts remain unknown.

## Native/backend boundary

Original native Electron is idle and released to Agent 3 at CDP9222. It is an interim source checkpoint, not final intended-checkout D01 evidence. The helper owns an isolated intended-checkout native launch with explicit external-server development mode; this avoids starting another backend or restarting any existing process.

Existing configured OpenCode HTTP service: `http://127.0.0.1:4466`; original backend source `0a91f6231aa4d64cc909839f46c376d54b1b1116` plus the preserved legacy-host coordination layer fix. Isolated synthetic data: `/tmp/puff-desktop-service`; project `prj_desktop_fixture` visibly labeled `Desktop integration · mock runner`. No real model/Flower execution is claimed.

Existing local sessions: `ses_desktop_compact`, `ses_desktop_expanded`. Workspace `/tmp/puff-desktop-service/workspace`. Shared threads: `thr_8f80fe07-58e3-497f-b2b3-17356edb944d`, `thr_11a52a2a-2ad4-4d06-bbc1-e2d7a2f60d71`.

## Backend dependencies

The branch retains its older backend. The member UI reads the registered `/api/coordination/v1` contract in the external original service. Newer `WorkCard` optional read fields are decoded in the UI adapter until schema integration; no backend schema has been invented. Source diff from `3f75718234` to `0a91f6231a` contains the newer auth/runtime/handlers; backend integration belongs to the later teammate-branch integration. The old in-branch backend will display unavailable for coordination rather than pretend to support these endpoints.

## Consumer test reservation

R1 may exclusively add `packages/app/test-integration/puff-member-flow.test.ts` after the coordinator relays this handoff, using the existing `createTeamApi` and external4466 service. No team-* client/state, startup, schema or generated-file edits. Fixtures must stay isolated and labeled; credentials stay outside source/receipts. R1 coordinates any writes to the shared fixture with native QA; queued cancellation is permitted only on its own consumer-test instruction. No backend/server restart. Results go in `docs/hackathon/reviews/r1.md` and do not close real execution/Flower gates.

## Frozen startup dependency and native ownership (13:23 PDT)

The original legacy-host wiring patch and regression test are frozen, ready for the coordinator to snapshot. They require the newer backend already on main; do not apply the imports to the older serdar/ui backend. Focused original OpenCode HTTP tests: 18/18, original opencode typecheck passed (logs `/tmp/puff-native-startup-green.log`, `/tmp/puff-native-startup-typecheck.log`). No main integration or push is performed by this lead.

- `packages/opencode/src/server/routes/instance/httpapi/server.ts` SHA256 `58e4bd62799fb813190d49fac9c01a126275af8f682939b32489f2b7b7ebe81b`
- `packages/opencode/test/server/httpapi-coordination.test.ts` SHA256 `fe8eb9788f1e7206fd76df6e97b934e5beee03597a99e3be98a75ce432a1ff8e`

Exact newer backend commits: `34c7ee315a` durable backend/mock integration, `71104c6529` fail-closed routes, `4124e1af73` test correction, and preceding runner recovery `2ca65ac8bf` / `647fa40212`; original current HEAD `0a91f6231a`.

| Native instance | Interaction owner | Source/profile | Renderer / CDP | Backend |
| --- | --- | --- | --- | --- |
| Electron33364 | Agent3 QA, interim only | Original0a91f6231a + preserved dirty UI; `/private/var/folders/sf/0z_cw3qj5ln_8pflrbg9b3t40000gn/T/opencode-onboarding-4b049028-787f-420d-95b5-94bda507b2f6` | 5173 / 9222 | External4466 |
| Electron41738 | Agent1 lead until explicit release | serdar/ui dirty checkpoint; `/tmp/puff-serdar-ui-desktop` | 5175 / 9223 | External4466; no extra backend |

Use targeted CDP per instance only; no global mouse/keyboard automation. Original native/backend processes were not restarted. Target startup log `/tmp/puff-serdar-ui-electron.log`; explicit development external-server mode ignores overrides in packaged apps. Runtime Electron executable was reused, but app entry/source is the intended checkout.

Native lead observed original existing compact session open, normal composer, model controls and original Toggle review. A→B→A kept `QA: compact draft retained`, and panel close kept the exact same composer DOM node. Fixtures have no actual tool execution yet; original tools/diff rendering still needs populated-fixture observation. Benchmark baseline before local panel host: production app, 72 review diffs, v2 cold/hot switching 1 repetition each, passed with zero wrong/blank samples. `/tmp/puff-baseline-benchmark.log`.
