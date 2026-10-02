"""Show the local Activity-to-Flower contract using an explicitly synthetic report."""

import json
from pathlib import Path

from activity.pipeline import Activity
from bridge import build_job, map_report
from contracts import make_report, prepare, validate_analysis


def main():
    raw = json.loads(Path("fixtures/activity/sample_snapshot.json").read_text(encoding="utf-8"))[
        "snapshot"
    ]
    project_seq = {"compact-1": 0, "full-1": 1, "compact-2": 2}
    sessions = [{**session, "shared": True} for session in raw["sessions"]]
    activity = Activity(raw["projectId"], sessions, raw["workers"])
    for source in raw["events"]:
        activity.ingest({**source, "revision": project_seq[source["eventId"]]})
    activity.ingest(
        {
            "eventId": "compact-3",
            "projectId": raw["projectId"],
            "workerId": "worker-compact",
            "sessionId": "compact",
            "revision": 3,
            "kind": "status",
            "occurredAt": "2026-09-29T18:00:03Z",
            # The current synthetic result retains the finding it verifies.
            "content": {
                "transition": "progress",
                "recentOutcome": "Keyboard-focus and Escape checks passed for compact navigation.",
            },
        }
    )

    selected = [("worker-compact", "compact"), ("worker-full", "full")]
    envelope = activity.snapshot(selected)
    threads = {"compact": "thread-compact", "full": "thread-full"}
    bindings, source_refs = [], []
    for session in envelope["snapshot"]["sessions"]:
        session_id = session["sessionId"]
        card = activity.card((session["workerId"], session_id))
        bindings.append(
            {
                "projectId": raw["projectId"],
                "threadId": threads[session_id],
                "workerId": session["workerId"],
                "sessionId": session_id,
                "ownerId": session["ownerId"],
                "title": session["title"],
                "featureTopic": session["featureTopic"],
                "relationship": session["relationship"],
                "activitySeq": session["revision"],
                "expectedVersion": 0,
                "shared": True,
                "deterministicStatus": "active",
                "contributors": card["contributors"],
            }
        )
    for event in envelope["snapshot"]["events"]:
        source_refs.append(
            {
                "flowerRef": {
                    key: event[key] for key in ("workerId", "sessionId", "eventId", "revision")
                },
                "sourceRef": {
                    "threadId": threads[event["sessionId"]],
                    "eventId": event["eventId"],
                    "seq": event["revision"],
                },
            }
        )

    events = {event["eventId"]: event for event in envelope["snapshot"]["events"]}
    request = {
        "requestId": "synthetic-activity-flower-demo",
        "projectId": raw["projectId"],
        "targetThreadId": threads["full"],
        "question": "Does the navigation constraint matter to the full experiment?",
        "evidenceRefs": [
            {
                "threadId": threads["compact"],
                "eventId": "compact-3",
                "seq": 3,
            },
            {"threadId": threads["full"], "eventId": "full-1", "seq": project_seq["full-1"]},
        ],
        "createdAt": "2026-09-29T19:00:00Z",
    }
    job = build_job(request, envelope, bindings=bindings, source_refs=source_refs)
    prepared = prepare(job.request, job.snapshot)
    analyses = []
    for index, item in enumerate(prepared["inputs"]):
        session = item["session"]
        session_events = [
            event for event in item["events"] if event["sessionId"] == session["sessionId"]
        ]
        result = validate_analysis(
            {
                "task": "Explore navigation",
                "approach": "Compact navigation"
                if session["sessionId"] == "compact"
                else "Full navigation",
                "workState": "ongoing",
                "progress": (
                    "Building the menu; keyboard focus and Escape are required."
                    if session["sessionId"] == "compact"
                    else "Building the full menu."
                ),
                "blockers": [],
                "recentOutcome": (
                    "Keyboard focus check passed." if session["sessionId"] == "compact" else None
                ),
                "evidenceRefs": [
                    {key: event[key] for key in ("workerId", "sessionId", "eventId", "revision")}
                    for event in session_events
                    if event["eventId"] in {"compact-2", "compact-3", "full-1"}
                ],
                "warnings": [],
            },
            item,
        )
        analyses.append({"result": result, "runId": f"synthetic-session-run-{index + 1}"})

    report = make_report(
        prepared,
        analyses,
        {
            "relationship": "alternative",
            "awareness": {
                "sourceSessionId": "compact",
                "text": "The compact experiment surfaced keyboard-focus and Escape requirements relevant to the full menu.",
                "evidenceRefs": [
                    {
                        "workerId": events[event_id]["workerId"],
                        "sessionId": events[event_id]["sessionId"],
                        "eventId": event_id,
                        "revision": events[event_id]["revision"],
                    }
                    for event_id in ("compact-3", "full-1")
                ],
            },
            "proposal": None,
            "warnings": [],
        },
        "synthetic-coordination-run",
    )
    mapped = map_report(job, report)
    print(
        json.dumps(
            {
                "synthetic": True,
                "selectedSessions": [
                    session["sessionId"] for session in envelope["snapshot"]["sessions"]
                ],
                "selectedEventCount": len(envelope["snapshot"]["events"]),
                "actorIdsForwardedToFlower": any(
                    "actorId" in event["content"] for event in job.snapshot["events"]
                ),
                "candidateState": mapped["state"],
                "workCardUpdates": [
                    {
                        "threadId": update["threadId"],
                        "expectedVersion": update["expectedVersion"],
                        "sourceActivitySeq": update["sourceActivitySeq"],
                        "status": update["card"]["status"],
                        "recentVerifiedOutcome": update["card"]["recentVerifiedOutcome"],
                        "evidenceRefs": update["card"]["evidenceRefs"],
                    }
                    for update in mapped["workCardUpdates"]
                ],
                "awarenessNoteCandidate": mapped["awarenessNoteCandidates"][0],
                "notProven": [
                    "live Flower execution",
                    "backend persistence",
                    "OpenCode delivery or use",
                ],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
