# Additional desktop agents for Serdar

September 29, 2026. These assignments supplement [the existing three UI roles](serdar-agent-prompts.md). Six additional chats plus those three and the coordinator make **ten chats total**. They do not create ten competing UI implementations.

## Current ownership and first handoff

| Chat | Assignment | Immediate deliverable |
| --- | --- | --- |
| Coordinator — this chat | Priorities, contracts and review synthesis | Integrate findings into the existing checklist |
| Existing frontend lead — Review README for task workflow | Native host, shared UI/state/client, layout and Git integration; existing startup helper remains attached | Working desktop from the intended checkout; explicit panel handoff |
| Existing panel agent — Read the project README | Collaboration panel content | Reuse current panel content once files/props are handed off |
| Existing QA — Summarize current team work | D01–D06 native workflow verification | Resume after the working native window is available |
| R1 — Serhat integration reviewer | Backend-to-existing-client connection and independent evidence | Small authenticated read/write flow across two members |
| R2 — Interaction and visual designer | Alternatives, coding continuity, evidence inspection | Three small annotated interaction proposals |
| R3 — Motion and accessibility reviewer | Focus, scrolling, reduced motion and window resizing | Motion/focus matrix and prioritized corrections |
| R4 — Frontend reliability reviewer | Asynchronous state and failure recovery | Rechecked race/retry findings with reproductions |
| R5 — Privacy and evidence reviewer | Actual data boundaries and accuracy of UI claims | Field-by-field boundary and claim audit |
| R6 — Demo creative director | Clear, memorable story and rehearsal | Three-to-five-minute shot list with truthful fallback |

The coordinator already ran three independent source reviews; [their receipt](evidence/2026-09-29-parallel-source-review.md) gives R1/R2/R4 concrete starting points. They did not execute tests or verify native behavior. Reviewers must recheck current source before treating a finding as unresolved.

**Paste this into the existing frontend lead before distributing new work:**

```text
Continue your current desktop implementation and retain your startup helper.
I have assigned a panel agent and reviewers; do not duplicate their work.
My newer branch instruction is serdar/ui, not main. Inspect both checkouts
and preserve your current dirty work. Plan a safe handoff into
/Users/mac/Desktop/Coding/Hackathon/Puff/PuffCollaborative-serdar-ui,
including the exact backend dependencies your UI now consumes. Do not
switch/reset/stash the active original checkout, blindly merge main, or
push UI work to main. Keep the current implementation intact while
resolving that handoff. You own shared UI integration and its Git writes.
Publish the panel file/props handoff now, reusing your existing content.
Read docs/hackathon/serdar-parallel-reviews.md and the linked source review
receipt from the serdar/ui checkout. Reserve the existing team-api,
team-context, team-thread, team-shell and startup wiring to your team;
give R1 a separate consumer-test boundary and QA the final native target.
Return the target checkout, dependency commits, owned files, panel handoff,
and current launch blocker. Do not restart another task's app/server.
```

## Shared instructions for R1–R6

Each short launcher in the final chat response points here. Read this section and your assigned role before doing work.

- Authoritative product cases: [WF01–WF10](acceptance-workflows.md), [integration gates](integration-gates.md), [progress checklist](progress-checklist.md), [MVP](mvp-spec.md), and `docs/coordination-contract.md`. Read applicable `AGENTS.md` files. Existing approved desktop direction stays in place.
- **Output checkout:** `/Users/mac/Desktop/Coding/Hackathon/Puff/PuffCollaborative-serdar-ui`, branch `serdar/ui`. Each reviewer owns only `docs/hackathon/reviews/<role-id>.md` (lowercase `r1` through `r6`). No staging, commits, pushes, branch switches, PRs, dependency installation or production-code edits by reviewers.
- **Source checkpoint differs from output checkout:** the latest backend and dirty desktop UI were observed in `/Users/mac/Desktop/Coding/Hackathon/Puff/PuffCollaborative` at `0a91f6231aa4d64cc909839f46c376d54b1b1116`. The prepared UI checkout does not yet contain that newer backend or dirty UI. Inspect both states and the lead's latest handoff; review the actual current source, not an older copy. Record HEAD, dirty paths, hashes of reviewed dirty files, and inspection time. Never copy someone else's evolving implementation yourself.
- Start with a 20-minute first pass. Return at most four important findings or three design proposals, with scenario, expected/observed behavior, evidence, severity and implementation owner. Stop re-reviewing unchanged files. Continue affected checks after the lead's next update.
- Proposals are not implemented features. Source reasoning, deterministic tests, mock HTTP integration, native observations and real Flower/OpenCode behavior are different evidence levels. Native launch remains unverified in the intended checkout; a browser screenshot cannot close that gate.
- No new frameworks, dashboards, providers or database. Reuse existing Solid/Electron components, theme, i18n and motion. Consult Context7 when library/API instructions are needed; ordinary source review does not need external documentation.
- Do not restart an app/server or take over another task's native window. Use QA's shared captures or a coordinated idle native window. Missing native access blocks observations, not source review or preparation of proposals.
- Keep secrets out of source, receipts and command output. No manual model keys, raw private-session export, runner credentials in the member UI, or new `.env` workflow. Label all synthetic fixtures.
- Send findings back to Serdar in this chat's final response and your assigned file. Do not message other user-owned chats without explicit authorization. Human owners remain Serhat/backend, Talha/runtime, Serdar/UI and Ferit/Flower. The lead applies or hands off accepted changes.

