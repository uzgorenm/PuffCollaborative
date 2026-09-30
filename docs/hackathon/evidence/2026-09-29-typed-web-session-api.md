# Typed web session API walkthrough

Source tested: `6d56bc12a0` (web implementation `05556459d0`, incoming connected backend preserved). Date: September 29, 2026.

## Result

The React workspace at `/` accepts a typed task through New session, preserves the selected model profile, checks visible project scopes, and offers distinct work choices. A real local Next route executes validated commands against atomic filesystem workspace storage. Choosing a task retains its own identity, owner, scope, model, conversation, and source link. `/live` and its backend adapter from the incoming branch remain available separately.

## Verification

- `apps/web`: `npm test` passed 51/51, including the incoming connected-adapter tests. `bun typecheck` and `npm run build` passed; build includes `/api/workspace` and the incoming `/live` route without the prior filesystem trace warning.
- Engine checks: natural frontend wording/typos, distinct recommended scopes, unrelated billing frontend, private-source exclusion, choice freshness, model changes after analysis, continued task context, alternate-port exclusion, and source deduplication.
- API/storage checks: real temporary filesystem writes and service-instance restart reads; 18 concurrent creations without lost sessions; invalid bodies/models/owners/sources/UUIDs; size cap; failure responses; reset/replacement; same-process serialized mutations.
- Browser at `http://127.0.0.1:3005/`: three-step project creation and assignment; typed navigation task; checking state; source-backed recommendations; change model to Astra after analysis; search task creation and continued conversation; reload/reopen retained model, source and messages; Copy code succeeded; EADDRINUSE found Alice’s source, source inspection and context attachment; repeated error reused context; complementary private navigation task; unrelated billing frontend started without a false overlap; My work grouped parallel sessions; reset then undo restored those sessions. A clean reload after integrating the shared branch returned the saved workspace. Final preview had no fresh errors.
- Read-only independent review caught and rechecked bootstrap, changed-model choice, retry, hidden durable-write lock, and source-certainty issues. Navigation can hide progress while a committed write finishes; a canonical refresh completes before another write can replace the workspace.

## Evidence boundary

This is a functioning local seeded API walkthrough. The guidance engine is deterministic; model selections are profiles and do not invoke a provider. People, source scope, statuses, paths, and code suggestions are sample data. No repository edits, test execution, teammate presence, authentication, cross-device access, or live Flower/OpenCode execution are claimed by this view. The existing live workflow gates remain open. Production integration should replace the command service/engine with authoritative coordination and execution ports.

The local artifact `artifacts/puff-walkthrough/puff-api-workflows.mp4` is a 1:19 walkthrough assembled from 15 captured browser states with added cursor movement/click rings and captions, without audio. It is not a continuous screen recording. The final preview capture is `artifacts/puff-walkthrough/puff-api-ready.png`. Media artifacts are deliberately untracked.
