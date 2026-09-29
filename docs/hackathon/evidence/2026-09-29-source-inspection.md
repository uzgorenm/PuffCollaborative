# Exact source inspection and decision recovery checkpoint

Source commit: `e332cbf539eeb98c3157a8f3ae74f38c576b3552`, September 29, 2026. This receipt covers source and local synthetic tests, not native acceptance or live Flower delivery.

## Behavior and independent review

- Exact authenticated project/Thread/event/sequence lookup opens a source peek inside the existing conversation. Invalid, missing, aborted and stale identity results cannot become the cited event.
- Source lookup follows the visible Thread's project even after the sidebar roster switches projects. A later project/account/target change rejects an in-flight result.
- Decided tool requests with uncertain delivery remain visible. Retry is available only for the exact remembered same-account rejection attempt, using its original decision ID and claimed version; no second claim or enabled Allow is invented.
- Personal/shared rail and shared header expose real Session identity. Run state appears only from a matching authoritative active Run.
- Independent review found and the owners fixed two defects: nonreactive source-peek visibility and lookup against the sidebar project instead of the visible Thread. A separate coordinator reviewer found no additional release-blocking defect in the client/controller/panel boundary.

## Coordinator checks

Pinned Bun 1.3.14. In the frozen integration source, then again at committed `e332cbf539` in the clean publication checkout:

- Six focused client/controller/panel/identity/i18n files: **67 tests passed, 1,200 assertions**.
- Full `packages/app` browser-condition suite: **46 tests passed, 144 assertions**.
- App and desktop package typechecks passed on the frozen source.
- App production build passed on the frozen source, with existing chunk-size/import warnings.
- Diff whitespace check passed.

The real-host browser regression uses the actual Thread page, controller, client and panel with synthetic HTTP responses. It verifies exact source display, Inspect and Close retaining focus through unchanged polling, Escape returning to the same Inspect control, and preservation of composer draft and reading position. Happy DOM does not establish OS Tab traversal or rendered Reduce Motion behavior. See [R3's report](../reviews/r3-next.md) for harness limits and red/green evidence.

The earlier `serdar/ui` native window remains a different source checkpoint. Native QA must launch/identify a separate instance from this source before claiming N1/N2/N3 acceptance. Real sharing authority, Flower export/delivery, active Session promotion and B using an update remain separate open gates. The new Project overview is a later slice.
