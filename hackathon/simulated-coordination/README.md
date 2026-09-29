# Puff coordination scenario simulator

This is a **SIMULATED**, loopback-only HTTP service for native desktop review of the documented WF01–WF04 scenarios. It does not call Flower, OpenCode, a model, or the real coordination server. It is not an OpenCode default backend; the native app still needs its separate default OpenCode dev service to render. WF04 is the default scenario and uses a normal project name so the native project, thread, event, and instruction views can present the story. No simulated review screen is added here.

## Fixed local contract

Origin: `http://127.0.0.1:4187`. Basic demo accounts: `alice/demo-alice`, `alya/demo-alya`, `bob/demo-bob`, `cara/demo-cara`, `drew/demo-drew`. These public synthetic passwords are only for this loopback fixture. Connect the desktop coordination view as Alice to see all four projects. The simulator sends permissive CORS headers for an Electron renderer, but binds only `127.0.0.1`. It does not forward any request to the real service on port 4466.

Existing `createTeamApi` read routes under `/api/coordination/v1`:

- `GET /projects` → array of schema-valid `SharedProject` records: `sim-wf04`, `sim-wf01`, `sim-wf02`, `sim-wf03`.
- `GET /projects/:projectId` → `{project,members}` with four synthetic members in WF01/WF02.
- `GET /projects/:projectId/work-cards` → array of `WorkCard` records for the project.
- `GET /projects/:projectId/threads` → array of `Thread` records.
- `GET /threads/:threadId` → `{thread,instructions,runs,approvals:[],workCard,cursor}`. WF02 B has one explicitly synthetic running instruction/Run before A's finding. WF04 Alice gets a completed or failed instruction/Run after an accepted Apply; other snapshots have empty arrays.
- `GET /threads/:threadId/events?after=N&limit=N` and `GET /projects/:projectId/events?after=N&limit=N` → `{events,cursor,hasMore}`. Project event `seq` is unique within each project; source references resolve through this route.
- `GET /threads/:threadId/comments` → empty array.
- `POST /threads/wf04-alice/instructions` → accepts the exact approved WF04 instruction with a unique `requestId`. The native `createTeamApi.submit` body `{requestId,text}` is sufficient; `sourceRef` and `targetErrorRef` may also be supplied and must match the manifest exactly. The text contains both exact event IDs. Alice must be a member of `sim-wf04`, the cited Alya WorkCard and source event must still be current and verified, and Alice's target error must match. An exact retry returns the same `{instruction,run}`; a changed retry or second Apply conflicts. Wrong actor, unrelated target, fabricated reference, and stale evidence are rejected before any test runs. Other production write routes remain disabled.

Demo-only routes under the same prefix:

- `GET /status` → `{ready:true,simulated:true,mode:"synthetic",label:"SIMULATED"}`.
- `GET /simulation` → manifest `{simulated:true,mode:"synthetic",label:"SIMULATED",selectedScenarioId:"wf04"|"wf01"|"wf02"|"wf03",scenarios:[...],actors:[...],capabilities:{fixReuse:boolean},fixReuse?:{projectId,targetThreadId,sourceRef,targetErrorRef,error,approvedInstructionText},wf02:{...}}`. Each scenario has `id`, `projectId`, `title`, `classification`, `summary`, and `threadIds`; WF03 adds `comparisons` for the likely NAV-900 overlap and unrelated migration/UI navigation pair. Only WF04 members receive `fixReuse`.
- Authorized WF03 members also receive `taskStart`, a **demo-only** named completed-work item and two remaining-task suggestions. The completed item names its exact `sourceRef` (`wf03-db-complete@seq8`), reporting actor Cara, session, outcome, and exact accepted match phrases. Each suggestion cites the same result event that explicitly names its unfinished check. Bob receives no WF03 task-start data. This manifest is a read-only fixture, not a general duplicate detector or an agent scheduler.
- `POST /simulation/select` with `{"scenarioId":"wf04"|"wf01"|"wf02"|"wf03"}` → updated manifest. The desktop can also select the corresponding project using its existing project selector.
- `POST /simulation/wf02/advance` → updated manifest, advancing exactly one phase until `used`.
- `POST /simulation/reset` → original manifest and event/card state. Restarting the process also reseeds.

All simulation endpoints except `/status` require one of the five demo Basic accounts. Only Alice can change the demo stage or reset/select globally. Unauthorized and out-of-project reads fail closed. Alice sees all four projects; Alya sees WF04; Cara and Drew see WF01–WF03; Bob sees WF01/WF02. The manifest filters its scenarios to the caller's project memberships. WF01–WF03 retain explicit `SIMULATED` project names and milestone text. No private P event or marker is returned.

WF01 keeps compact A and expanded B as deliberate alternatives, both ongoing; a synthetic unshared private P exists only inside the fixture. WF02 starts with B's schema-valid synthetic Run already `running` under the same owner as A, and B's saved expanded-navigation plan lacks A's later `NAV-742` finding. A's exact source event is `wf02-A-find@seq4`; successive control calls add separately labeled **simulated admitted**, **simulated promoted**, and **simulated used** evidence to B. B's WorkCard cites its own milestone event, while the manifest and event payload carry A's exact source reference. These are canned fixture states, not proof that a real B agent read or used Flower output. WF03 places an unspecified same-topic NAV-900 pair and a separate different-topic database/UI navigation pair in one project; the latter has no cross-session finding. Cara also reports the migration navigation map complete in an exact synthetic result event; link checks and keyboard access remain unfinished. This extra completed item supports the before-start demo without changing the unrelated-pair classification.

WF04 has Alice's `ProjectList` `run.failed` event `wf04-alice-error@seq4`, Alya's completed WorkCard citing `wf04-alya-fix@seq5`, and an unrelated authentication timeout with no fix suggestion. Alya's source `run.output.payload.fix` contains the exact error, summary, one-line patch, and synthetic prior verification receipt required for this scenario. On approved Apply, the server creates a disposable workspace under the operating system temp directory, writes only the flawed `project-list.ts` and its focused test, runs `bun test project-list.test.ts`, applies the exact patch to that file, runs the same test again using a fixed argument array, and deletes the workspace. It emits `instruction.submitted`, `run.started`, `run.diff`, `run.tool`, then `run.completed` only if the actual post-patch test exits zero; otherwise it emits `run.failed`. The target WorkCard becomes done only after that pass. The server logs the temporary receipt path and exit codes for developers; normal API responses contain the actual test output with the temporary path redacted.

The app checkout at this checkpoint still limits `SimulationManifest` to WF01–WF03. Its manifest decoder must be updated by the app owner before this new default WF04 manifest will load in the native overview. The coordination read and submit routes are otherwise shaped for `createTeamApi`.

## Run and reset

From this directory, run `./run.sh` (defaults to port 4187; set `PUFF_SIM_PORT` to another unused loopback port). The process keeps state only in memory; stop and rerun to reseed, or run `./reset.sh` while it is running. Run the HTTP contract tests with `./test.sh`. The Bun scripts use the repo-pinned Bun 1.3.14 executable if it is not on `PATH`; no package installation is required.
