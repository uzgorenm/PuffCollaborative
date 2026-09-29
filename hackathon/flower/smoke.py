"""Synthetic smoke inputs kept outside Agent 2's fixtures/ ownership."""

import argparse
import json
from pathlib import Path

from contracts import utc_now
from coordinator import CoordinationFailure, coordinate


def example(request_id="navigation-smoke", unrelated=False):
    sessions, workers, events = [], [], []
    for label, approach in [("A", "compact"), ("B", "full")]:
        sessions.append(
            {
                "workerId": f"worker-{label}",
                "sessionId": label,
                "ownerId": "demo-owner",
                "title": f"{approach} navigation",
                "featureTopic": "navigation",
                "relationship": "alternative",
                "revision": 1,
                "status": "running",
            }
        )
        workers.append(
            {"workerId": f"worker-{label}", "projectId": "puff-demo", "ownerId": "demo-owner"}
        )
        text = f"Exploring {approach} navigation. The experiment is ongoing; no design has been chosen."
        if label == "A":
            text += " Discovered a shared constraint: every navigation item needs a visible keyboard focus indicator and Tab access."
        if label == "B" and unrelated:
            sessions[-1].update(
                title="database backup", featureTopic="backup", relationship="unspecified"
            )
            text = "Investigating database backup retention. No navigation work."
        events.append(
            {
                "eventId": f"event-{label}",
                "projectId": "puff-demo",
                "workerId": f"worker-{label}",
                "sessionId": label,
                "revision": 1,
                "kind": "message",
                "occurredAt": "2026-09-29T19:00:00Z",
                "content": {"role": "assistant", "text": text},
            }
        )
    refs = [
        {key: event[key] for key in ("workerId", "sessionId", "eventId", "revision")}
        for event in events
    ]
    request = {
        "requestId": request_id,
        "projectId": "puff-demo",
        "targetWorkerId": "worker-B",
        "targetSessionId": "B",
        "question": "Does the other session have a useful finding for this session?",
        "evidenceRefs": refs,
        "createdAt": "2026-09-29T19:00:00Z",
    }
    snapshot = {
        "schemaVersion": 1,
        "projectId": "puff-demo",
        "workers": workers,
        "sharedSessions": sessions,
        "events": events,
        "summaries": [],
        "proposals": [],
        "awarenessNotes": [],
        "decisions": [],
        "deliveries": [],
    }
    return request, snapshot


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--request-id", required=True)
    parser.add_argument("--unrelated", action="store_true")
    parser.add_argument("--state-dir", default=".runtime")
    parser.add_argument("--write-input", type=Path)
    args = parser.parse_args()
    request, snapshot = example(args.request_id, args.unrelated)
    if args.write_input:
        args.write_input.write_text(
            json.dumps({"request": request, "snapshot": snapshot}, indent=2), encoding="utf-8"
        )
    else:
        try:
            result = coordinate(request, snapshot, state_dir=args.state_dir)
            print(json.dumps({"checkedAt": utc_now(), "report": result}, indent=2))
        except CoordinationFailure as error:
            print(json.dumps(error.outcome, indent=2))
            raise SystemExit(1)
