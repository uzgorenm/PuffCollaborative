# Serdar native desktop QA — Agent 3

## Current result

**The intended-checkout Electron renderer was independently retested. QA-N02's hidden Send control is fixed at the tested 760×800 renderer viewport. Local/shared draft continuity, exact local context switching, static inline patch retention and a bounded keyboard check worked. No complete D01–D06 or live Flower/OpenCode acceptance is claimed.**

The initial startup-error observation is preserved below as QA-N01. During the resumed pass, the native OpenCode window displayed the shared conversation `Compact navigation`, its composer, and Team context. The visible project is explicitly labeled `Desktop integration · mock runner`; the panel truthfully says no generated context is available. The initial error screen was absent from that observation, but QA has not verified the startup fix, exact running build, or a launch from the assigned checkout.

QA initially remained read-only while other agents used the app. Agent 1 then explicitly released the original Electron window and promised not to interact during the pass. Only after that release did QA exercise existing local/shared sessions, unsent drafts, panel/sidebar toggles, keyboard focus and one reversible native resize. The window and drafts were restored. No prompt was sent, no Session was created, no process was restarted, and no OS preference or application code was changed. Final target-build, populated-history/tool/diff, reduced-motion and failure-state checks remain pending.

The first intended-build attempt could not distinguish the two Electron instances through CUA. That access problem was subsequently resolved using the repository-required `agent-browser` CLI and a dedicated connection to the explicitly released CDP9223 target. Final bounded results, screenshots, source identities, cleanup and visual assessment appear in the last section. QA returned input control to the lead after the pass. The running UI-branch instance was not restarted on integrated `main`.

This receipt contains native read-only observations, source inspection, and reproducible procedures. It is not evidence of a working Flower/OpenCode collaboration flow. The earlier `/puff` browser prototype is not the desktop acceptance surface.

## Initial scope and source receipt

| Field | Observed value |
| --- | --- |
| Review date | September 29, 2026; environment timestamp `2026-09-29T19:57:08Z` (12:57 pm PDT), during this observation pass |
| Assigned checkout | `/Users/mac/Desktop/Coding/Hackathon/Puff/PuffCollaborative-serdar-ui` |
| Branch | `serdar/ui` |
| Inspected HEAD | `f715b3e3594dfc92a95c698ee274b0e4f6a8b639` |
| Local-change status before this receipt | `git status --short` returned no entries |
| OS | macOS 27.0, build `26A428` |
| Running native application | Electron, bundle ID `com.github.Electron`; window title `OpenCode` |
| Displayed application version | `1.18.33`; this does not identify the source commit of the running bundle |
| Native renderer location | Accessibility tree reports `localhost:5173/index.html` |
| Running bundle source clue | Stack path under `/Users/mac/Desktop/Coding/Hackathon/Puff/PuffCollaborative/packages/desktop/out/main/chunks/` |
| Exact running build SHA / launch command | Unknown; requested from Agent 1, not inferred from the QA checkout HEAD |
| Backend identity/readiness | Local-server startup failed; backend address, instance and Session mappings not established |
| Native interaction | App inventory, accessibility-tree read and screenshot only; no clicks, typing, navigation, resizing or preference changes |
| QA writes | This file only; no application edits, process starts/restarts, Git mutations, dependency installs or session creation |

Read: root `AGENTS.md`; `packages/app/AGENTS.md`; `packages/desktop/AGENTS.md`; `serdar-agent-prompts.md` common instructions, Agent 3 and D01–D06; `mvp-spec.md`; `acceptance-workflows.md`; `integration-gates.md`; and the branch-setup receipt. Newer separate-branch instructions supersede historical main-only prose. Only Agent 1 writes Git state.

## Reproducible finding

### QA-N01 — Native startup blocks the desktop acceptance surface

- **Priority:** P1 acceptance blocker.
- **Historical status:** Observed during the initial pass. The resumed passive observation below shows a conversation instead of this error screen. Fix verification and target-checkout launch acceptance remain pending; do not report this error as still visible.
- **Observed surface:** Already-running Electron/OpenCode window, not a browser tab. No launch was attempted by QA.
- **Reproduction:** With the existing window left in its current state, use native app inventory to confirm `com.github.Electron` is running; inspect that app's accessibility tree and screenshot without selecting Restart.
- **Expected:** A native window from the assigned checkout opens an existing coding Session with composer, messages, tools and diffs, with its backend and source identity known.
- **Actual:** The heading is `Something went wrong`; the description is `An error occurred while starting the local server.` The only available surface is the startup error page, with Restart, Export Logs, Report Error and update controls. No conversation is available.
- **Exact visible diagnostic:**

```text
Error: Service not found: @opencode/CoordinationRuntime (defined at file:///Users/mac/Desktop/Coding/Hackathon/Puff/PuffCollaborative/packages/desktop/out/main/chunks/node-DjSdR9NK.js:695563:75)
```

- **Evidence:** Native CUA accessibility result in chat `Summarize current team work`, followed by a native screenshot showing the same error and version `1.18.33`. Both observations are preserved in the chat's tool history; no separate screenshot file was created outside the assigned write area.
- **Interpretation limit:** This is an observed startup error, not a diagnosed root cause. The stack identifies an original-checkout bundle path; it does not establish which source SHA produced it or whether the assigned checkout reproduces the error. Do not label it a new regression introduced by the current UI work.
- **Owner:** Agent 1 and its existing startup/server-wiring helper. Serhat is the escalation owner if the missing service requires backend composition changes. Agent 3 must not repair or restart it.
- **Retest:** Agent 1 supplies the intended launch command/build identity and an idle working native window from the assigned checkout. Repeat D01, then D02–D06. Preserve this initial observation when appending the new result.

