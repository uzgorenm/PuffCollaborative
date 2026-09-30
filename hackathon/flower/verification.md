# Flower chain verification — September 29, 2026

This is the historical pre-login checkpoint. A later synthetic SuperGrid chain
completed; see the [live receipt](../../docs/hackathon/evidence/codex-flower-live.md).

Implementation: `a03c33ac5d4ba5d84eb49ba784dcbb7e2ac6c31c`, based on
Puff OpenCode main `f9035487d`. Checks ran against the same code tree immediately
before that commit. This is source/unit/build evidence, **not a live cooperation
receipt**. Full workflow receipt: [G2/WF10](../../docs/hackathon/evidence/2026-09-29-flower-chain.md).

## Observed checks

All commands run from `hackathon/flower/`:

| Command | Observed result |
| --- | --- |
| `uv run --frozen python -m unittest discover -v` | 21 passed |
| `uv run --frozen ruff check .` | Passed |
| `uv run --frozen ruff format --check .` | 12 files already formatted |
| `uv run --frozen --project session flwr build --app session` | Built `puff-local.puff-session-analysis.0-1-0.47121d3b.fab` |
| `uv run --frozen --project coordination flwr build --app coordination` | Built `puff-local.puff-coordination.0-1-0.f267cb66.fab` |
| Inspect FAB members with `zipfile` | Only manifest, license, agent source and `.info/CONTENT`; no evidence, secrets, runtime files or environment |
| `git diff --check` | Passed |

On this Windows host, set `$env:PYTHONUTF8='1'` for Flower CLI output. Without
that setting the bundles were written, but printing Flower's success emoji
raised `UnicodeEncodeError` on cp1252. Both commands then exited successfully
with UTF-8 enabled. Tests needed execution outside the filesystem sandbox
because Windows denied access to Python-created temporary directories.

## Actual live attempt

The early attempt used the existing installed Flower **1.39.0** interpreter:

```text
python smoke.py --request-id navigation-live-01
flwr list --limit 4 --format json supergrid
```

Only the synthetic data in `smoke.example()` was supplied. The host had already
built both separate apps. Both session submission attempts failed without
returning IDs. The read-only CLI diagnostic reported:

```json
{
  "success": false,
  "error-message": "Authentication failed. Please run `flwr login` to authenticate and try again."
}
```

The connection banner is omitted above. No credential is included.

- Session A run ID: **not returned**.
- Session B run ID: **not returned**.
- Coordination run ID: **not started**.
- Completed application output: **none retrieved**.
- Terminal SuperGrid state: **not observed**.
- Unrelated live control: **not attempted after the authentication rejection**.

The host implementation was subsequently hardened with a credential preflight,
explicit authentication error category and unresolved-run replacement guard.
These paths have local tests; they have not received live success verification.
The original attempt remains in ignored `.runtime/` with its uncertainty intact.
Refreshing credentials is a user action; no login, publication, team registration
or hackathon submission was performed by the implementation.

## Sanitized input and expected local-test output

Input A: “Exploring compact navigation … every navigation item needs a visible
keyboard focus indicator and Tab access.” Source: `worker-A/A/event-A`, revision 1.

Input B: “Exploring full navigation … no design has been chosen.”
Source: `worker-B/B/event-B`, revision 1. Both are explicit alternatives on topic
`navigation`, owned by the same synthetic owner.

The **local test**, not SuperGrid, exercises an informational note such as:

```json
{
  "sourceSessionId": "A",
  "targetSessionId": "B",
  "text": "A found a keyboard focus constraint relevant to both designs.",
  "state": "pending",
  "evidenceRefs": [
    {"workerId":"worker-A","sessionId":"A","eventId":"event-A","revision":1},
    {"workerId":"worker-B","sessionId":"B","eventId":"event-B","revision":1}
  ]
}
```

This proves local assembly/validation behavior only. A real model result and
the receiving OpenCode session's use remain unverified. Tests also accept an
empty no-relation report and reject unknown citations, old revisions, alternative
misclassification, cross-topic notes, imperative notes and duplicate submissions.

## Remaining gates

1. Ferit refreshes SuperGrid login and verifies the early ambiguous submission
   state before retrying. Do not delete the ledger to bypass unresolved jobs.
2. Run the final code over a fresh synthetic source marker and the unrelated
   control; capture all three run IDs, terminal states, result envelopes and
   validated handoff. Current event-channel support is source-inspected only.
3. Serhat and Ferit/Agent 2 settle C3/C8: project `seq`, `Thread.activitySeq`,
   session evidence references and the actual job/result port. The provisional
   `ContextRequest`/`ProjectSnapshot` adapter is not that backend integration.
4. Talha/Serhat/Serdar verify admission, promotion and B's actual use with WF02.
5. Publication/submission remain intentionally outside this task.
