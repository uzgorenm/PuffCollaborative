# Desktop access and integration coordination

Serdar authorized the coordinator chat, **Set up Flower development**, to direct the other project chats and publish the current verified changes to `main`. This publication supersedes the earlier instruction to postpone main integration. Preserve each development checkout and unfinished work.

## Resource ownership

**Next round:** [current development assignments](next-development.md) give new implementation work the main-integration checkout. The native QA checkout stays frozen, preventing hot reload from interrupting QA. This supersedes the earlier UI-checkout write ownership for new tasks; historical receipts keep their original source identities.

| Resource | Owner | Other agents can do |
| --- | --- | --- |
| Main integration Git, clean publication checkout and pushes | Coordinator | Supply exact ready commits and evidence; do not concurrently push main or edit the publication checkout |
| Next UI composition | Review README for task workflow, with coordinator-only Git writes | Edit only the files assigned in next-development.md |
| Context-panel files | Read the project README | Suggest changes through R2/R3 reports; do not edit the same files |
| Shared desktop mouse, keyboard and focus | Native QA after the frontend lead's release | Inspect source and existing captures; no native interaction |
| Native acceptance | Summarize current team work | Continue independent source/tests; do not touch its target window |
| Consumer integration test | Complete R1 collaborative review | Use own fixture identities/request IDs; do not mutate another test's sessions |
| R2–R6 review outputs | Each named role owns `reviews/r2.md` through `reviews/r6.md` | Read completed reports; no duplicate implementation or desktop access |

This is a coordination protocol, not an operating-system lock. The coordinator is the only writer of the active access record below. A message saying someone is done does not by itself transfer input control.

## Active access record

- **Interactive desktop owner:** unassigned. Native QA explicitly released CDP9223; the frontend lead then completed polling-focus fix `65767b5f31` on `serdar/ui` and explicitly released native input. Its next assignment is source-only in the integration checkout.
- **Next owner:** unassigned. All chats remain source-only until the coordinator assigns the next native pass.
- **Current UI checkout:** `PuffCollaborative-serdar-ui`; integration uses a separate `PuffCollaborative-main-integration` checkout. The original checkout remains untouched.
- **Known development backend:** `127.0.0.1:4466`, explicitly synthetic/mock fixture. Treat the source/runtime identity from the latest lead handoff as authoritative; never publish credentials here.
- **Final QA target:** profile `/tmp/puff-serdar-ui-desktop`, renderer port 5175, debugging port 9223, source checkpoint `f4c8ad9ee4` on `serdar/ui`. Verify instance identity before any action. This already-running window is not a freshly launched main-integration build.
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