The startup error is explicit and does not show simulated successful collaboration. That narrow observation does **not** pass D06's in-conversation offline/unsupported-operation cases.

## Coordination and prerequisites

Agent 1 was contacted through `Review README for task workflow` for an idle-window handoff. QA supplied the visible diagnostic and original-checkout path. No request was made to restart the app or create a duplicate server. At preparation time there was no completed handoff.

Before interactive checks, record:

- Agent 1's idle-window release, native title/window identity, intended checkout, source SHA and any uncommitted application changes; renderer/build identity and backend origin/worker instance, without credentials.
- Existing A and B Sessions: exact server/worker, project, Session and workspace identifiers; same owner, shared topic, compact versus expanded approach. Use existing Sessions, never create duplicates to make switching appear to work.
- Current tab/sidebar selection, native window dimensions, original composer text/caret, message scroll anchor, open tool/diff state and OS Reduce motion setting. Preserve existing drafts; if an owned draft cannot be safely restored, wait for a disposable existing Session.
- An existing source-backed finding and the evidence stages actually available. Label synthetic panel inputs explicitly. A native renderer containing synthetic context proves rendering only.
- Existing unrelated/private and unknown/offline examples supplied by their owners if available. Missing fixtures leave the corresponding subcase untested; QA does not manufacture live records or change sharing permissions.

Do not execute WF02/WF10's fresh-session creation, agent prompts, worker stopping, or WF09's hub restart as part of this assignment. Those broader workflow instructions do not override the desktop QA limits.

## D01–D06 execution ledger

| Check | Status now | What is established / missing |
| --- | --- | --- |
| D01 — Native launch | INTENDED RUNNING RENDERER VERIFIED; LAUNCH SCOPE LIMITED | Explicitly released Electron target/CDP9223 reports renderer5175 and existing local session routes on backend4466. Source checkpoint/hashes recorded below. No fresh launch, packaged app, or integrated-main runtime check. |
| D02 — Existing sessions | PARTIAL OBSERVED SUCCESS — TARGET FIXTURE | Target local A/B retained the lead's distinct drafts. Shared A marker survived A/B/A while B stayed empty; marker cleared. No Session-create action. Long-history anchors/backend count audit and same-owner shared alternative case remain untested. |
| D03 — Stable panel | PARTIAL OBSERVED SUCCESS — TARGET FIXTURE | Draft and expanded synthetic inline patch survived panel/navigation checks; original review pane opened/closed. Its workspace has no tracked changes. No real tool execution, populated review-hunk retention or mount trace independently tested. |
| D04 — Correct context | PARTIAL OBSERVED SUCCESS — TARGET FIXTURE | Local A/B panel shows exact corresponding Session ID/worker/instruction after loading, and drafts remain distinct. Source now has event-anchor links; no real work-card citation/receipt fixture was available to exercise them. |
| D05 — Usable motion | QA-N02 FIX VERIFIED AT TESTED RENDERER WIDTH; GATE PARTIAL | At 760×800 actual Electron renderer, local/shared keyboard-focused Send remains exposed above stacked context. Continuous panel Escape returns focus to toggle. OS minimum-size, reduced motion, sustained focus during refresh and measured animation quality remain unverified. |
| D06 — Honest failures | LIMITED OBSERVATION; NOT ACCEPTED | Target visibly labels mock/static data, waiting summaries, unspecified relationship and unevidenced admission/promotion/use. No offline/private/stale/unsupported failure was induced. |

### D01 — Native launch and identity

1. Receive Agent 1's idle-window handoff. Record the exact command/build supplied by the lead; QA does not launch or restart it.
2. Observe the actual native window and displayed version. Confirm the served renderer and backend correspond to the intended checkout and source revision; a localhost URL or version string alone is insufficient.
3. Open one already-existing Session through normal native navigation once the window is released. Verify its exact identity and the presence of composer, history, tool output and diffs.
4. Record loading/error states and the actual backend identity. Do not enter credentials in the receipt.

**Expected:** Working native conversation from the intended build, with confirmed backend/session mapping. A browser preview on 4444/4445, an Electron error page or an unidentified bundle cannot pass.

**Evidence:** Build/command handoff, native screenshot/AX observation, Session/worker mapping and safe backend-readiness receipt. Current actual: initial QA-N01, passive conversation observation, then lead-identified original-window checks below. No intended-checkout launch acceptance.

### D02 — Existing A/B navigation, drafts and history

1. Record existing A/B IDs and visible session count. Open A, record its draft/caret and a stable older message anchor. Use unsent marker `DESKTOP-QA-A-20260929` only in a released existing Session; never press Send.
2. Open context, switch to existing B through the session navigation, and verify B's identity. If permitted, use distinct unsent marker `DESKTOP-QA-B-20260929`; record B's independent scroll anchor.
3. Return to A. Verify A's exact draft, its expected focus/caret state, history and anchor. Return to B and verify its distinct state. Repeat A/B/A three times.
4. Include both normal switches and a rapid A/B/A switch before async context results finish. Check tab/sidebar selection against actual Session identity, rather than title alone.
5. Compare identities and Session count before/after; ordinary navigation must not create Sessions, send prompts or start a second run. Restore any QA-only draft edits to their original state.

**Expected:** Two preserved Sessions and independent drafts/history; no text or context leaks; no unexplained jump to the bottom. After resize, judge the same logical message anchor rather than demanding identical pixels.

**Evidence:** Before/after IDs, draft marker/original-text comparison, message anchors and native captures. Backend/session-list evidence is needed to prove no duplicate creation; UI count alone is supplementary. Current actual: original-window draft/navigation subcases below; history/anchor/backend count cases not run.

