# Ferit — local Activity-to-Flower handoff

Date: September 29, 2026
Result: local contract walkthrough passed; live integration unverified
Evidence kind: synthetic adapter demonstration
Branch: `ferit`
Base commit: `745256d21`
Working tree: Flower bridge, Activity sequence-zero handling, README and this
receipt were modified or added for the walkthrough.

## What was run

From `hackathon/flower/`:

```powershell
& 'D:\sharedArea\base1\FlowerAI\.venv\Scripts\python.exe' bridge_demo.py
```

The demo ingested the checked-in synthetic compact/full navigation history into
the Activity reducer and added a synthetic keyboard-check tool event. It assigned
a project-wide event sequence `0, 1, 2, 3`, selected two threads and four events,
built the Flower input through
`bridge.build_job`, validated it through `contracts.prepare`, then mapped a
synthetic structured report through `bridge.map_report`.

## Observed result

- Two selected sessions produced two backend-shaped WorkCard update candidates.
- Event citations mapped back to `thread-compact/compact-2/seq 2` and
  `thread-full/full-1/seq 1`.
- Actor IDs were not forwarded into Flower input.
- Both WorkCard statuses stayed at the trusted deterministic `active` value.
- The compact card carried `recentVerifiedOutcome: "Keyboard focus check passed."`
  from the synthetic tool result; the full card kept it null. The input report
  distinguished a tool outcome from the keyboard requirement.
- The keyboard-focus/Escape finding returned as a source-linked awareness-note
  candidate with `candidateState: pending` and `deliveryState: not_attempted`.
- `map_report` returned `state: mapped`; it did not claim Flower run
  completion.

## Limits and next owners

The report and trusted bindings were synthetic; the walkthrough did not call
TypeSafe or SuperGrid, exercise Jev classification/intent scheduling, write
through the backend, persist an awareness note, deliver context to an active
OpenCode session, or observe recipient use. The latest SuperGrid preflight could
not reach SuperLink from this environment, and the earlier submission was
rejected during authentication before run IDs were returned.

Serhat still needs to confirm server-authoritative share/topic/relationship
bindings and provide a durable request/result trigger that consumes Jev refresh
intents. The current WorkCards CAS can accept a mapped summary candidate when
its captured activity sequence and version are still current; it does not store
Flower results or awareness notes. Talha and Serhat still need an approved
safe-boundary admission contract for the exact active OpenCode Session.

Source review found one concrete C3 blocker: the current backend updates
`Thread.activitySeq` when a thread is created and when a comment is added, while
the queue/run event writers append their project events without advancing that
thread field. A polling worker cannot both capture those newer run events and
submit a WorkCard update at the backend's current sequence until Serhat closes
that gap. The untracked `worker.py` prototype is therefore not included in this
handoff or claimed as a working server integration.

This receipt proves the local field and citation mapping only. It does not close
G0, G2, G3, or any live workflow gate.
