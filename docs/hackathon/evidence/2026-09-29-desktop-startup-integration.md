# Desktop startup repair integration

September 29, 2026. Coordinator independently tested the existing startup helper's retained-host wiring fix in a separate integration checkout based on `origin/main` at `90545d29023561f0926b05b19ca1c4ed45617368`. Original and `serdar/ui` checkouts were preserved.

## Problem and change

The retained OpenCode HTTP host used by desktop constructed registered coordination handlers without providing `CoordinationRuntime` and its supporting layers. The host could fail before ordinary coding sessions loaded, even when coordination was not configured.

The host now provides the existing coordination composition, coordination authentication and event layers. Normal health routes remain available without coordination configuration; coordination data routes return explicit 503 rather than crashing startup. This imports the existing backend composition, not a new runner or mock default.

## Independent verification

Runtime: repository-pinned Bun 1.3.14. Dependencies installed with `bun install --frozen-lockfile`; no manifest or lockfile change.

- Before the fix, `bun test test/server/httpapi-coordination.test.ts` from `packages/opencode` reproduced `Service not found: @opencode/CoordinationRuntime`. The first sandboxed attempt could not open its ephemeral local listener; the permitted rerun reproduced the application defect.
- After the fix, `bun test test/server/httpapi-coordination.test.ts test/server/httpapi-global.test.ts test/server/httpapi-instance-route-auth.test.ts test/server/httpapi-authorization.test.ts` from `packages/opencode`: **16 pass, 0 fail, 32 assertions**. This includes health 200, explicit unconfigured coordination 503, and retained instance/authentication behavior.
- `bun typecheck` from `packages/opencode`: passed.
- `git diff --check`: passed.

The changed source and regression are included in the same commit as this receipt. This is an HTTP-host regression and typecheck result, not a new native rendering observation or proof of live Flower/OpenCode collaboration. The coherent desktop UI checkpoint is being integrated separately. Review [desktop coordination](../desktop-coordination.md) before interacting with any shared app window.