### D03 — Panel open/close without disturbing coding

1. In A, keep the unsent draft and older-message anchor. Expand an existing tool result and open an existing diff; record selected file/hunk and diff scroll.
2. Open and close context five times using the visible toggle, then repeat using the supported keyboard control. Record composer focus/caret and message/diff anchors after each cycle.
3. Focus a control inside the panel and close it using the supported dismissal mechanism. Verify focus returns to a visible sensible control, not a detached node or page body. Closing through the toolbar may appropriately focus that toolbar button.
4. Repeat while B is already active only if the lead has handed off that condition. QA does not start agent work just to manufacture activity.

**Expected:** Draft, message history, tool expansion, diff selection and scroll survive; no blank/flickering chat frame, accidental send, reload or extra runner. Hidden panel controls leave the tab order.

**Evidence:** Native before/after observations plus existing lifecycle/session traces if available. State preservation alone cannot prove absence of a transient chat remount; record mount stability as unknown unless a supplied trace supports it. Current actual: draft/disclosure/toggle-focus subcases below; tools/diffs/scroll/mount trace untested.

### D04 — Exact active-session context and evidence

1. In A, compare panel owner, worker, Session, topic and approach with the actual active conversation. Inspect one finding's source and destination.
2. Switch to B, then rapidly A/B/A. Test with an already-available delayed response supplied by the lead; no synthetic response is labeled live. Check that late A data never appears as B's current context.
3. Exercise available missing-identity, unrelated/private, stale-source and offline examples without creating or granting access to new records. Unknown identity must show an honest empty/unavailable state; stale evidence must not appear current.
4. Follow one source link and confirm the exact expected worker/Session/event. Missing route metadata must not silently open the viewer's localhost or another Session with a similar title.
5. Inspect each delivery claim against its receipt: acknowledgment, durable admission, promotion and observed use remain distinct. An app/server response, run ID or tool approval cannot establish use.

**Expected:** Correct current target after every switch; both alternatives retain their identity; no unrelated/private content; unsupported later evidence stages remain unknown. No automatic winning approach or work redirection.

**Evidence:** Source/destination IDs and revision, panel/active-conversation comparison, real receipt references where present. Synthetic context is a separate rendering result; real Flower/OpenCode use requires WF02/WF10. Current actual: ordinary A/B identity and queued-content switches observed below; finding/receipt cases unavailable.

### D05 — Keyboard, focus, resizing and reduced motion

1. Record starting native window size. Reach session navigation, the context toggle, panel disclosures, source actions and composer by keyboard; exercise Enter/Space where applicable and the documented dismissal shortcut. Verify visible focus throughout, logical forward/reverse tab order and no trapped or hidden focus.
2. Resize the released native window through approximately 1440×900, 1024×768 and its actual supported minimum, then restore the starting size. These are target sizes, not claimed observations. Record actual sizes if the window clamps them.
3. At each size, open/close context and change A/B. Verify readable content, reachable close/action controls, usable composer, independent panel/chat scrolling and no persistent clipped or overlapping controls.
4. Coordinate a native macOS Reduce motion test with the idle-window owner; record the original OS preference, test enabled behavior and restore the original setting. Do not substitute browser-only media emulation for native evidence. If the setting cannot be changed in the shared environment, leave this subcase blocked.
5. Compare normal and reduced-motion transitions. Repeated toggles/resizes must settle correctly; reduced motion should remove or substantially reduce nonessential movement without hiding state changes. Record any repeated flicker/jump with the exact action sequence.

**Expected:** No keyboard trap, invisible focused control, persistent clipping or lost draft/anchor; functional final states with reduced motion. No broad claim of smoothness from a still screenshot alone.

**Evidence:** Native keyboard sequence, before/after focus targets, actual dimensions and motion observation/recording with preference state. Current actual: keyboard and reversible native resize exposed QA-N02 below; OS Reduce Motion was not changed.

### D06 — Honest unavailable/offline/unsupported behavior

1. Use an existing unavailable/offline condition or one supplied by the lead. Do not stop or restart an app, backend or worker to induce it.
2. Open context for the affected Session and inspect status, timestamps, retained cached data and available actions. Attempt only reversible read/context-inspection actions in the released test environment; do not approve or submit real work.
3. Inspect available unsupported-operation, missing-identity and unresolved-run cases. Check that failed requests keep a truthful error/unavailable state and cannot silently fall back to successful preview data.
4. If the owner restores the connection during the handoff, observe refresh and current target identity without initiating restarts. Verify drafts and local conversation navigation remain usable where the product promises degraded operation.

**Expected:** Explicit failure/unknown state, stale data distinguished from current data, safe disabled controls and no fabricated delivery/use. Synthetic mode stays visibly labeled. A created run or request acknowledgment is not completion.

**Evidence:** Native error state, safe response/status evidence supplied by the backend owner, before/after target and draft identity. Current actual: initial QA-N01 and later truthful mock/empty-context labels; offline and unsupported-operation cases are not run.

## Initial source-only preparation notes — target at f715b3e