## R1 — Review Serhat's work and prove the desktop connection

```text
Act as R1 under the shared instructions above. Independently inspect
Serhat's newer backend, the coordination contract and his mock receipt.
Read the coordinator's source review first. Do not equate his completed
backend slice with real execution or live Flower awareness.

Build an endpoint-to-existing-UI map using createTeamApi and team-context.
Do not create a second client, state provider or startup implementation.
Review the activitySeq/work-card issue and concurrent exact-comment retry;
give Serhat a minimal regression case for each still-current finding.
Confirm that submit queues an instruction and that a separate authorized
worker claims it. Keep worker credentials out of the member frontend.

Once the lead provides a working host and an exclusive consumer-test
handoff, verify the actual connection: isolated provisioned project and
thread, two individually authenticated members, project/thread reads,
snapshot/replay, one attributed comment visible once to both members and
after reconnect, then queued instruction and queued cancellation.
Check missing credentials and outsider access fail appropriately.
Prefer the repo-pinned Bun 1.3.14; disclose any runtime difference from
Serhat's receipt. Keep fixture provisioning separate from product UI.

You may add/run consumer integration tests only after the lead gives you
exclusive test paths in a checkout containing the required implementation.
Until then your only write is docs/hackathon/reviews/r1.md. Do not modify
team-* files, CSS, routing, desktop initialization, server wiring, schemas
or generated clients. Existing startup fixes belong to the lead/helper.
Obtain the actual host identity instead of silently starting another app.

Extend separately to mock runner reservation/output/approval if useful;
name the worker driver and verify subsequent turns also get claimed.
Talha owns real execution/SessionBinding, Ferit owns real Flower jobs.
Give existing native QA the exact consumer flow to verify in Electron.
Your result is a tested connection or a precise owner-specific blocker,
not just another architecture proposal. Do not close WF02 from mock runs.
```

## R2 — Creative interaction and visual design

```text
Act as R2. Improve the current desktop concept with three tightly scoped
proposals in docs/hackathon/reviews/r2.md. No production edits or redesign.
Keep the existing conversation, composer, code, tools and diffs central.

Scenario 1: Serdar has compact-navigation A and expanded-navigation B,
both ongoing, same owner. Make their approach and state distinguishable
in the rail/header without choosing a winner or creating new sessions.
Scenario 2: B is working when A produces a useful finding. Show how the
context panel reveals its source and the real admission/promotion/use
states without interrupting B or pretending pending evidence succeeded.
Scenario 3: inspect A's exact cited event from B, then return to B's draft
and reading position. Specify an evidence peek or precise navigation.

For each, produce a small annotated textual wireframe with normal,
pending and failure states; reuse existing components where possible.
Add a short parity comparison between personal and shared coding views:
messages, code/diffs, tools, permissions and composer/model controls.
Recommend the one change with the greatest demo value for the least work.
Treat visual judgments as hypotheses until validated in the native app.
Pass panel content to its existing owner and host/navigation changes to
the lead. Do not restore the old dashboard or invent backend metadata.
```

## R3 — Motion, keyboard and accessibility

