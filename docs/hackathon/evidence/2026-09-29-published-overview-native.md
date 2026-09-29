# Published overview native handoff — September 29, 2026

## Actual result

**Basic native overview is ready for hands-on review, with explicitly synthetic data.** After the initial backend-unavailable observation, the coordinator authorized a new isolated OpenCode service. The existing waiting native window recovered without restarting. It now shows Project overview, four test members and two synthetic sessions. Compact opens its real API-backed test comment; QA returned to the overview and released input to Serdar. The separate WF01/WF02/WF03 scenario simulator and real Flower acceptance remain untested. See the recovery receipt below.

The earlier project-overview checkout ceased to be frozen when another owner changed its shared schema dependency. Its5177/9225 runtime hot-refreshed and lost its connection state; it was not handed to Serdar as a stable preview. After the turn interruption, fresh privileged process/port inspection found none of the previously recorded runtime PIDs/listeners, including backend4466. QA did not terminate them and does not infer why they stopped.

## Verified launch identity

| Field | Actual observation |
| --- | --- |
| Frozen checkout | `/Users/mac/Desktop/Coding/Hackathon/Puff/PuffCollaborative-publication` |
| HEAD before/after | `a5862425a1b2fde2f23a2e9960ab100447346541` |
| Source change status | Clean before launch; no diff in app, desktop, schema, protocol or core at final check |
| Native process | Electron PID `83693`, OpenCode Dev1.18.33 |
| Renderer process | PID `83592`, `http://127.0.0.1:5178/index.html` |
| Debugging / target | Port9226; `62034FF304C2B6F5FF4F45AEDEAF3CD9`, title OpenCode |
| Profile | `/tmp/puff-published-overview-preview`; absent before launch |
| Automation | Dedicated `puff-published-overview` session, selected exact existing target and enabled pinning |
| Native startup time | September29,14:45:51 PDT |
| External backend | `http://127.0.0.1:4466`; initially unavailable, then newly started with isolated synthetic storage as recorded below |

Ports5178/9226 were checked unused before starting exactly one new native instance. The main/preload development build succeeded. No shared backend or prior window was started, killed or restarted by QA.

Launch from the frozen checkout's `packages/desktop`:

```sh
OPENCODE_DESKTOP_SERVER_URL=http://127.0.0.1:4466 \
OPENCODE_DESKTOP_PROFILE=/tmp/puff-published-overview-preview \
OPENCODE_DESKTOP_RENDERER_PORT=5178 \
ELECTRON_EXEC_PATH=/Users/mac/Desktop/Coding/Hackathon/Puff/PuffCollaborative/packages/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
./node_modules/.bin/electron-vite dev --remoteDebuggingPort 9226
```

Missing, Git-ignored launch assets `packages/opencode/dist/node` and `packages/desktop/resources/icons` were copied without overwriting from the prepared main-integration checkout. Desktop source is unchanged between that checkpoint and this publication. The existing Electron executable was reused. This is an external-backend UI preview: the reused embedded-server artifact is not evidence of a newly built or verified published backend and is not started by this launch.

## Initial blocker and evidence — subsequently resolved

1. Confirm no listener on4466 and the earlier recorded PIDs are absent.
2. Request `http://127.0.0.1:4466/global/health` with a3-second timeout. Both checks returned curl exit7, `Failed to connect to 127.0.0.1 port 4466`, HTTP000.
3. Observe native target5178/9226. Its accessibility snapshot contains no interactive elements; the [inspected native screenshot](</Users/mac/.agent-browser/tmp/screenshots/screenshot-1790718424680.png>) visibly reports the unreachable backend and automatic retry.

The startup log's “server ready” line only acknowledges the configured external URL; the refused connection and visible window are the actual backend availability evidence. No credentials, Session prompts, fixture records, approvals or private data were changed. No fabricated renderer data was injected into this published preview.

This initial blocker was reported before the coordinator authorized starting a fresh service. The normal account path is **Project overview → Connect team → member account → select the project**. No credentials are included here. The subsequent actual connection and UI observations are recorded below.

## Authorized isolated backend recovery and connected observation