- `packages/desktop/src/renderer/index.tsx` imports and mounts `AppInterface`; inspected lines 382–420 construct server choices and mount the shared app. The retained app package is therefore relevant to desktop checks.
- `packages/app/src/context/prompt.tsx`, inspected lines 79–137, selects draft/session scope and caches prompt state. This identifies the D02 regression surface, not proof of native draft preservation.
- `packages/app/src/context/layout.tsx`, inspected lines 393–432, persists per-session scroll with a 250 ms debounce and flushes on page visibility/unload. D02 includes rapid switches so debounced state is exercised; code presence alone is not a pass.
- `packages/app/src/pages/session.tsx` binds target-server/session providers and existing timeline/scroll behavior. D03 must preserve those paths while the host panel is added.
- At the inspected clean target snapshot, `packages/app/src/components/puff/` contains the earlier dashboard components, with no `context-panel/` directory. This does not prove Agent 1/2 have no unpublished work elsewhere. Native panel handoff and motion wiring remain unverified.
- Reduced-motion selectors in existing UI components do not establish reduced-motion support for the new panel host. Inspect the actual host after Agent 1 integrates it, then execute D05.

## Known baseline issue, separate from this review

The [branch-setup receipt](2026-09-29-serdar-branch-setup.md) reports the pre-existing unit failure `desktop native locale detection > uses Unicode likely subtags for script-sensitive bundles`: `pa-PK` expected `pa`, received `en`. Source `packages/app/src/i18n/desktop-native.test.ts:120–123` still contains that expectation. QA did not rerun it, alter locales, or classify it as a new panel/session regression. No build, unit, browser or benchmark pass is claimed here; benchmark ownership remains with Agent 1 before session/timeline edits.

## Handoff to Agent 1

Verify the exact running build/backend and the intended-checkout handoff, then supply a released native window and A/B identity mapping when current users have finished. Do not interrupt another agent's work for QA. Start the retest with: open A → type an unsent draft → open context → switch to B → return to A → verify draft and exact context → inspect one finding's source and receipt. Existing state must be preserved and any QA-only unsent markers restored.

Append retests below with timestamp, build/commit/local changes, native window/backend identity, case/subcase, actual steps, expected versus observed result, evidence reference, owner and remaining limits. Keep blocked and historical results visible. Do not mark D01–D06 complete from browser fixtures, source inspection or this prepared checklist.

## Resumed passive/source pass — September 29, 2026, approximately 13:08–13:15 PDT

### Passive native observation

- **Method:** Read the existing Electron/OpenCode accessibility tree. No UI input, app launch, reload, preference change, network write, or fixture creation by QA. This is a still-state observation, not a recorded switching/motion test.
- **Observed:** Renderer `localhost:5173/index.html`; local entries `Expanded navigation · desktop fixture` and `Compact navigation · desktop fixture`; shared project `Desktop integration · mock runner`; `Team connected`; shared conversation `Compact navigation`; owner/worker `usr_serdar · wrk_desktop_fixture`; instruction plus team comment; queued state; empty shared-message composer; open Team context panel.
- **Honest limits shown by the product:** The instruction itself identifies a native integration fixture using the configured mock runner. The panel says `No generated context yet. The conversation remains available while your team's summaries catch up.` A queued instruction is not completed execution, and no generated context is not Flower awareness.
- **Reproducible read-only observation:** Identify the existing `com.github.Electron` window, read its AX tree without focusing/operating controls, and compare visible conversation, owner, worker and labels. The app may change as its active owner works; do not navigate it back merely to reproduce this snapshot.
- **Evidence:** CUA accessibility output in this chat's resumed native pass. No separate capture file was written. Startup error QA-N01 was absent in this snapshot; a clean launch or fixed startup path was not exercised by QA.

| Visible identity | Observed value | Limit |
| --- | --- | --- |
| Compact shared thread | `thr_8f80fe07-58e3-497f-b2b3-17356edb944d`, `usr_serdar` | Visible link and active heading; not switched by QA |
| Expanded shared thread | `thr_11a52a2a-2ad4-4d06-bbc1-e2d7a2f60d71`, `usr_talha` | Visible link only; different owner, so not the required same-owner alternatives fixture |
| Expanded local Session | `ses_desktop_expanded`; visible local tab path encodes `http://127.0.0.1:4466` | Local tab route only; does not establish coordination backend origin or binding to the shared thread |
| Active shared worker label | `wrk_desktop_fixture` | Fixture identity, not proof of a real OpenCode worker |

The top local tab and active shared conversation can name different fixtures. This snapshot alone does not establish a navigation bug: the local tab and shared route are different navigation surfaces. D02 must verify their intended selection behavior after handoff.

### Source identity for this pass

The current role instructions allow inspection of the evolving original checkout while retaining this file as the only write area. Read the updated agent prompts, parallel-review assignments and existing source-review receipt before inspecting current source.

- **Read-only implementation checkout:** `/Users/mac/Desktop/Coding/Hackathon/Puff/PuffCollaborative`, HEAD `0a91f6231aa4d64cc909839f46c376d54b1b1116`. The reviewed `team-thread.tsx`, `team-context.tsx`, `team-state.ts`, `team-shell.tsx` and `team.css` are untracked implementation files; HEAD does not identify their contents.
- **Other observed dirty application paths:** `packages/app/src/app.tsx`, `packages/app/src/i18n/puff-en.ts`, `packages/app/src/pages/layout-new.tsx`, desktop renderer `index.tsx`, `initialization.ts`, `initialization.test.ts`, and OpenCode host `httpapi/server.ts`. Additional untracked client/tests/plan files belong to other agents. QA modified none of them.
- **Output checkout:** `serdar/ui` advanced concurrently from the initial `f715b3e` to `d9c83188c68b7879f43a9c455d9d6e17414cfaf0`; observed at `2026-09-29T20:12:12Z`. Its only status entry at that checkpoint was this untracked receipt. QA did not perform that commit or any Git mutation.
- **Build limit:** These are inspected source identities, not verified identities of the running Electron bundle. No process inspection, restart or migration was performed to establish a stronger claim.

SHA-256 values were unchanged across two source reads in this resumed pass:

