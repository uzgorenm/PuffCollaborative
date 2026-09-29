# Serdar UI branch setup — September 29, 2026

Result: isolated UI development setup verified, with one known full-unit-suite failure. This is not a live collaboration receipt.

Source baseline: `3f75718234` (the existing UI implementation). Branch: `serdar/ui`. Checkout: `/Users/mac/Desktop/Coding/Hackathon/Puff/PuffCollaborative-serdar-ui`. The coordinator changed documentation/branch guidance only after this baseline; application code, package manifests and `bun.lock` were unchanged by setup.

## Executed checks

| Check | Observed result |
| --- | --- |
| Local runtime | Bun 1.3.14 at `/Users/mac/Desktop/Coding/Hackathon/.tools/bun-1.3.14/bin/bun` |
| Dependency setup | `bun install --frozen-lockfile` completed, including existing postinstall hooks; 2,772 packages installed into the isolated checkout. No lockfile/manifest diff. |
| Focused state/API/i18n checks | `bun test --conditions=solid src/pages/puff src/i18n/parity.test.ts`: 18 pass, 0 fail. |
| App typecheck | `bun typecheck` from `packages/app`: exit 0. |
| Production app build | `bun run build`: exit 0. Existing chunk-size, mixed import and repeated emitted source-map warnings were reported. |
| Full app unit suite | `bun run test:unit`: 736 pass, 1 fail. `desktop native locale detection > uses Unicode likely subtags for script-sensitive bundles` expects `pa` for `pa-PK`, receives `en`. This reproduces the earlier UI chat's baseline limitation; setup did not alter the source/test. |
| Browser-condition suite | `bun run test:browser`: 41 pass, 0 fail. This is the package's test suite, distinct from a manual browser walkthrough. |
| New preview | Vite started on loopback port 4445 with `--strictPort`; the earlier preview on 4444 was left running. |
| Browser load | A separate named `serdar-setup` browser session opened `/puff`. The accessibility snapshot shows the synthetic-data notice, compact and expanded alternatives, sharing buttons, shared finding and review controls. No full interaction acceptance was repeated in this setup task. |

The first sandboxed focused-test attempt could not bind its ephemeral HTTP ports: 16 pass, 2 timeouts. Rerunning the unchanged tests with local socket permission produced the 18/18 result above. No assertion or application code was modified to get that result.

## Boundaries

- No production account credentials were entered; no real Flower or OpenCode session was started by this setup.
- The preview is synthetic. Its cards and example responses do not prove a real source-to-Flower-to-target chain.
- The general coordinator inspected other chat summaries and prepared prompts; it did not send instructions to or migrate those chats automatically.
- The updated branch workflow is recorded on `serdar/ui`. The original checkout and other teammates' branches are not changed by these documentation edits. Team integration is deferred to the user's later request.
- The local runtime sits outside source control. The temporary `agent-browser` installation from the earlier UI task was reused solely for the browser-load check; it is not a product dependency.

## Subsequent desktop direction

Serdar's later frontend-chat instruction makes the native desktop conversation experience the target. The checks above remain valid for the earlier shared UI baseline; they do not establish native desktop readiness. A subsequent inspected predev attempt in the original checkout failed on `@opentui/solid/preload`. The frontend chat is investigating launch and the session sidebar/context-panel integration. No native launch success was verified in this coordinator follow-up.

Next action: use the revised desktop assignments in [serdar-agent-prompts.md](../serdar-agent-prompts.md). Agent 1 first carries its current work safely into the prepared branch and verifies native launch. Agent 2 owns panel content, and Agent 3 reviews native behavior. Only the UI integration lead writes Git commits/pushes.
