# Main desktop checkpoint

September 29, 2026. Serdar explicitly requested publication to `main` to unblock teammates. Coordinator integrated and independently checked the combined source in `PuffCollaborative-main-integration`, preserving both active development checkouts.

## Source

- Latest teammate baseline: `90545d29023561f0926b05b19ca1c4ed45617368`.
- Startup repair: `e13a0da154`, already pushed separately to unblock native host startup.
- Combined UI/backend source: `beab6436ea`, cherry-picked from the lead's `f4c8ad9ee4`. Includes the existing newer main backend plus the startup fix, session rail, original coding view with context panel, development-instance isolation and frontend recovery fixes.
- Lead's native/benchmark evidence was brought over separately from `7bc81ad060`. Its running native window remains identified as the UI-branch checkpoint; it is not relabeled as a new combined-main native run.

## Independent checks on the combined source

Repository-pinned Bun 1.3.14; frozen dependency installation; no manifest or lockfile changes.

| Check | Result |
| --- | --- |
| App `bun typecheck` | Passed |
| Desktop `bun typecheck` | Passed |
| App `bun run test:unit` | 758 pass, 1 pre-existing locale failure |
| App `bun run test:browser` | 41 pass, 0 fail |
| Desktop `bun test src/main/index.test.ts src/renderer/initialization.test.ts src/renderer/wsl` | 48 pass, 0 fail |
| Desktop `bun run build`, including normal prebuild/server/resources steps | Passed; initial sandbox attempt could not fetch model metadata, permitted network rerun passed |
| Backend `bun test test/coordination.integration.test.ts` before UI-only integration | 1 pass, 51 assertions, explicit mock runner |
| Native-host startup/auth tests before UI-only integration | 16 pass, 32 assertions; missing runtime reproduced before repair |

The only full app unit failure is `desktop-native.test.ts` expecting `pa` for `pa-PK`, while this runtime returns `en`. Coordinator independently ran the pre-UI main baseline: 736 pass and that same one failure. The integrated source adds passing tests and introduces no additional unit failure in this run. This is not an all-green full-suite claim. Sandbox-only local-socket failures disappeared with the permitted test run.

The [lead's receipt](2026-09-29-serdar-native.md) records actual native observations and before/after production benchmarks. Coordinator inspected its captured native image without controlling any app. Independent final native QA remains a separate receipt; these checks do not prove actual model/tool execution, real Flower cooperation or awareness admission/promotion/use.

## Teammate launch

From a clean teammate checkout already on `main`, use the repository-pinned Bun version:

```sh
git pull --ff-only origin main
bun install --frozen-lockfile
bun run dev:desktop
```

If the checkout has local work or a divergent branch, preserve it and integrate main normally; do not reset it to make this command succeed. The ordinary development command builds the retained server/resources. Coordination data still requires the documented configured service and appropriate individual identities; the startup repair does not enable a fake default runner or install credentials. An unconfigured service stays explicitly unavailable while ordinary app health is available.

No agent restarts existing apps to apply this publication. [Desktop access ownership](../desktop-coordination.md) gives native QA sole final-window control; reviewers continue on source/tests and each writes only its assigned files. The remaining review drafts and R1 consumer-test file are preserved in the UI checkout and are not silently included in this publication.