| Dirty source path, relative to original checkout | SHA-256 |
| --- | --- |
| `packages/app/src/pages/puff/team-thread.tsx` | `6c6d1bc80df8721135a15f9c09dcbf81ae4ca6807688a1ba2cd1bb0b8a75f7fd` |
| `packages/app/src/pages/puff/team-context.tsx` | `4344705a77d709e38b787c94145570f6c3f862ab5e4b28014218b281675bb234` |
| `packages/app/src/components/puff/team.css` | `dd930623700036a6d42ec87cb9cf3d457452b556dd49f8b3d4fbf45779869f72` |

### Source-supported concerns requiring native reproduction

These are **source-only findings, not observed native failures**. They supplement the existing reliability review; QA did not duplicate its async/retry investigations or apply fixes.

**QA-S01 — Shared-thread reading position has no per-thread restoration path (P2; D02/D03).**

- Current `team-thread.tsx:12–44,82–88` keeps a component-local `nearBottom` flag and can scroll to the bottom when visible events change. Unlike drafts, which are keyed by thread, the shared provider has no per-thread message anchor/scroll store (`team-context.tsx:17–37`). Selecting another thread clears the event list (`team-context.tsx:102–105`), and no matching save/restore path appears in these reviewed files. The existing personal-session scroll implementation is not used by this separate shared transcript.
- **Reproduction after release:** In an existing long shared A, scroll to an identifiable older event; record an independent older anchor in B; switch A → B → A, including one switch that waits for loading to finish. Verify each original anchor remains. Do not create messages or start a runner just to lengthen the fixtures.
- **Expected / source-predicted risk:** Independent reading positions should survive navigation. Clearing/replacing content without keyed restoration can lose the anchor or jump to the bottom. Exact native behavior has not been observed.
- **Owner:** Frontend lead for shared transcript state; R3 can use this case in its motion/focus review. Native QA retests after a released window with sufficiently long existing histories.

**QA-S02 — Evidence link discards the cited event destination (P2; D04).**

- Current `team-thread.tsx:289–298` renders `ref.eventId` as link text but constructs only `/puff/thread/${ref.threadId}`. The receiving component reads only `threadId` (`:9`), and event articles expose no matching navigation anchor (`:112–186`). `Inspect source` shows an ID/sequence after manual disclosure but does not target a cited event on arrival.
- **Reproduction after release:** Use an existing work card whose evidence references an older event in another long thread. Follow that citation, verify the target thread, then verify that the exact cited event is revealed/highlighted and that returning restores the original draft/anchor. No such work card was present in the passive native snapshot, so this case remains unexecuted.
- **Expected / observed source behavior:** An exact evidence action should make the cited event inspectable at its destination. The reviewed link carries thread identity only; all citations to different events in the same thread have the same destination URL. Whether the intended product interaction is a precise jump or an evidence peek remains with the lead/panel owner.
- **Owner:** Frontend lead for routing/return state and panel owner for evidence action content. Do not invent worker mappings or successful delivery receipts to fill the gap.

### Positive source observations and remaining boundary

- Shared drafts are keyed by thread (`team-thread.tsx:21,45`; `team-context.tsx:33`); current selection clears the previous snapshot before refresh (`team-context.tsx:102–105`). These mechanisms need the native A/B test and do not close the separately reported A → B → A async race.
- The context panel stays in the layout and becomes `inert` when closed (`team-thread.tsx:257`); CSS provides focus-visible rules (`team.css:761–768`) and disables animation/transitions for reduced motion (`:824–831`). This supports test preparation only; no keyboard, focus-return, resize, panel-toggle or native OS-preference test has been executed.
- At the end of this passive phase, interactive work still awaited a coordinated exclusive window. No prompt was sent, no fixture was provisioned, and no application, session, process or preference was changed by QA during that phase. The later release and reversible interactions are recorded below. Only this evidence file was edited; no application test/build or live collaboration gate is claimed.

## Released original-window native pass — September 29, 2026, approximately 13:15–13:20 PDT

### Exclusive release and identity

Agent 1, in `Review README for task workflow`, explicitly released the existing original Electron window (reported CDP port 9222) and said it would not interact there during QA. It identified the original checkout at `0a91f6231a` plus preserved dirty UI, actual patched OpenCode host `http://127.0.0.1:4466`, isolated synthetic service data/config under `/tmp/puff-desktop-service`, project `prj_desktop_fixture`, and local workspace `/tmp/puff-desktop-service/workspace`. Credentials were already connected; QA did not read, change, or record them. The handoff explicitly excludes final D01 acceptance because the intended-checkout host is being prepared separately.

QA used native CUA on the existing `com.github.Electron` OpenCode window, not another agent's browser connection. The renderer remained `localhost:5173/index.html`. The three source hashes above were rechecked unchanged at `2026-09-29T20:19:36Z`. That verifies reviewed source stability, not a binary hash. The lead's simultaneous port and reviewers' changes in `serdar/ui` were preserved; QA did not touch those paths.

### Executed cases and cleanup

