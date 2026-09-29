# Serdar’s desktop workflow and agent prompts

**Revised after the latest frontend chat on September 29. This replaces the earlier standalone-dashboard assignments.**

The current target is a seamless desktop coding experience: retain the existing chat, composer, tools and diffs; make personal/shared sessions easy to reach; show collaboration beside the active conversation; use polished, restrained motion and keyboard support. The `/puff` browser dashboard is existing prototype material, not the acceptance surface for this increment.

**Additional sessions:** use [six focused review/creative assignments](serdar-parallel-reviews.md), including Serhat-to-desktop integration. Those assignments preserve the three implementation/QA roles here. Their lead handoff and latest source checkpoint supersede older checkpoint details below.

## What the frontend chat is doing

**Review README for task workflow** is active on persistent session navigation and a collapsible context panel beside the conversation. The latest inspection found dirty desktop initialization, app routing/layout and new `team-*` client/state/shell/thread files in the original checkout on `main`. The prepared `serdar/ui` checkout does not yet contain that work or the latest backend. The coordinator has not moved it automatically. Paste the updated [lead handoff](serdar-parallel-reviews.md#current-ownership-and-first-handoff) first.

An earlier predev attempt failed on `@opentui/solid/preload`; later native QA observed `Service not found: @opencode/CoordinationRuntime`. The lead already has a helper investigating the retained OpenCode host's server composition. Keep that investigation with the existing team; do not launch a duplicate startup agent. Recheck the latest failure rather than assuming either historical symptom remains current.

**Read the project README** received Agent 2's assignment and is waiting for the lead's panel file/props handoff. **Summarize current team work** prepared native QA and reported the runtime blocker; D02–D06 still need a working target-build window. Continue those assignments instead of giving them duplicate work.

## Prepared workspace and limits

- Branch: `serdar/ui`; includes existing dashboard implementation `3f75718234`.
- Target checkout: `/Users/mac/Desktop/Coding/Hackathon/Puff/PuffCollaborative-serdar-ui`.
- Original active checkout: `/Users/mac/Desktop/Coding/Hackathon/Puff/PuffCollaborative`. Preserve its files and branch.
- Local Bun: `/Users/mac/Desktop/Coding/Hackathon/.tools/bun-1.3.14/bin/bun`.
- The [setup receipt](evidence/2026-09-29-serdar-branch-setup.md) verifies the shared UI baseline. **Native desktop readiness is still open.**
- Ports 4444/4445 are auxiliary browser previews, not proof of a native desktop run. Do not recreate the worktree or launch duplicate servers.

The desktop renderer imports `AppInterface` from `@opencode-ai/app` in `packages/desktop/src/renderer/index.tsx`. Interface work therefore still belongs largely in `packages/app`; keeping that package does not require shipping a separate website.

## First task and parallel ownership

**Agent 1 first verifies native launch from the intended checkout, then opens one existing coding session with its composer, messages, tools and diffs intact.** Record the command and any blocker. A browser preview does not close this setup gate.

| Agent | Owns | Boundary |
| --- | --- | --- |
| 1 — Existing frontend lead | Safe handoff, native startup, app/session layout, session sidebar, panel mounting/open/close motion, shared i18n integration, Git | Does not duplicate Agent 2’s panel implementation |
| 2 — Context panel | Self-contained panel content, local presentation model/tests and scoped styles | No entry-point, sidebar, host-motion, backend or Git edits |
| 3 — Desktop QA | Native workflow, keyboard/focus/motion review and evidence | No application edits, process restarts or Git mutations |

Agent 2 can inspect records immediately, but starts editing only after Agent 1 confirms the panel file handoff; the active lead may already be implementing it. After that boundary is explicit, component work and launch investigation can proceed in parallel. Agent 3 can prepare cases and inspect source now, but native pass/fail evidence requires an actual desktop run. Only Agent 1 integrates shared files and commits. Hand off any existing panel implementation rather than starting a second one.

## Common instructions — include with each prompt

```text
I am Serdar. The product target is the desktop coding app, with
collaboration inside the existing conversation experience.
Continue that direction; do not create another dashboard or framework.

Target checkout:
/Users/mac/Desktop/Coding/Hackathon/Puff/PuffCollaborative-serdar-ui
Branch: serdar/ui. Verify both before editing.
Separate teammate branches supersede historical main-only instructions.
Do not push main, open a PR or merge teammates’ branches.
Only Agent 1 may stage, commit or push this shared UI branch.

Read AGENTS.md, packages/app/AGENTS.md, packages/desktop/AGENTS.md,
and docs/hackathon/{serdar-agent-prompts,mvp-spec,acceptance-workflows,
integration-gates}.md. Use the existing SolidJS components, theme,
i18n and motion mechanisms; support reduced motion. Use Context7
when library/API documentation is needed.

Preserve Session identity, composer drafts, scroll, tool permissions
and diffs. Follow the app’s benchmark requirement before changing
session/timeline code. No new backend contract, credentials, framework,
database or invented live data. Keep synthetic data labeled.
Do not restart another task’s app/server or reuse its browser session.
Report exact files, checks, evidence and remaining limitations.
```

## Agent 1 — Continue the desktop frontend session

Paste into **Review README for task workflow**, with the common instructions:

```text
Continue your desktop work. First carry it safely into the prepared
serdar/ui checkout. Inspect both Git states. Preserve any uncommitted
UI work and copy only your owned changes into the new checkout,
checking the resulting diff. Do not reset, delete or stash other work,
switch the original checkout’s branch, or merge all of main. If your
new work is committed, inspect and port only the relevant UI commits.

Own native startup, app/session entry points, persistent session
navigation, shared layout/i18n and the panel’s host/open-close motion.
Reserve packages/app/src/components/puff/context-panel/ for Agent 2.
If you already wrote equivalent panel content, hand it off for reuse.

First reproduce and resolve native launch with your existing helper.
The latest QA report mentioned missing @opencode/CoordinationRuntime;
inspect the actual current cause rather than bypassing checks. Verify the
native window, intended checkout and backend before saying setup is
ready. Report a backend-owned blocker if one remains.

Keep coding central. Navigation opens existing Sessions, not duplicates.
Mount Agent 2’s panel beside the chat. Open/close must preserve draft,
scroll, tools, diffs and focus without remounting chat or starting a
competing runner. Own host transitions and reduced-motion behavior.

Publish chosen host files and the panel data/callback boundary before
integration. Bind the exact active worker/Session; missing backend data
shows unavailable/unknown or explicit demo mode, never simulated live.
Agent 2 publishes its component props and owns the internal content.

Verify D01–D06 below, relevant tests, app/desktop typechecks and build,
and the session-layout benchmark required by app instructions.
Review Agents 2/3’s results, commit reviewed work and push serdar/ui.
Do not merge main.
```

## Agent 2 — Context beside the active conversation

Paste into **Read the project README**, with the common instructions:

```text
Build the contents of the collaboration context panel.
Own only packages/app/src/components/puff/context-panel/ and
 docs/hackathon/serdar-context-panel-handoff.md.
First inspect Agent 1’s current files/handoff for an equivalent panel;
reuse it rather than duplicate it. Stay read-only until Agent 1 confirms
the panel file handoff. Do not edit app/desktop/session
entry points, sidebar, host transitions, global CSS, shared i18n,
controllers, transport, generated clients, backend or Git state.

Create a self-contained SolidJS component with explicit props/callbacks
and publish a small usage example for Agent 1. Reuse existing UI
records; keep any additional display model local and provisional,
not a new backend schema. Use existing localized copy; request new
shared keys from Agent 1 rather than editing their dictionaries.

Show the active session’s approach/topic/sharing state, related
alternatives and useful source-backed findings. Match exact worker
and Session identity. Switching A/B must not leak stale context into
the new session. Same-owner alternatives remain separate experiments.
Missing identity/data gets an honest empty or unavailable state.

Distinguish acknowledgment, admission, promotion and observed use.
Later stages remain unknown without evidence. A run ID, tool approval
or generic acknowledgment cannot establish use. Do not invent source
links, expose unrelated/private context, redirect work or pick a winner.

Use scoped styles, accessible disclosure controls and restrained row
transitions with reduced-motion support. Host motion belongs to Agent 1.
Test alternative sessions, rapid selection changes, missing receipts,
stale/offline states and unknown identity. Label fixtures clearly.
Return component props, tests and limits. Agent 1 mounts and commits it.
```

## Agent 3 — Independent native desktop QA

Paste into **Summarize current team work**, with the common instructions:

```text
Review the native desktop experience. No app edits or Git mutations.
Your only write area is docs/hackathon/evidence/serdar-desktop-qa.md.

Prepare D01–D06 while launch is being fixed. Coordinate an idle app
window for review; do not restart or take over Agent 1’s active session.
If native launch is blocked, report it. Browser checks may supplement
native evidence but cannot replace it.

Check existing compact/expanded sessions through real chat navigation,
panel open/close, keyboard focus, draft/scroll preservation, correct
active-session evidence, resizing and reduced motion. Look for jumps,
flicker, clipped content, trapped focus and fake live states. Do not
create duplicate Sessions merely to make navigation appear to work.

Record exact build/source, steps, expected/actual behavior and evidence.
Distinguish desktop rendering, synthetic context and real Flower/
OpenCode behavior. Separate the known Punjabi locale failure from new
regressions. Report actionable findings and owners; repeat affected
checks after fixes. Do not commit or push.
```

## Desktop acceptance checks

- [ ] **D01 — Native launch:** record command/build, actual window and backend identity from the intended checkout. No browser substitute.
- [ ] **D02 — Existing sessions:** A/B navigation preserves drafts/history and creates no duplicate Sessions. Both same-owner alternatives remain identifiable.
- [ ] **D03 — Stable panel:** open/close preserves draft, scroll, tools/diffs and sensible focus; no chat remount.
- [ ] **D04 — Correct context:** A/B switching updates the exact target’s context; unrelated/private/stale records do not become current findings; receipt claims match evidence.
- [ ] **D05 — Usable motion:** keyboard, visible focus, window resizing and reduced motion work without persistent flicker, clipping or hidden controls.
- [ ] **D06 — Honest failures:** missing/offline backend and unsupported operations stay explicit; failures never silently become synthetic successful collaboration.

After native launch, Serdar’s first review is: **open A, type a draft, open context, switch to B, return to A, and confirm the draft and correct context remain intact.** Then inspect one finding’s source and delivery evidence.

Desktop UI completion is distinct from the live source→Flower→active-session workflow in WF02/WF10. Installer publication and unrelated native features are outside this increment.
