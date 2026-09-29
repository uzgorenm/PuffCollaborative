# Person overview and guided web workflows

Date: September 29, 2026. Tested application source: `0c002da6c9f278a7da5270f272321d956f529b30` on `serhat`. Preview: `http://127.0.0.1:3005`.

The React/Next.js workspace now opens on Project overview. Each person's name is followed by a concise total-work summary and their individual session summaries. Project work includes the viewer's shared sessions; private work has its own navigation section. The generated original Puff logo replaces the previous mark. The interface uses explicitly labeled local demo state rather than polling synthetic simulator state into ongoing interactions.

## Verification at this source

- `bun typecheck` from `apps/web`: exit 0, using `/private/tmp/puff-toolchain/bun-darwin-aarch64/bun`.
- `npm test` from `apps/web`: 14/14 pass. Coverage includes parallel sessions, independent fixture state, visible-source admission, conservative solved-error matching, source identity, preservation of the original prompt, and topic-specific complementary work.
- `npm run build` from `apps/web`: exit 0. Production compilation, TypeScript, and prerendering complete; `/api/sessions` remains a separate dynamic read-only adapter.
- Observed the full three-step setup in the browser: goal, people, and first task assignment. Default assignments create explicitly illustrative scenario progress. Custom Sam API and Alice release-notes assignments instead produced waiting plans with the supplied tasks. The release-notes scenario supplied no inherited server finding when an EADDRINUSE message was sent.
- Observed each person's total summary above their session rows and My work filtering to two own sessions. Opened the API, access-rule review, and Sam frontend conversations, including navigation through the bottom person-grouped dock.
- Entered a new frontend task, observed Sam's scope warning, and opened the existing session without changing the six-session count. Chose complementary work on another attempt: a separate accessibility/project-switching session was created, with Sam's original work retained. Chose an independent approach on a later attempt: a distinct session retained a human-readable source reference.
- Sent the port-conflict scenario in the API session, inspected Alice's original conversation and message-2 attribution, and added the finding as context. The adapted plan checks the process owner, uses configured port 3005, verifies startup, and preserves the original API task. Repeating the error yielded a reuse response; the conversation contained exactly one attributed context copy.
- Created a private session for You. It appeared in the private section and own overview, rather than another person's work. A literal `(demo-marker)` in the test prompt remained unchanged in the conversation.
- Saved project settings and reloaded: all nine demo sessions remained, including the private session and exactly one copy of Alice's attributed context in the API conversation.
- Visually inspected desktop captures at 1280×720 and the user's 392×489 preview. The narrow view uses stacked person cards and a sidebar toggle; document scroll width was 392 and shell height matched viewport height 489. This is responsive-layout observation, not exhaustive mobile interaction coverage.
- The captured console contains an earlier temporary missing-CSS compilation error while integration files were being saved. The stylesheet was then added; final reloads, workflows, and production builds succeeded, with no later captured error/warning entries in the reviewed log.

## Walkthrough artifact

Local artifact: `artifacts/puff-walkthrough/puff-workflows.mp4` in the React web checkout. It is generated output and is intentionally not committed. The versioned encoder is `apps/web/scripts/render_walkthrough.py`; README documents its manifest format and dependencies.

One video covers setup/task assignment, person summaries, personal parallel sessions, opening Sam's work, overlap warning choices, complementary work, source review, context adaptation, duplicate-context prevention, a deliberate independent approach, and private visibility. It contains 36 actual browser screenshots with an animated cursor, click rings, and captions. It is a captured-UI walkthrough, not continuous screen recording or live agent output.

- Duration: 146 seconds (2:26).
- Format: H.264, 1280×810, 24 fps, 3,504 frames, video only.
- Size: 2,165,810 bytes.
- SHA-256: `fbf8a0152044e0a353b8373fdbe3189c2f69bf5858388dfb3c69f815d162f4c6`.
- Full ffmpeg decode succeeded; faststart atom order checked. Nine representative encoded stills were visually inspected. Every cursor coordinate and caption was validated within the frame/band.

## Boundaries

These are local, reversible interactive demo workflows. Assignment does not execute a model or deliver work to a real teammate. Presence/status and solved findings are sample data. Matching is a conservative local heuristic for these scenarios, not a semantic production coordination service. Browser-only private visibility does not establish authentication or authorization. No live WF01/WF02/WF03, Flower execution, awareness admission/promotion/use, consent, or sharing gate is closed by this receipt.

The desktop/runtime source and `main` are unchanged. No comparative Electron/browser performance benchmark was run.

## Shared-branch integration followup

Tested merged source: `5de0601a83a4f0663bf40c7c91a911995ca9a20b`. Incoming `origin/serhat` through `38d6975358` included a main-sidebar update and native/server changes. Conflicts in the browser page and README were resolved by retaining the newer guided workflows and integrating the incoming person-grouped main sidebar, recent-update view, wider rail, expandable session overflow, and mobile dismissal scrim. The standalone adapter's incoming sample-data changes are retained. Other contributors' native/server changes are preserved; this followup rechecked the affected web package.

At the merged source, package `bun typecheck`, all 14 workspace tests, and `npm run build` pass. A browser reload retained the nine demo sessions; the sidebar visibly shows person → total summary → session title, summary, status. Repeated the Sam overlap warning → open existing session → return to overview without creating another session. At the 392×489 user preview, opened and dismissed the mobile sidebar through its backdrop, then left Project overview open. Saved fresh desktop/mobile screenshots locally. The 2:26 video records the earlier guided-workflow source `0c002da6c9`; the integration adds sidebar detail and preserves those flows.