| Case | Exact reversible actions | Observed result / limit |
| --- | --- | --- |
| Shared A/B drafts | Existing A initially empty → type `DESKTOP-QA-A-20260929` without sending → B initially empty → type `DESKTOP-QA-B-20260929` → A → B → A; later revisit both after local-session navigation | Each thread restored its own marker. Titles/owners/instruction/queued panel content matched the selected thread on observed settled frames. No controlled delayed-response race test. |
| Context and focus | In A expand its instruction's `Inspect source` → close context by button → reopen with Return → close again → Tab through both disclosures to composer → reopen → four further close/open Return pairs | Draft and expanded disclosure survived the panel-only cycles. Toggle retained focus; closed panel disappeared from AX; composer reachable with its focus border visible. No frame-by-frame flicker or lifecycle trace was collected. |
| Source disclosure | Expand A's existing instruction disclosure | Shows event `evt_0eec4413d0023LSPrbmkUBOwfm`, source sequence `4`. This is local disclosure inspection, not a work-card citation jump or delivery receipt. |
| Local A/B drafts | Existing `ses_desktop_compact` empty composer → marker `DESKTOP-QA-LOCAL-A-20260929` → existing `ses_desktop_expanded` empty composer → marker `DESKTOP-QA-LOCAL-B-20260929` → A → B | Both restored the correct marker in the retained coding composer with model controls. No prompt submitted or model/variant changed. Local fixture histories are empty; no tools/diffs exercised. |
| Sidebar | In local A collapse session sidebar by button → reopen using Return | Local draft survived, toggle retained focus, hidden rail entries left AX and returned on reopen. |
| Resize and focus | Window menu → Move & Resize → Left; compare context open/closed; then Move & Resize → Return to Previous Size | Native narrow layout exposed QA-N02. Draft survived. Returned to prior wide size. Captures were approximately 2560×1600 wide and 1514×1758 narrow in screenshot pixels; do not treat these as measured CSS viewport dimensions. |
| Cleanup | Clear only the four QA markers; verify empty local A and B, then empty shared B and A; close only the extra local compact tab opened by navigation; restore expanded sidebar and open context | Final state: original shared Compact conversation, empty composer/disabled Send, open context, original single expanded local tab, and two shared entries. Local-session buttons still reference the two existing IDs. Original size restored through native menu. |

No Send, Stop request, approval, Disconnect, New session, restart, reload or OS-settings action was used. One stale AX element and one app-change guard were handled by reading current state before continuing; no guarded action was assumed to have succeeded. OS Reduce Motion remains untested because its global effect could interfere with the user's other active sessions. QA did not run a backend count audit, so unchanged UI lists and use of existing routes are not presented as full duplicate-creation proof.

### QA-N02 — Narrow context overlay hides the keyboard-focused Send button

- **Priority:** P2; observed native D05 failure on the released original implementation. Frontend lead owns the responsive host/focus correction; R3 can use this reproduction. Final target build must be rechecked independently.
- **Precondition:** Existing shared Compact thread, an unsent draft, context open, session sidebar expanded. Synthetic project remains explicitly labeled. No submission is needed.
- **Reproduction:** Use native Window → Move & Resize → Left. Click Team context to close it, then click again to open and focus the toggle. Press Tab five times: instruction source → comment source → composer → message-type selector → Send. Do not press Enter or Space on Send.
- **Expected:** Every keyboard-focused control is visible. When context overlays the conversation, underlying obscured actions must not receive invisible focus, or the layout must keep them exposed.
- **Actual:** AX reports focused `button Send`, while the native screenshot shows the opaque right context panel covering the entire button and its focus ring. The draft/composer is partially covered as well. Click Team context to close it and repeat the five Tabs: the same Send control and its focus ring are now visible. The unsent marker survives both states.
- **Evidence:** Paired native AX+screenshot results in this chat: `Inspect focus on the narrow shared composer without sending` and `Confirm the same focused Send control is visible when context is closed`. A subsequent native menu restore and screenshot show the prior wide window. Captures remain in tool history because this assignment permits only this Markdown write.
- **Source correspondence:** Reviewed `team.css` narrow-window rule around lines 791–822 uses an absolutely positioned right panel over the conversation. The shared composer remains keyboard reachable. This supports the observed mechanism; no application fix was applied.
- **Retest:** Repeat on the intended `serdar/ui` native build at its narrow breakpoint, with panel both open and closed, forward/reverse Tab, and the original draft retained. Also retest panel close focus and resize back to wide. Do not close the full D05 gate until reduced motion is observed safely.

### Remaining acceptance boundary

The original-window pass provides native evidence for draft continuity, ordinary fixture identity switching, basic panel/sidebar focus, and one actionable narrow-window defect. It cannot establish the final intended-checkout launch, same-owner shared alternatives, long-history restoration (QA-S01), tool/diff retention, exact work-card event navigation (QA-S02), private/stale/offline states, native reduced motion, or real Flower/OpenCode cooperation. Those remain explicit pending cases rather than inferred successes.

At the end of this pass, the coordinator reaffirmed Agent 1's sole interactive control pending the integrated target. QA had already restored the released original window and sent Agent 1 the cleanup state and QA-N02 reproduction. No further native input will occur without a new exact-window release. Receipt verification at `2026-09-29T20:22:09Z` confirmed all D01–D06 procedures, historical observations and separate source/native findings are present, with no whitespace errors. The launch command itself was not supplied or executed by QA; the lead-reported host/build mapping above is the available identity evidence.

## Final-build retest queued — 2026-09-29T20:27:03Z

**Pending explicit release; no new native interaction.** The central `PuffCollaborative-main-integration/docs/hackathon/desktop-coordination.md` assigns shared mouse/keyboard/focus to the frontend lead. Its current access record supersedes the older per-window release table: separate Electron instances do not grant concurrent native input ownership.

The latest lead handoff identifies the intended instance as Electron41738, profile `/tmp/puff-serdar-ui-desktop`, renderer 5175 / CDP9223, external mock backend4466, and a dirty `serdar/ui` checkpoint. This is reported identity/preparation, not independent final-build acceptance. The lead's current status says it is correcting QA-N02; the inspected stylesheet now includes a later narrow-width rule that places the panel in normal layout. No fix pass is claimed from that source change.

