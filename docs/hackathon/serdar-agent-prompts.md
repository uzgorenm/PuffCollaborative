# Serdar's UI workspace and parallel-agent prompts

**First task:** review the existing team workspace with the two alternative frontend sessions. Make the difference between the two experiments and the evidence of cross-session learning understandable before expanding the dashboard.

## Prepared setup

- Branch: `serdar/ui`; base includes UI implementation commit `3f75718234`.
- Checkout: `/Users/mac/Desktop/Coding/Hackathon/Puff/PuffCollaborative-serdar-ui`.
- Existing original checkout: `/Users/mac/Desktop/Coding/Hackathon/Puff/PuffCollaborative`. Other chats may still work there. Do not switch its branch, reset it or edit it from these tasks.
- Local Bun: `/Users/mac/Desktop/Coding/Hackathon/.tools/bun-1.3.14/bin/bun` (1.3.14).
- Preview: `http://127.0.0.1:4445/puff`, explicitly synthetic. Port 4444 belongs to the earlier UI chat. Do not restart either process during another task's work.
- Dependencies use the existing frozen lockfile, with worktree-local `node_modules`. No new framework or global runtime was installed.
- The native worktree tool could not operate because this chat is rooted at the non-Git Hackathon parent directory. The isolated checkout was created with Git's worktree fallback.

In a new terminal:

```sh
export PATH="/Users/mac/Desktop/Coding/Hackathon/.tools/bun-1.3.14/bin:$PATH"
cd /Users/mac/Desktop/Coding/Hackathon/Puff/PuffCollaborative-serdar-ui
git branch --show-current
```

Expected branch: `serdar/ui`. The existing preview is already started for this handoff. If it has ended, first verify that port 4445 is free, then start it from `packages/app`:

```sh
bun dev -- --host 127.0.0.1 --port 4445 --strictPort
```

Verification commands, from `packages/app`:

```sh
bun test --conditions=solid src/pages/puff src/i18n/parity.test.ts
bun typecheck
bun run build
bun run test:unit
bun run test:browser
```

The focused HTTP tests require loopback socket access. A sandbox failure to bind port 0 is not an assertion failure; rerun with the required local socket permission without changing the test. Read the [setup receipt](evidence/2026-09-29-serdar-branch-setup.md) for actual results and the known full-suite limitation.

## What the other chats have done

| Chat title | Observed activity at handoff |
| --- | --- |
| Review README for task workflow | Finished and reported its UI/evidence work pushed through `8192dbc046`; now idle. Built the responsive dashboard, sharing/review controls, preview, Basic readiness check and focused tests. The prepared branch includes implementation commit `3f75718234`; later main-only handoff documentation is separate. |
| Read the project README | Idle after a skills-only review. Recommended selective UX review and browser checks; made no implementation changes in that pass. |
| Summarize current team work | Idle after explaining sharing labels and each teammate's integration responsibility. No implementation was claimed in that pass. |

These are inspected chat states, not commands sent to those chats. A chat does not automatically move into this worktree: include the exact checkout in its next prompt.

## Your first five-minute review

1. Open the preview. Confirm the synthetic-data notice is obvious.
2. Compare the compact and expanded navigation sessions. Can you explain their different approaches even though both belong to Serdar?
3. Inspect one shared finding and its sources. Identify its sender and recipient.
4. Check whether the displayed state proves only a worker acknowledgment or actual use. The current UI explicitly says admission, promotion and use remain unverified.
5. Open Sharing settings. Try changing the topic, relationship and mute state; reset the preview afterward. These are local simulations, not changes to a real worker.

Give Agent 1 the single most confusing point. Start Agents 2 and 3 in parallel with the file limits below; do not ask three agents to rebuild the whole dashboard.

## Shared instructions for every agent

Paste this with each task:

```text
I am Serdar, owner of the Puff UI. Work only in:
/Users/mac/Desktop/Coding/Hackathon/Puff/PuffCollaborative-serdar-ui
Branch: serdar/ui. Verify the path and branch before editing.

Our newer instruction is separate teammate branches, combined later.
It overrides the old main-only instruction in historical plans.
Do not switch branches in the original checkout, push main, open a PR,
or merge other teammates' work. Only Agent 1 may stage, commit or push
this shared UI branch, after collecting the other agents' results.

Read AGENTS.md, packages/app/AGENTS.md, docs/hackathon/mvp-spec.md,
acceptance-workflows.md, integration-gates.md and this prompt file.
Continue the existing SolidJS UI; use its components, theme and i18n.
No new frameworks, dependencies, backend/schema changes or secrets.
Fetch current library documentation through Context7 when needed.

Preview: http://127.0.0.1:4445/puff. Keep synthetic mode visibly labeled.
Do not restart another task's server or reuse its browser session.
Use a separate named browser session for your checks.
Runtime PATH: /Users/mac/Desktop/Coding/Hackathon/.tools/bun-1.3.14/bin

Report exact files, observed behavior, checks, limitations and remaining
dependencies. A UI fixture is not live Flower or OpenCode evidence.
```

