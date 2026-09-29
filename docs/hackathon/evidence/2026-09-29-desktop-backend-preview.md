# Native desktop and coordination backend preview

September 29, 2026. Tested source commit: `3147b79f2f480ddbc36b347056fcf53c3fab5081`, based on `b3aff02` from `origin/main`. This receipt covers a local preview, not a live awareness workflow.

## Native walkthrough

`bun run demo:desktop` started an isolated OpenCode server on `127.0.0.1:4468` and the Electron 42.3.3 desktop with renderer port 5185. The launcher created two real Session records in its temporary workspace, then used the registered `/api/coordination/v1` routes to share them as separate compact and expanded navigation experiments. It seeded individual Basic identities, four project members, comments, instructions, completed mock runs, and source-linked WorkCards. The project name and WorkCard text identify the mock execution as simulated.

In the native window, Alice connected to the external server URL already supplied by desktop startup. Project overview showed four people, two separate shared work items, completed runs, and inspectable reported results. The expanded thread mapped to Session `ses_f10b87952ffeliqG571klaNshC` and Thread `thr_7c318209-568b-4436-9c4f-79b52c5de657`; the compact thread mapped to Session `ses_f10b8795dffe7itOqtWjYXW7jP` and Thread `thr_55276b1a-049c-4276-8747-8c5065659db7`.

I submitted “Mock run: check native desktop action path” in the expanded thread. The desktop first showed it as queued, then displayed the mock response and completed run after the launcher's worker poll reserved it. Native source inspection opened response event `evt_0ef49a58f001pXG0JGSZ3hadSw` at sequence 26. The context panel correctly marked its earlier WorkCard as stale after this new activity.

## Checks at the tested source

Repository-pinned Bun 1.3.14; frozen dependency installation; no lockfile or dependency changes. The native main and preload bundles built during the Electron launch.

| Check | Result |
| --- | --- |
| App, desktop, server `bun typecheck` from each package | Passed |
| App `team-api.test.ts` and `team-state.test.ts` | 56 passed, 206 assertions |
| Server `coordination.integration.test.ts` | 1 passed, 51 assertions with mock runner |
| Desktop connection to registered backend | Connected and rendered project overview |
| Desktop instruction to mock runner | Queued, completed, source inspected |

The frontend fix probes the registered status route for the explicit `simulated: true` marker. The real server returns `{ready:true}` and can return an HTML app fallback for unknown routes; it no longer gets misread as a malformed simulation manifest. The simulated service still identifies itself explicitly.

This preview does not prove model execution, Flower cooperation, selected activity export, awareness admission into an active Session, or agent use of an awareness note. Both preview Sessions use one temporary workspace; the private control and topic relationships required by WF01 are absent. No G0–G7 gate or WF01–WF10 case closes from this receipt.

To reproduce, run `bun run demo:desktop` and use the temporary `member.json` path printed by the launcher to connect from **Project overview → Connect team**. The [preview guide](../../../hackathon/desktop-preview/README.md) describes the ports and server-only mode. Credentials and SQLite data stay in a new temporary directory for each run.
