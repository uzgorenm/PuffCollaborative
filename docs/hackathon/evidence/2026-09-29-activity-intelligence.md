# Activity intelligence component receipt — September 29, 2026

Owner: Ferit. Evidence level: **unit tests and synthetic fixtures only**.

Tested implementation commit: `51ecb1249` (`feat(flower): add isolated activity
intelligence and Jev refresh pipeline`). The checkout was clean at this test.
Source base: `59528d2b8`. Incoming runner-only commit `2ca65ac8b` was subsequently
merged as `d5a885dd7`; it does not change the activity module or its dependencies.

Command, from `hackathon/flower` with Python 3.13:

```text
python -m unittest discover -s activity -v
Ran 16 tests in 0.067s
OK
```

`python -m activity.demo` also generated the committed, explicitly synthetic
`hackathon/flower/fixtures/activity/sample_snapshot.json`.

Verified component controls:

- WF01 support: two selected alternatives retain separate approach/status;
  unshared/unrequested sessions and arbitrary tool payloads are absent.
- WF04 support: unchanged revisions do not emit refresh intents; debounce
  coalesces meaningful changes; current-journal projection suppresses trusted
  awareness/acknowledgment provenance and work-card.updated feedback.
- WF05 support: old summaries and unknown evidence fail; unshare clears local
  retained evidence. This is not proof of remote cancellation or note revocation.
- WF06 support: injected timeout, malformed/low-confidence answers and exceptions
  fall back within the scheduler bound without changing execution status.
- Queued work remains up next until explicit start; reordered input yields the
  same card; conflicting duplicate identities/revisions fail.

Eight fixture histories: deliberate_alternatives, keyboard_constraint,
added_scope, abandoned_objective, queued_vs_started, unrelated_sessions,
continuation, blocker_change. Each includes expected card projections and refresh
expectations. Classification labels are injected expectations, not live Jev output.

No credential was available for TypeSafe. The real HTTPS implementation follows
the documented choice API; live provider/model behavior remains unverified.
No Flower run, AgentApp modification, chain-adapter edit, OpenCode execution,
dashboard change, backend test, or live workflow completion is claimed here.
G2/WF10 and G3 remain open.

C2/C3/C8 questions for Serhat and the Flower Agent 1 owner:

1. Confirm the authorized selected-topic/relationship/provenance metadata source.
2. Confirm sparse project seq -> evidence revision mapping and retention of
   captured Thread.activitySeq, original sourceRef and expected WorkCard.version.
3. Confirm the provisional ProjectSnapshot-shaped Flower input and warnings
   envelope, plus descriptive result mapping. It is not the retired `/puff/v1`
   backend contract or an implemented new server route.
4. Exercise the same sample in Agent 1's real chain and return exact references,
   real run identity, and an informational keyboard finding. The producer's unit
   checks do not close the consumer handoff.

See `hackathon/flower/activity/README.md` for usage, boundaries and limitations.
