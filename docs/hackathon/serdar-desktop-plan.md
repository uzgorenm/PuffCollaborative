# Serdar: desktop conversation workflow

User direction: desktop-first, familiar agentic chat with shared sessions, natural context updates, clear use cases and restrained animation. The prior conversation design was approved by “Let's just do the desktop app.” This is a change to existing layout/navigation, not a new desktop/runtime. Execute inline on serdar/ui; preserve the original checkout and other owners' work.

## Design

Keep the original OpenCode conversations, model controls, tools and diffs. Add a persistent collapsible session rail to the retained desktop layout, with real personal sessions and authenticated shared sessions. Shared conversations show authoritative instructions, comments, runner events, approval/queue state and an optional context panel. One connection flow uses the existing server by default and individual team credentials. No synthetic content appears in the normal desktop flow. Keep the old synthetic page only as an explicitly named development preview.

The newly landed coordination API is authoritative. Use its schemas and registered Basic-auth routes. Never claim that mock runner output establishes model execution or Flower awareness. Context panels can show the actual work card; automatic awareness remains dependent on the owning backend/runtime/Flower workstreams.

## Implementation

- [x] Boot existing Electron app and observe the baseline. Use the same retained frontend; no new production dependencies.
- [x] Add a schema-validated coordination client and conversation projections. Test ordered/deduplicated events, stable submission identity and auth/error behavior.
- [x] Add a shared state provider, connection form, session rail and native-router navigation. Preserve drafts across switching; prevent duplicate/ambiguous sends and late responses from another thread.
- [x] Add shared conversation, comment/instruction composer, work-card context, queued/failed/approval states. Reuse existing UI controls and localization.
- [x] Add purposeful sidebar/panel/message transitions, reduced motion and keyboard support. Verify actual Electron with local sessions and coordination fixture data where needed; mark fixture evidence accurately.
- [x] Review, run targeted tests/typechecks/build, update evidence/board, commit and push serdar/ui. Final independent native QA remains separately tracked.

## Rulings and evidence

- The newer user instruction supersedes historical main-only rules: use the existing serdar/ui checkout and publish that branch. Main integration belongs to the coordinator.
- The web marketing/docs packages were removed; `packages/app` remains because Electron imports it. Browser preview was only a development surface.
- Incoming main `0a91f6231a` adds real coordination handlers with an explicit mock runner. Consume those contracts rather than expanding the provisional dashboard API.
- Initial desktop preparation needed the actual `opencode` workspace dependencies; the package is not named `@opencode-ai/opencode`.

Tested code: `f4c8ad9ee4f9c9e411e161e6ea6980099ecc85c0`. See [native receipt](evidence/2026-09-29-serdar-native.md) for limits, including mock/static fixtures and independent QA still pending.
