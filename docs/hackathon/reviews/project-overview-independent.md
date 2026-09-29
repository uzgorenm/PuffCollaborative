# Independent Puff Collaborative review

Checkpoint: 2026-09-29, overview app commit `2a7d8bba76` based on `d1ec774099`; the isolated backend files remain uncommitted. This is a source and focused-test review of an in-progress integration. Native QA and live Flower/OpenCode receipts are separate.

## Verified at this checkpoint

- The overview model distinguishes a person's stated focus from an agent's work card. It does not infer Session ownership from `Thread.createdBy`; an exact trusted Thread/Session/worker/owner binding is required for attribution.
- Project, member, selected-Thread, WorkCard and per-Thread snapshot reads are joined by exact IDs. A mixed activity sequence invalidates the read, and an absent or older card cannot appear as current. A current reported result needs a cited event reference; the label remains reported.
- The `/puff` host now mounts the overview and offers explicit project work and personal-session navigation. Source inspection uses the authenticated exact-event resolver, limits display to documented event text and metadata, and keeps the current conversation and draft in place.
- Focused checks I ran against the frozen app commit: overview/API/state/model/view tests `63 pass, 0 fail` with 226 assertions; app `bun typecheck` passed. The owner also reported a passing app build. Core overview and brief/focus tests `2 pass, 0 fail` with 47 assertions. These are source/unit/SQLite tests, not native or live acceptance.
- The new backend brief/focus service persists versioned owner-managed briefs and self-authored focus in SQLite and passes an exact-retry/restart test. Its event, protocol, handler and generated-client wiring is still pending.

## Open full-experience requirements

| Experience | Current evidence and gap |
| --- | --- |
| Solo multi-session awareness | The desktop can list other local Sessions, but there is no production owner selection/topic/relation producer, permitted export, Flower analysis to an already active target, or observed target use. |
| Four-person project overview | Authorized member and shared work reads exist. The mounted host supplies no durable stated focus or trusted Session owner binding yet, so it cannot truthfully show each person's focus beside their agents. |
| Kickoff and starter context | A versioned brief/focus service passes isolated SQLite tests. No authenticated HTTP route, UI editor, new-Session retrieval or operational first-task handoff has been verified. |
| Goal, progress, blockers, result | WorkCard fields, freshness and exact source inspection are implemented in the overview. The project goal is not yet read from a durable brief; source-linked outcomes remain analyst-reported until inspected and independently verified. |
| Overlap and completed-work choices | Source-level model/backend tests distinguish deliberate alternatives, reported completion and tentative overlap. The live host currently supplies `related=[]` and no continue/reuse/separate handlers; no durable owner-selected intent or decision exists. |
| Human authority and firmness | Existing tool approval is separate from work-redirection approval. R6 documents a per-target policy and exact owner-approved instruction, but neither active target policy nor proposal/approval/delivery is wired and tested. |
| Native and live acceptance | A native QA owner is testing the handed-off build. No combined native overview acceptance or source-to-Flower-to-target admitted/promoted/used receipt is established by these checks. |

## Review findings sent to owners

1. A WorkCard source can cite a project event filtered out of the conversation timeline. The initial overview hash navigation could falsely show “source missing.” The owner replaced it with direct exact-event lookup; recheck native focus and delayed/mismatched source behavior before closing.
2. The first direct source peek rendered raw `event.payload` and closed on every unchanged poll. The owner changed it to documented text and removed poll time from the scope. Recheck this in native QA.
3. The brief/focus service and overview reader are independent source slices. Their route and trusted selection producer remain explicit integration blockers. A project-level suggested awareness default must not be treated as the active policy of a target Session.

## Acceptance boundary

Do not sign off on the full requested experience from these tests. A passing build, component fixture or SQLite read is not evidence that a Flower finding reached an active target Session, was promoted into its transcript, or changed its work. Use the workflow cases and separate native/live receipts for that claim.
