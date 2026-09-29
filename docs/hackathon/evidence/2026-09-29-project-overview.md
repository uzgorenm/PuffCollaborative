# Mounted Project overview checkpoint

Integrated app source: `6aadf49887aa2bf7e7a2b8ad7fb1d488bde10ebe`. Original isolated source: `2a7d8bba76c7265ab89578a14c34c5aeee57a1a1`. The integrated source preserves main's ownership-label correction and its regression. No R1 backend draft files were included.

## What can be tested

- Open `/puff`, connect the existing team service and select an authorized project.
- Read selected shared work, reported task/progress/blockers, current or stale cards, reported outcomes and tool-review attention.
- Expand a work card and inspect its exact cited event, including event kinds absent from the conversation timeline.
- Open the existing shared Session. Other local Sessions are listed separately; listing does not select or share them.
- Compare real Session identities. Thread creators are not represented as verified Session owners.

The mounted host has no durable focus, topic/relationship or Session-owner producer. Kickoff editing, actual per-target policies, reuse/keep-separate decisions and Flower delivery/use are not implemented by this checkpoint.

## Checks at the integrated source

The coordinator reran checks in the clean publication checkout with Bun 1.3.14:

- API, controller, overview model/view and i18n suites: **68 passed, 1,205 assertions**.
- Full browser-condition suite, including real Thread host focus and ownership regression: **47 passed, 147 assertions**.
- App typecheck passed.
- App production build passed; existing chunk-size/import warnings remain. The SSR test harness also emitted a WebSocket port warning without a test failure.
- Diff whitespace check passed.

The independent checker separately reran 63 focused tests and typecheck at the isolated source; see its [review](../reviews/project-overview-independent.md). Source review found no blocker to a partial hands-on preview. A narrow follow-up is checking whether unchanged overview polling replaces an Inspect button used as a focus-return target; no passing claim is made for that specific new-host case yet.

## Native and live boundaries

QA is preparing a distinct native profile from the frozen isolated source, using the existing synthetic coordination backend. Until its actual receipt is recorded, planned ports or a passing build are not proof of a ready native preview. QA alone owns native input and will explicitly hand it to Serdar. Preserve the preview source and all older instances.

No trusted selected export, real Flower-to-target admission/promotion, or observed change in an active target's work is established by this receipt.