After the blocker receipt, the coordinator explicitly authorized a **new** default OpenCode development service on4466 if unused, with fresh synthetic storage, preserving `/tmp/puff-desktop-service` and every earlier service. The port was still free. QA read the repository's actual `ServeCommand`, coordination config and fixture adapters, then started the existing launcher from the same frozen publication checkout. No source code or framework was added.

The new backend is Bun PID`86723`, source `a5862425a1b2fde2f23a2e9960ab100447346541`, listening only on `127.0.0.1:4466`. Its new data root is `/tmp/puff-published-overview-service`; database, XDG data/config/cache/state and workspace are all under that root. The service directory did not exist before setup. A clean environment excludes inherited model credentials; pure mode disables external plugins, project config and model fetching are disabled. The prior `/tmp/puff-desktop-service` was not reused, copied or overwritten.

The normal launcher was:

```sh
env -i \
PATH=/Users/mac/Desktop/Coding/Hackathon/.tools/bun-1.3.14/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin \
TMPDIR=/tmp \
XDG_DATA_HOME=/tmp/puff-published-overview-service/data \
XDG_CONFIG_HOME=/tmp/puff-published-overview-service/config \
XDG_CACHE_HOME=/tmp/puff-published-overview-service/cache \
XDG_STATE_HOME=/tmp/puff-published-overview-service/state \
OPENCODE_DB=/tmp/puff-published-overview-service/opencode.sqlite \
OPENCODE_PURE=1 OPENCODE_DISABLE_MODELS_FETCH=1 OPENCODE_DISABLE_PROJECT_CONFIG=1 \
OPENCODE_COORDINATION_IDENTITIES_PATH=/tmp/puff-published-overview-service/identities.json \
OPENCODE_COORDINATION_ADMISSIONS_PATH=/tmp/puff-published-overview-service/admissions.json \
OPENCODE_COORDINATION_MOCK_RUNNER=1 \
OPENCODE_COORDINATION_MOCK_WORKER_ID=wrk_published_preview \
OPENCODE_COORDINATION_MOCK_INSTANCE_ID=published-preview \
/Users/mac/Desktop/Coding/Hackathon/.tools/bun-1.3.14/bin/bun run ./src/index.ts \
serve --hostname 127.0.0.1 --port 4466 --cors http://127.0.0.1:5178 --pure
```

Working directory: publication checkout `packages/opencode`. Actual `/global/health` returned `{"healthy":true,"version":"local"}`; actual `/project/current` for the new temporary workspace returned local project `global`. This is the application server, not a fabricated health endpoint. The version label `local` alone does not identify source; the exact cwd/SHA above does.

QA created four synthetic member accounts with randomly generated local passwords and hashed server identities. Credential files are local-only, mode0600; their contents are not in this receipt. Through **actual APIs**, QA created two empty coding Sessions, selected them into the new shared project, added the other three test members and added one explicitly synthetic human-authored comment per thread. No instructions, model prompts, agent tools, analysis jobs or approvals were submitted. Fixture IDs are retained in the local `fixture-receipt.json` under the new service root.

| Record | Actual identity |
| --- | --- |
| Project | `global`, displayed **Desktop preview · SIMULATED mock runner** |
| Members | `usr_preview_serdar`, `usr_preview_talha`, `usr_preview_serhat`, `usr_preview_ferit` |
| Compact Session / thread | `ses_f10d8e063ffeWo7pnGIuWOATbn` / `thr_ccb82a81-e3b0-42d4-bd1b-d1b484101e73` |
| Expanded Session / thread | `ses_f10d8e05effenbFRY5kwZfDh7S` / `thr_cc2a2a2e-1781-4b1e-8abb-0a548ed293e3` |
| Mock worker | `wrk_published_preview`; no run was requested |
| Compact comment inspected | `evt_0ef2720aa001xqXUW0PW55HbpC`, project sequence5 |

The same Electron PID83693/target recovered automatically after the backend started. QA opened Project overview, connected using the newly created local test member and observed:

