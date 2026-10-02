"""Connect a server-authorized redacted export to the existing Flower chain."""

import argparse
import json
import sys

from bridge import build_job, map_report
from contracts import prepare
from coordinator import CoordinationFailure, coordinate


def build_product_job(envelope):
    if not isinstance(envelope, dict) or set(envelope) != {
        "request", "snapshot", "provenance", "bindings", "cooperationVersions"
    }:
        raise ValueError("Expected an authenticated server export")
    request, snapshot = envelope["request"], envelope["snapshot"]
    prepare(request, snapshot)
    bindings = envelope["bindings"]
    if not isinstance(bindings, list) or len(bindings) != 2:
        raise ValueError("Two captured bindings required")
    by_session = {binding["sessionId"]: binding for binding in bindings}
    versions = envelope["cooperationVersions"]
    if not isinstance(versions, dict) or set(versions) != {binding["threadId"] for binding in bindings} or any(type(version) is not int or version < 1 for version in versions.values()):
        raise ValueError("Captured consent revisions required")
    target = by_session.get(request["targetSessionId"])
    if not target:
        raise ValueError("Missing captured target")
    provenance = envelope["provenance"]
    if not isinstance(provenance, list) or len(provenance) > 40:
        raise ValueError("Invalid source provenance")
    sources = {}
    for source in provenance:
        if set(source) != {"threadId", "eventId", "eventSeq", "threadActivitySeq"} or source["eventId"] in sources:
            raise ValueError("Invalid source provenance")
        sources[source["eventId"]] = source
    refs = []
    for event in snapshot["events"]:
        source, binding = sources.get(event["eventId"]), by_session.get(event["sessionId"])
        if not source or not binding or source["threadId"] != binding["threadId"] or source["eventSeq"] != event["revision"] or source["threadActivitySeq"] != binding["activitySeq"]:
            raise ValueError("Source does not match its captured binding")
        refs.append({"flowerRef": {key: event[key] for key in ("workerId", "sessionId", "eventId", "revision")},
                     "sourceRef": {"threadId": source["threadId"], "eventId": source["eventId"], "seq": source["eventSeq"]}})
    if len(refs) != len(sources):
        raise ValueError("Source list must exactly cover selected events")
    by_ref = {tuple(item["flowerRef"][key] for key in ("workerId", "sessionId", "eventId", "revision")): item["sourceRef"] for item in refs}
    bridge_request = {
        "requestId": request["requestId"], "projectId": request["projectId"],
        "targetThreadId": target["threadId"], "question": request["question"],
        "createdAt": request["createdAt"],
        "evidenceRefs": [by_ref[tuple(ref[key] for key in ("workerId", "sessionId", "eventId", "revision"))] for ref in request["evidenceRefs"]],
    }
    activity = {"snapshot": {"schemaVersion": 1, "projectId": snapshot["projectId"],
                "workers": snapshot["workers"], "sessions": snapshot["sharedSessions"], "events": snapshot["events"]}, "warnings": []}
    return build_job(bridge_request, activity, bindings=bindings, source_refs=refs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", required=True)
    args = parser.parse_args()
    try:
        raw = sys.stdin.read(400_001)
        if len(raw.encode("utf-8")) > 400_000:
            raise ValueError("Input exceeds bound")
        job = build_product_job(json.loads(raw))
        report = coordinate(job.request, job.snapshot, state_dir=args.state_dir)
        print(json.dumps(map_report(job, report)))
        return 0
    except CoordinationFailure as error:
        print(json.dumps(error.outcome))
        return 1
    except (ValueError, KeyError, TypeError):
        print(json.dumps({"state": "failed", "error": "Invalid trusted export"}))
        return 2


if __name__ == "__main__":
    sys.exit(main())
