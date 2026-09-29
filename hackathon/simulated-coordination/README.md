# Puff coordination scenario simulator

This is a **SIMULATED**, loopback-only HTTP service for native desktop review of the documented WF01–WF03 scenarios. It does not call Flower, OpenCode, a model, or the real coordination server. It is not an OpenCode default backend; the native app still needs its separate default OpenCode dev service to render.

## Fixed local contract

Origin: `http://127.0.0.1:4187`. Basic demo accounts: `alice/demo-alice`, `bob/demo-bob`, `cara/demo-cara`, `drew/demo-drew`. These public synthetic passwords are only for this loopback fixture. Connect the desktop coordination view as Alice to see all three projects. The simulator sends permissive CORS headers for an Electron renderer, but binds only `127.0.0.1`. It does not forward any request to the real service on port 4466.

Existing `createTeamApi` read routes under `/api/coordination/v1`:

- `GET /projects` → array of schema-valid `SharedProject` records: `sim-wf01`, `sim-wf02`, `sim-wf03`.
- `GET /projects/:projectId` → `{project,members}` with four synthetic members in WF01/WF02.
- `GET /projects/:projectId/work-cards` → array of `WorkCard` records for the project.
- `GET /projects/:projectId/threads` → array of `Thread` records.
- `GET /threads/:threadId` → `{thread,instructions,runs,approvals:[],workCard,cursor}`. WF02 B has one explicitly synthetic running instruction/Run before A's finding; other snapshots have empty instruction/Run arrays.
- `GET /threads/:threadId/events?after=N&limit=N` and `GET /projects/:projectId/events?after=N&limit=N` → `{events,cursor,hasMore}`. Project event `seq` is unique within each project; source references resolve through this route.
- `GET /threads/:threadId/comments` → empty array. Production write routes are not implemented; demo controls below drive only in-memory synthetic state.

Demo-only routes under the same prefix:

- `GET /status` → `{ready:true,simulated:true,mode:"synthetic",label:"SIMULATED"}`.
- `GET /simulation` → manifest `{simulated:true,mode:"synthetic",label:"SIMULATED",selectedScenarioId:"wf01"|"wf02"|"wf03",scenarios:[...],actors:[...],wf02:{stage:0|1|2|3,phase:"source"|"admitted"|"promoted"|"used",sourceRef:{threadId,eventId,seq},targetThreadId,milestones:[...]}}`. Each scenario has `id`, `projectId`, `title`, `classification`, `summary`, and `threadIds`; WF03 adds `comparisons` for the likely NAV-900 overlap and unrelated migration/UI navigation pair.
- Authorized WF03 members also receive `taskStart`, a **demo-only** named completed-work item and two remaining-task suggestions. The completed item names its exact `sourceRef` (`wf03-db-complete@seq8`), reporting actor Cara, session, outcome, and exact accepted match phrases. Each suggestion cites the same result event that explicitly names its unfinished check. Bob receives no WF03 task-start data. This manifest is a read-only fixture, not a general duplicate detector or an agent scheduler.
- `POST /simulation/select` with `{"scenarioId":"wf01"|"wf02"|"wf03"}` → updated manifest. The desktop can also select the corresponding project using its existing project selector.
- `POST /simulation/wf02/advance` → updated manifest, advancing exactly one phase until `used`.
- `POST /simulation/reset` → original manifest and event/card state. Restarting the process also reseeds.

All simulation endpoints except `/status` require one of the four demo Basic accounts. Only Alice can change the demo stage or reset/select globally. Unauthorized and out-of-project reads fail closed. Alice, Cara, and Drew see all three projects; Bob sees WF01/WF02. The manifest filters its scenarios to the caller's project memberships. Responses have explicit `SIMULATED` project names and milestone text. No private P event or marker is returned.

WF01 keeps compact A and expanded B as deliberate alternatives, both ongoing; a synthetic unshared private P exists only inside the fixture. WF02 starts with B's schema-valid synthetic Run already `running` under the same owner as A, and B's saved expanded-navigation plan lacks A's later `NAV-742` finding. A's exact source event is `wf02-A-find@seq4`; successive control calls add separately labeled **simulated admitted**, **simulated promoted**, and **simulated used** evidence to B. B's WorkCard cites its own milestone event, while the manifest and event payload carry A's exact source reference. These are canned fixture states, not proof that a real B agent read or used Flower output. WF03 places an unspecified same-topic NAV-900 pair and a separate different-topic database/UI navigation pair in one project; the latter has no cross-session finding. Cara also reports the migration navigation map complete in an exact synthetic result event; link checks and keyboard access remain unfinished. This extra completed item supports the before-start demo without changing the unrelated-pair classification.

## Run and reset

From this directory, run `./run.sh` (defaults to port 4187; set `PUFF_SIM_PORT` to another unused loopback port). The process keeps state only in memory; stop and rerun to reseed, or run `./reset.sh` while it is running. Run the HTTP contract tests with `./test.sh`. The Bun scripts use the repo-pinned Bun 1.3.14 executable if it is not on `PATH`; no package installation is required.