```text
Act as R3. Write docs/hackathon/reviews/r3.md. Inspect existing shell,
thread and panel behavior; do not edit them or duplicate native QA.
Own the interaction quality beyond basic functional pass/fail.

Trace keyboard focus opening/closing each panel, selecting A/B, viewing
evidence and returning to the composer. Test the expected reading position
when old output is visible and new events arrive. Consider a narrow
desktop window, long session titles, empty/loading/errors and reduced
motion. Hidden controls must leave the focus order; pending state must
remain understandable without animation. Avoid auto-scroll stealing focus.

Deliver a small matrix: trigger, preserved state, focus destination,
animation, reduced-motion behavior, acceptance observation. Rank at most
four corrections. Validate with QA's native evidence when available;
label all source-only and visual hypotheses. Shared host transitions and
CSS stay with the lead; panel-internal changes stay with its owner.
```

## R4 — Frontend state and retry reliability

```text
Act as R4. Write docs/hackathon/reviews/r4.md. Recheck the source-review
receipt against the lead's current implementation; do not duplicate its
already-reported findings without checking whether they were fixed.

Prioritize: ambiguous send followed by credential expiry; A→B→A during
delayed reads; replay still having more pages at the safety cap; an approval
whose decision committed but runner delivery failed. Also verify drafts
and stable request identity survive navigation/retry. Use actual service
semantics, not assumptions that every failed HTTP response means no write.

Provide deterministic interleavings, expected state and exact current
lines for at most four high-confidence findings. If there is an existing
safe focused test, run it from its package and record the result; no shared
test/source edits or new servers. Propose regression cases for the lead.
Keep source reasoning separate from executed evidence. Do not rewrite the
state provider or take over native QA, backend ownership or Flower testing.
```

## R5 — Privacy boundaries and truthful evidence

```text
Act as R5. Write docs/hackathon/reviews/r5.md. Trace the actual data path
from local Session/tool output to selected export, shared service,
analysis/model input and target Session. Where a connection is absent,
say so instead of inferring it from planned architecture.

Use the specific cases: one unshared private Session; an unrelated shared
topic with similar words; same-owner intentional alternatives; unshare or
mute while a finding is pending; a stale or nonexistent cited event.
For each boundary list fields crossing, authorizing identity, enforcement
location and observed evidence. Identify whether summaries themselves
contain sensitive content. Remote reasoning is not local-only processing.

Audit visible claims: live, fresh, delivered, used, shared/private, approved
and completed. Acknowledge only the milestone actually proved. Separate
tool approval from permission to redirect work. Flag unsupported promises
and propose precise copy/disabled states, retaining production i18n rules.
No live external security testing, private data export or credential logs.
Give at most four concrete gaps with owners and a testable correction.
```

## R6 — Creative demo and rehearsal director

```text
Act as R6. Write docs/hackathon/reviews/r6.md. Design a memorable three-to-
five-minute native desktop demo using existing workflows, not new features.
Show the wasted-work problem, why separate agents have different context,
what each owns, what gets shared, what Flower contributes and human control.

Use same-owner compact A versus expanded B. Introduce a new A-only finding
after B begins; use WF02's fresh tag and isolated-workspace rules. Never
preload B with it. The magic moment is B changing a concrete check or plan
while keeping its expanded approach, not two bots acknowledging each other.

Create a timed shot list with on-screen action, spoken line, required real
evidence and fallback. Distinguish stored/admitted, promoted and observed
use. Identify what the audience should notice without reading raw logs.
Keep the source event and B's before/after behavior easy to inspect.

Provide two honest scripts: live cooperation when the required receipts
exist, and an explicitly labeled partial/mock prototype if it remains
blocked. No canned result presented as live. Include a second fresh-trial
rehearsal checklist and the smallest feature cut that protects the core
moment. Do not run paid Flower jobs, alter agents' prompts or manipulate
the active native window without the owners' explicit test handoff.
```

## Integration order

1. Lead publishes the checkout/dependency/panel handoff and fixes native startup with its existing helper. R1 can review backend now; R2–R6 can prepare independent artifacts now.
2. R1 proves the smallest real member read/write flow using the existing client. QA observes the matching desktop interaction. Report mock execution separately.
3. Lead resolves the highest-impact reliability findings and accepts at most one or two creative improvements. Assign exact files before any reviewer becomes an implementer.
4. QA rechecks D01–D06. All four humans connect their actual pieces for WF02/WF10. R6 rehearses only the behavior that evidence supports.
5. Coordinator and lead summarize remaining blockers and integrate only reviewed changes on `serdar/ui`. Branch combination and main integration remain a later team action.