- Visible **PROJECT WORK** rail and connected project selector with the SIMULATED project name.
- Overview counts **4 people and agents**, **2 project work**, **0 needs attention**; all four test member identities are present.
- Honest missing-data copy: No focus stated, No agent sessions attributed yet, No current report, No source-linked results reported yet. A thread creator is not presented as verified Session ownership.
- Clicking **Open SIMULATED native preview — compact navigation** opens the exact compact Session/thread with the synthetic comment, source event ID/sequence and an empty composer. No send occurred.
- Returning through **Project overview** restores the connected overview. [Final inspected native screenshot](</Users/mac/.agent-browser/tmp/screenshots/screenshot-1790718828513.png>) records the handoff state. No renderer fetch wrapper or response interception is installed in this published preview.

Visual limitation: the empty “No agent sessions attributed yet” text wraps into an unusually narrow column inside each person card in the screenshot. This pass confirms the usable entry and data rendering, not finished visual polish or full accessibility acceptance. No overview source-result peek could be exercised because no work card/source-backed result exists in these seed records; the comment's event reference does not substitute for that case.

### Concrete human walkthrough

1. In the native **OpenCode Dev** window, start on **Project overview** for **Desktop preview · SIMULATED mock runner**.
2. Scroll to **Project work** and choose **Open SIMULATED native preview — compact navigation**, or its matching PROJECT WORK sidebar link.
3. Read the labeled test comment and toggle **Team context** beside the conversation. The composer is empty; no prompt needs to be sent to inspect the view.
4. Choose **Project overview** in the sidebar, then open the **expanded navigation** entry to compare the two existing Sessions.

Only the compact open/return sequence was exercised by QA during this minimal pass. The expanded entry and its exact identity were rendered and selectable; additional walkthrough behavior is for the user's hands-on review. Kickoff persistence, owner-stated focus, relationship decisions, per-target approval modes, staged simulator scenarios and real admission/promotion/use remain unsupported or unverified here. This baseline service on4466 is separate from R5's forthcoming coordination simulator on4187; no attempt was made to substitute that simulator for the default OpenCode server.

## Simulator follow-up prepared, not executed

The newer WF01/WF02/WF03 simulated-demo request requires a separately handed-off frozen combined build and simulator. Do not apply it to this published checkpoint by assumption or resume the moving overview checkout. Keep these checks bounded:

| Case | Native sequence after the new handoff | Required observation |
| --- | --- | --- |
| S01 — Scenario entry | Open actual native Project overview; select each provided scenario. | Scenario name and persistent SIMULATED label stay visible after selection, navigation and source inspection. No browser substitute. |
| S02 — Alternatives/privacy | Select the WF01 example; open existing A and B, compare exact identities and deliberate relationship; inspect permitted project records. | A/B remain distinct alternatives; private P and its text are absent. No automatic winner, stopping, sharing or new Session. |
| S03 — Staged awareness | Select the WF02 example; advance only the simulator's documented controls through source finding, analysis, admission, promotion and use stages. | Every stage remains explicitly simulated and cites the same source/target chain. No simulated receipt is described as a real Flower run, provider turn or durable target use. |
| S04 — Overlap/no finding | Select the WF03 overlap case, then unrelated/no-finding. | Tentative overlap is distinguishable from deliberate alternatives and from no actionable finding. No fake required match or automatic redirection. |
| S05 — Exact source/access | Inspect a source from the active target; close by Escape. Exercise the supplied unavailable/forbidden example only within the simulator. | Exact source ID/revision shown; target draft/reading position retained; focus returns; denied/private data remains absent and prior source text does not leak. |
| S06 — Human handoff | Leave one understandable starting scenario in the clean native window. | Record actual source, service, profile, PID/ports and3–5 observed click steps; preserve SIMULATED labeling and explicitly release native input to Serdar. |

No simulator process was launched and no S01–S06 pass is claimed. Original WF02/WF10 real Flower/OpenCode acceptance remains a separate gate.

## Input release and scope

**QA relinquishes native input to Serdar for the currently open, connected published Project overview.** Native PID83693, renderer83592 and new isolated backend86723 remain running. No further autonomous clicks, navigation or polling of this UI will occur after handoff. A later simulator pass needs a new explicit frozen-build/service and input handoff. The frozen publication app/schema/protocol/core source remained unchanged in the final check.

This receipt is the only authored repository file for this published-preview pass. No source changes or Git mutations occurred. Automatic approval review rejected an attempted coordinator status message because trusted user evidence did not explicitly authorize messaging that destination. The message was not sent or retried; no message was sent to the chat whose user requested no further agent updates.
