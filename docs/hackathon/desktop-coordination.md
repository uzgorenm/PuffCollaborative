# Desktop access and integration coordination

Serdar authorized the coordinator chat, **Set up Flower development**, to direct the other project chats and publish the current verified changes to `main`. This publication supersedes the earlier instruction to postpone main integration. Preserve each development checkout and unfinished work.

## Resource ownership

**Current round:** [current development assignments](next-development.md) place the next UI in the isolated project-overview checkout and the combined backend in a separate candidate checkout. Main-integration stays frozen for native QA. Historical receipts keep their original source identities.

| Resource | Owner | Other agents can do |
| --- | --- | --- |
| Main integration Git, clean publication checkout and pushes | Coordinator | Supply exact ready commits and evidence; do not concurrently push main or edit the publication checkout |
| Next UI composition | Build Puff project overview and coordination, in its isolated overview checkout | Prior lead's source-inspection checkpoint is frozen at e332cbf539; preserve its fixes |
| Published context-panel files | Frozen for QA | No renewed implementation ownership; propose changes to the overview owner |
| Shared desktop mouse, keyboard and focus | Native QA after the frontend lead's release | Inspect source and existing captures; no native interaction |
| Native acceptance | Summarize current team work | Continue independent source/tests; do not touch its target window |
| Consumer integration test | Complete R1 collaborative review | Use own fixture identities/request IDs; do not mutate another test's sessions |
| R2–R6 review outputs | Each named role owns `reviews/r2.md` through `reviews/r6.md` | Read completed reports; no duplicate implementation or desktop access |

This is a coordination protocol, not an operating-system lock. The coordinator is the only writer of the active access record below. A message saying someone is done does not by itself transfer input control.

## Active access record

- **Interactive desktop owner:** `Summarize current team work`. The source-inspection instance is running from frozen `PuffCollaborative-main-integration` source `e332cbf539` / docs `d1ec774099`, Electron PID `73232`, renderer PID `73221`, ports 5176/9224, profile `/tmp/puff-next-ui-qa`, target `6FC3B81265B3233AD1FB3B675A58BECB`. QA's receipt owns detailed observations. Do not hot-reload this instance with main's later ownership-label fix.
- **Next handoff:** Serdar wants a hands-on overview preview. QA finishes its current bounded pass and restores its own renderer-local fixture interception, then may launch one separate overview instance only after the owner supplies a stable verified source commit. Planned profile `/tmp/puff-project-overview-preview` and ports 5177/9225 require availability checks. These planned values do not establish a running preview. QA records the actual target and explicitly releases native input to Serdar; after release all agents stop autonomous native interaction.
- **Other chats:** including the overview checker, remain source/tests-only. No competing clicks, profile mutation or desktop/server restart.
- **Current UI checkout:** `PuffCollaborative-serdar-ui`; integration uses a separate `PuffCollaborative-main-integration` checkout. The original checkout remains untouched.
- **Known development backend:** `127.0.0.1:4466`, explicitly synthetic/mock fixture. Treat the source/runtime identity from the latest lead handoff as authoritative; never publish credentials here.
- **Native evidence boundary:** current source-inspection checks use synthetic/mock data. A separate overview preview does not establish persisted kickoff/preferences, trusted sharing, Flower delivery or actual target use.
- **Prior QA target, preserve untouched:** profile `/tmp/puff-serdar-ui-desktop`, renderer 5175, debugging 9223, latest source `65767b5f31` on `serdar/ui`. This older window does not verify the new integration source.
- **Original interim instance:** renderer 5173/debugging 9222 remains separate and preserved; do not confuse it with the final QA target. Separate windows are not permission for concurrent OS input.
- **Independent review work:** source, scoped unit tests and existing evidence can proceed now. No reviewer waits for desktop access to finish its source artifact.

## Handoff procedure

1. Current owner finishes its interaction, records the target checkout/build, window/profile, renderer/debugging ports and any draft or fixture changes, then explicitly releases control.
2. Coordinator assigns the next owner and updates this record. The receiving agent verifies the exact target before any action.
3. While waiting, run source checks or prepare cases. Do not poll aggressively, click to discover ownership, or ask Serdar to repeat the same handoff.
4. No agent restarts another task's app/server, changes shared settings, cancels another run, or edits a shared fixture. Use independent fixture records for HTTP tests.
5. Separate windows do **not** isolate system mouse/keyboard input. Even with separate Electron profiles and renderer/debugging ports, native input has one owner. Targeted automation may run in parallel only on explicitly isolated instances and data, without changing OS focus.

## Publication sequence

Publish the startup repair after its regression passes, then integrate the coherent UI checkpoint and run checks on the combined source. Use normal fast-forward pushes; if a teammate advances main, fetch and integrate their changes before retrying. Do not force-push, reset active checkouts, or create PRs. A startup repair or mock desktop check does not close live Flower/OpenCode awareness gates.