After a fresh release and target confirmation, prioritize QA-N02 at the actual supported minimum width, with forward/reverse keyboard focus and panel open/closed; then exact checkout/commit/backend identity, original composer/tools/diffs, distinct local/shared drafts and context, citation behavior, and honest mock/unavailable states. The CSS breakpoint at 800px is not evidence of a native minimum width; record the actual window limit during the released test. Preserve any lead-owned drafts rather than replacing them. Populated histories and source-backed findings must already exist or come from the fixture owner. Native OS Reduce Motion remains pending a safe coordinated handoff. No restart or broad retest is requested while the lead finishes integration.

## Intended-window retest attempt — 2026-09-29T20:31:11Z

Agent 1 explicitly released Electron41738 / renderer5175 / CDP9223, with its compact local coding session, retained A/B QA drafts, exact-bound context and an expanded synthetic inline patch. The lead's report says the transcript is a static rendering fixture, not tool execution. Those state details are a handoff report, not independently observed by Agent 3.

**Access blocker, not an application regression:** `cua.getApp('com.github.Electron')` returned the original shared Compact screen with AX renderer `localhost:5173/index.html`. QA verified the mismatch before sending any input. The available browser connector exposed the task's IAB, not the target Electron connection; selecting renderer5175 through browser discovery resolved to IAB. QA did not open a browser substitute, navigate/reload the old native window, send input, or use unsupported shell/CDP UI automation. Native access was returned to Agent 1 immediately, with a request for unambiguous supported target selection. No restart is required or requested for this check.

Source inspection found the intended checkout at commit `f4c8ad9ee4f9c9e411e161e6ea6980099ecc85c0` (`feat(desktop): add persistent sessions and bound team context`, committed 13:30:23 PDT). The narrow shared layout now uses a separate context row instead of an absolute overlay; local layout stacks at its breakpoint and when the review panel needs room. These are source-level corrections only. `createMainWindow` in `packages/desktop/src/main/windows.ts` specifies default 1280×800 geometry but no explicit minimum in that constructor, so a claimed supported minimum still needs a native measurement/product constraint.

The released runtime remains the lead-identified intended checkout plus external mock backend4466; source commit identity is not a binary or running-module identity check. QA-N02, populated-tool/diff continuity, and other final-build cases therefore remain pending independent target-native verification. The already-observed original-window results and their screenshots are preserved separately above. This access limitation must not block committing or integrating the reviewed source.

## Intended Electron renderer retest — completed 2026-09-29T20:42:47Z

### Target access, source and test boundary

The lead and coordinator explicitly re-released the intended instance. The app's `AGENTS.md` requires `agent-browser` for automation. QA read the installed CLI help/core/Electron guidance and current Context7 documentation, then used its own `puff-qa-target` automation session against CDP9223. No unnamed/shared automation session was used. The initial pin-on-connect attempt tried an unsupported new-target operation and failed without creating a window. Listing the existing target, selecting it, then pinning the binding resolved that issue.

Verified existing target: `5BA7C2AEBB7B8D93175A6AA2B194CF07`, title OpenCode, URL `http://127.0.0.1:5175/index.html`. This is the already-running Electron renderer identified by the lead as PID41738/profile `/tmp/puff-serdar-ui-desktop`, with external backend4466 and the synthetic project. QA did not launch, restart, reload, close or replace the app/backend. The scope is this native renderer, not an IAB substitute or a fresh integrated-main process.

Code checkpoint is `f4c8ad9ee4f9c9e411e161e6ea6980099ecc85c0`. Checkout HEAD advanced to documentation commit `7bc81ad0600b2bbf8c8ba49f1f9067918ab86075` during the pass. These reviewed UI hashes were unchanged before/after:

| Source relative to `PuffCollaborative-serdar-ui` | SHA-256 |
| --- | --- |
| `packages/app/src/components/puff/team.css` | `04388e96a3881ab540b67b75f001ded40f28efa7faab158e4c67d7958e46a814` |
| `packages/app/src/components/puff/team-shell.tsx` | `f587bf958035096de039aa6b9f9385b66527899c3352638f40cfd2efa063a44c` |
| `packages/app/src/pages/puff/team-thread.tsx` | `a77e363042a265e4379c6ba1a29c5a40e7b47923087cfeaa9f823c615a96e94c` |
| `packages/app/src/components/puff/context-panel/index.tsx` | `2465bb0aec6649bb25318aa4d5c2959783d2738765c5badae345e9aea1a4f0d5` |

Initial geometry was inner/outer 1280×800, DPR2, `prefers-reduced-motion: reduce` false. The CLI's `set viewport 760 800` changes renderer emulation: outer width remained 1280. Therefore the responsive checks below do **not** measure a native minimum window size. QA did not change OS Reduce Motion or substitute emulation for that pending native-preference case.

### Observed interactions

