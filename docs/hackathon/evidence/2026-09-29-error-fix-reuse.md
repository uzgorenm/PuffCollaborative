# Native error fix reuse correction

## Tested code and scope

- Native UI code checkpoint: `d9609a30aa`; `f511504cc4` retains identical app/simulator implementation while adding the HTTP client regression tests and incoming main/Flower work.
- Native Solid/Electron shared-conversation UI and mapped local Session placement. No replacement browser app was created for this correction.
- A failed Session automatically checks fresh completed shared WorkCards and exact permitted source events. A source `run.output` can carry `fix: {error, summary, patch, verification: {command, exitCode, output}}`.
- Match requires the same normalized first error line (including component name), a current done card with a verified outcome, exact source identity, attributed member/contributor and nonempty patch with passing source verification.
- Inspect reveals the patch, original check and source Session. Apply rechecks source/target revisions and membership, then submits an attributed instruction to the existing target worker using the canonical endpoint. No thanks dismisses the current source/error pair without an instruction.
- Admission is not application: only an exact apply Run with diff, passed target verification and completion renders the applied receipt. Ambiguous POST responses retry the original request ID and text.
- Sidebar hierarchy is person name -> aggregate fresh contributor report -> individual started/shared sessions with their summaries. Uncertain creator attribution stays in details. Test-data disclosure is in connection settings, with no simulator banner or manual task-name form in the ordinary conversation.

## Verification

- Focused app: 71 pass, 0 fail, 265 assertions across fix matcher, controller, API/state and people rail tests.
- Browser suite: 47 pass, 0 fail, 147 assertions; source navigation/focus and context/composer behavior preserved.
- App typecheck and production build passed.
- Full app unit suite with loopback permission: 835 pass, 1 fail. Unchanged `desktop-native.test.ts` case `uses Unicode likely subtags for script-sensitive bundles` expects `pa-PK -> pa`, receives `en`. Initial restricted run also failed two existing HTTP tests; both passed with loopback permission.
- Simulator + actual native controller over HTTP: 13 pass, 0 fail, 339 assertions. Matching error automatically suggested Alya; No thanks left the target untouched; Apply changed a disposable real TypeScript file and ran Bun tests (baseline exit 1, after patch exit 0); unrelated timeout was excluded; injected failing check remained failed; exact retry produced one Run.
- Production `mergeTeamEvents` CPU baseline, 200 events/1000 calls: p50 0.010708ms, p95 0.020375ms. After correction: p50 0.010916ms, p95 0.018500ms. This only checks the existing merge function, not total render/paint latency.
- Independent native walkthrough is recorded separately at its actual tested source SHA.

## Remaining live boundary

The new example uses internally synthetic people/events and a disposable test workspace. It does not prove that a real teammate's worker exports error/patch/verification reports, or that actual Flower cooperation discovers the fix. The existing canonical RunnerActivity schema does not yet carry the structured fix report; the live producer/permission contract remains open. Normal live instructions use the existing queue/worker, and the agent must still report its actual target diff/check results. This correction must not be counted as a live WF02/WF10 or full-scope completion.