## Agent 1 — Awareness evidence and UI integration lead

Best continuation: **Review README for task workflow**. Use the shared instructions plus:

```text
Continue your existing dashboard. First confirm that the UI commit
3f75718234 is in this checkout; do not rebuild completed work.

Own pages/puff/index.tsx, project-state.ts and its tests, preview.ts,
puff.css, i18n/puff-en.ts, and new components/puff/awareness-* files.
These implementation paths are relative to packages/app/src/.
Leave session-card.tsx and its tests to Agent 2. Keep transport,
controller, backend contracts and generated clients unchanged for
this slice. You are the sole Git writer.

Make one finding's evidence chain understandable: source session and
finding -> Flower result -> target session -> acknowledgment ->
admission -> promotion -> concrete use. Distinguish missing evidence
from failure and from successful completion. A returned message ID,
generic acknowledgment or completed analysis must never imply use.
Keep the two alternative approaches visible and separate.

The backend does not yet supply the full receipt contract. Keep any
new evidence presentation model UI-local and explicitly provisional;
do not invent routes or change the wire schema. Existing records with
only acknowledgment must continue to show later stages as unverified.
If you illustrate later stages, mark them synthetic and point to
separate fixture evidence; never derive them from acknowledgment.

Add meaningful tests for acknowledgment-only data, missing/stale
sources, wrong target and failed delivery. Use existing localized copy
where possible; own any necessary new i18n keys. Preserve the current
page's layout and working interactions.

After Agents 2 and 3 report, review only their owned changes, run the
focused tests, app typecheck/build and browser checks, record the
remaining full-suite limitation, then commit and push serdar/ui.
Do not merge to main. If running alone, finish only your slice and
leave the other agents' work untouched.
```

## Agent 2 — Sharing controls and alternative-session usability

Best continuation: **Read the project README**. Use the shared instructions plus:

```text
Own only components/puff/session-card.tsx and a focused
components/puff/session-card.test.tsx (or a small adjacent pure form
helper and its tests). Preserve the exported SessionCard props.
These implementation paths are relative to packages/app/src/.
Do not edit the page, controller, shared styles, i18n dictionaries,
wire types, backend or Agent 1's files. Do not commit or push.

Start by checking the existing behavior; improve only demonstrated
gaps in the two-similar-frontend-sessions case. Make the current
topic, alternative relationship, owner and mute state inspectable.
Preserve each session's independent approach and identity.

Verify keyboard access, form labels, focus and draft preservation
during snapshot refresh. Check an already-open form after ownership
or writable permission changes: it must not submit an action the
current viewer is no longer allowed to request. The backend remains
the authority; client disablement is a usability safeguard.

Keep mute/unshare available when only analysis is pending, while
still respecting saving, connection and ownership restrictions.
Use existing i18n keys/components. Send any required new copy to
Agent 1 as a precise request instead of editing their dictionary.
Do not add extra settings or repeat controls that already work.

Write focused regression checks for demonstrated bugs and perform
a keyboard/mobile walkthrough. Return files changed, before/after
behavior and exact check results. Leave changes for Agent 1 to review.
```

## Agent 3 — Independent UI acceptance reviewer

Best continuation: **Summarize current team work**, or a new reviewer chosen by Serdar. Use the shared instructions plus:

```text
Do not modify application code or run Git mutations. Your only write
area is docs/hackathon/evidence/serdar-ui-qa.md. Review the current
page first and repeat affected checks after Agents 1 and 2 finish.

Use the real preview at port 4445 in your own named browser session.
Review at desktop and 390px width, then keyboard-only. Check:
two same-owner alternatives; visible topic/sharing state; source
inspection; no unearned admission/promotion/use claims; mute during
pending analysis; stale evidence; offline/failure state; synthetic
versus real mode; edited proposals; unauthorized or disabled actions.

Use WF01/WF02/WF04/WF05/WF06/WF07 for expectations, but label your
results UI/FIXTURE. Do not mark the live product cases passed without
real source, Flower and target-session evidence. Do not create a fake
backend to imply integration. Do not enter real credentials.

Record exact commit plus dirty-file caveat, steps, expected/actual
behavior and reproduction evidence. Report only actionable findings
with the relevant file/interaction and suggested owner. Acknowledge
the known Punjabi locale test separately from new regressions.
Send your report to Serdar; Agent 1 owns fixes and integration.
```

## Completion for this UI increment

- [ ] Serdar can explain the two alternatives and one finding's path from the page alone.
- [ ] Evidence stages never promise more than their underlying receipts establish.
- [ ] Sharing remains usable and permission-aware through refresh/pending states.
- [ ] Agent 3 records a reproducible UI review and resolved/unresolved findings.
- [ ] Agent 1 verifies and pushes only `serdar/ui`; the team integrates branches later.

This completes a UI increment, not backend integration or the hackathon's live Flower workflow. The full acceptance gates remain authoritative.