| Case | Steps and observed result | Acceptance limit |
| --- | --- | --- |
| Original coding surface | Read compact local session: original Prompt, agent/model/variant controls and expanded `Patch navigation-fixture.ts +1 -1`; synthetic message explicitly says no model/tool executed | Static inline diff rendering only; no live tool execution |
| Local narrow focus | Set renderer760×800; focus Prompt; Tab through file/agent/model/variant controls to Send | Send visible with focus ring at `(704,524)`, 28×28; center hit-test belonged to Send. Context stacks below coding instead of covering it |
| Local panel Escape | Continuous keyboard traversal from Prompt through Send into Stop request, then Escape | Context closed and focus landed on Team context toggle; compact draft unchanged. Reopened afterward |
| Local A/B/A | Select existing expanded session, wait for `ses_desktop_expanded` context, then return to existing compact | Lead's `QA: expanded draft retained` and `QA: compact draft retained` remained distinct. Corresponding exact Session ID, worker and queued instruction appeared after loading. Expanded inline patch remained open on returning to compact |
| Exact shared QA-N02 retest | Open existing shared Compact; original draft empty; type unsent `DESKTOP-QA-TARGET-UNSENT`; Tab through type selector to Send at760×800, context open; check reverse/forward Tab and close context | Send/focus ring visible at `(663.148,541)`, approximately64×28; center hit-test exposed=true. The panel occupies a separate lower row. No Send activation. QA-N02 is fixed for this tested target/viewport |
| Shared A/B/A | With A marker, open existing shared Expanded, then return to Compact | B stayed empty; A restored its marker. Correct headings and corresponding instructions appeared. Temporary marker then cleared |
| Review/context coexistence | Restore1280×800/DPR2, open original Toggle review once with context open | Coding/composer and review occupy visible columns; context stacks below. Review truthfully says No tracked changes / Create Git repository. No repository action selected. Review closed afterward |
| Honest evidence copy | Read target context and fixture text | Mock runner/static rendering labels, waiting summary, Relationship unspecified, No shared findings, and admission/promotion/use not yet evidenced are explicit. No generated success was inferred |

**Focus caveat:** During slower, separated focus/Escape attempts, the intended panel focus was not stable: one attempt observed Stop request, then a later Escape left focus on body and context still open. The continuous traversal above succeeded. QA did not isolate whether refresh/replacement or automation timing caused the earlier focus loss; sustained panel focus across polling needs a controlled retest. Do not turn the successful continuous sequence into an unconditional focus-stability pass.

No live work-card finding existed in these fixtures, so exact citation navigation and real receipts remain unexecuted. QA-S01 and QA-S02 describe the historical original source. Current source now stores per-thread scroll positions and links citations with `#event-<eventId>` to a receiver that scrolls/focuses the target event. These are implemented source corrections, not a completed long-history or citation interaction check.

### Screenshots and restoration

The CLI generated temporary screenshots, inspected by QA without image editing. They are tool artifacts, not additional repository edits:

- [Local760 focused Send](</Users/mac/.agent-browser/tmp/screenshots/screenshot-1790714156255.png>) — visible original composer above stacked context.
- [Shared760 QA-N02 retest](</Users/mac/.agent-browser/tmp/screenshots/screenshot-1790714349838.png>) — visible focused Send, unsent marker and stacked context.
- [Review/context1280](</Users/mac/.agent-browser/tmp/screenshots/screenshot-1790714473367.png>) — retained coding/inline patch and empty review pane; context below.
- [Final target state](</Users/mac/.agent-browser/tmp/screenshots/screenshot-1790714567426.png>) — compact local coding view, lead's draft, expanded static patch and open exact-bound context.

Cleanup cleared only QA's temporary shared marker; both lead-owned local drafts remain unchanged. Shared B was empty throughout. The three pre-existing tabs, model/variant, fixture records and approvals were preserved. Sidebar remains expanded, context open, review closed, compact coding session selected and Prompt focused. Native dimensions were untouched; `set viewport 0 0 2` removed the temporary width/height override and the final measurement was inner/outer1280×800, DPR2. Rail navigation scrolled its list to the shared entries; its original pixel offset was not recorded or claimed restored. No send, new Session, stop/approval/disconnect, backend failure injection or OS-preference action was performed.

QA sent the lead a completion/cleanup receipt and explicitly released control immediately after the bounded checks. No further native input is planned without another release. Only this Markdown file is edited by QA; source commits, main publication and other reviewers' artifacts remain their owners' work.

### Visual and interaction assessment

**Observed visual judgment, not a performance benchmark:** the original coding view has a clear center, legible transcript and readable inline red/green patch. The familiar composer/model controls remain discoverable. The repaired stacked layout keeps critical controls visible at the tested narrow width, though context consumes substantial vertical reading room and has its own scrolling content.

First-use clarity still needs work before claiming mature coding-app polish. Repeated Compact/Expanded names across tabs, personal entries and shared entries make the relationship between those surfaces hard to infer. Long fixture titles are truncated. Raw worker/Session IDs, developer telemetry, the DEV badge and numerous R1 fixture rows visually compete with useful work. These are observed development/fixture conditions; this is not an audit of a clean packaged first-run experience.

The context panel's many muted labels and empty/waiting sections create a technical status-sheet appearance. Primary conversation/code contrast looks clearer than secondary metadata; no contrast ratio or accessibility conformance measurement was performed. Its missing-evidence copy is honest, but the screenshot does not demonstrate how helpful context feels when a real finding arrives.

QA observed settled states and keyboard outcomes, not continuous animation/video or instrumented frame timing. Visible FPS/JANK counters are not proof of smoothness. The lead's benchmark receipt is separate reported evidence and was not rerun here. A polished/smooth/finished verdict would exceed this pass. Remaining cases include sustained focus across polling, long-history restoration, exact event citation, native minimum-size behavior, native reduced motion and offline/private/stale failures, plus an actual source→Flower→active-session workflow.

## Final access status — RELEASED

Agent 3 has finished this assigned pass and explicitly **released CDP9223 / renderer5175 / profile `/tmp/puff-serdar-ui-desktop`**, including native mouse/keyboard/focus ownership, back to the frontend lead/coordinator. The lead was notified after cleanup. Starting local drafts and view state were preserved as detailed above; the rail's original pixel offset was not claimed restored. No pending automation will interact with the window, no unchanged-source polling will continue, and remaining checks await a newly assigned ready build and explicit release. The next development wave is outside this QA pass.
