# Compact React sidebar — September 29

Tested source: `1497e7cbbf3d0dfd2502d623f5a193be0b2bc818`, including sidebar change `06ed2cd780` and incoming `origin/main` at `257811a627`.

The left project sidebar removes the separate Working/Ready/Completed text line. Session titles and one-line summaries remain. Green, amber, and blue-gray dots represent running, waiting, and completed sessions; hover titles and accessible button names retain the status.

Verification: 14/14 workspace tests and package `bun typecheck` pass after integration. Production `npm run build` passes; incoming main contains no changes to `apps/web`, confirmed with `git diff --quiet 06ed2cd780 1497e7cbbf -- apps/web`. Browser inspection confirms distinct computed dot colors and 47px rows without a visible status meta line. Opening Sam's session and returning to overview both work. Screenshot: `artifacts/puff-walkthrough/compact-sidebar.png` (local ignored artifact). `git diff --check` passes.

The React interface still uses browser-local demo state. Backend integration should replace the sample workspace source and local task/message/context actions with the authoritative coordination API and events. The separate `/api/sessions` simulator adapter is not polled by this view. No live execution, presence, or access-control gate is closed by this UI change; see `apps/web/README.md`.

Incoming Flower code is preserved unchanged. Documentation conflicts retain both the native preview evidence and Flower checkpoint, plus each owner's newer task status. Publication to `main` is explicitly authorized by the user's request.
