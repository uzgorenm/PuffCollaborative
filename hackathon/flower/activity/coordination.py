"""Pure evidence mapping for the current journal; no backend calls or writes.

Selection and normalized content are trusted adapter inputs, not model output.
This mapping is provisional until C2/C3/C8 are signed off by the human owners.
"""

from activity.pipeline import clean_event


def selected_event(event, thread, content, *, shared, provenance="native"):
    """Keep project seq as a sparse source revision; never use card version.

    Return None for unshared or feedback-only records. content must already be
    explicitly selected; raw journal payload is never copied into model input.
    """
    if not shared:
        return None
    if event["projectId"] != thread["projectId"] or event.get("threadId") != thread["id"]:
        raise ValueError("Event/thread mapping mismatch")
    if provenance not in {"native", "awareness", "acknowledgment"}:
        raise ValueError("Unknown provenance")
    if provenance != "native" or event["kind"] == "work-card.updated":
        return None
    if type(event["seq"]) is not int or event["seq"] > thread["activitySeq"]:
        raise ValueError("Evidence exceeds captured thread activity sequence")
    kinds = {"instruction.submitted": "status", "comment.created": "message",
             "run.output": "message", "run.tool": "activity",
             "run.started": "status", "run.completed": "status", "run.failed": "status",
             "run.cancelled": "status"}
    if event["kind"] not in kinds:
        return None
    expected = {"instruction.submitted": "queued", "run.started": "started", "run.completed": "completed",
                "run.failed": "failed", "run.cancelled": "stopped"}
    if event["kind"] in expected and content.get("transition") != expected[event["kind"]]:
        raise ValueError("Selected status disagrees with authoritative event")
    if event["kind"] in {"instruction.submitted", "run.started"}:
        if not event.get("instructionId") or content.get("instructionId") != event["instructionId"]:
            raise ValueError("Instruction mapping mismatch")
    content = {key: value for key, value in content.items() if key != "actorId"}
    if event.get("actorId"):
        content["actorId"] = event["actorId"]
    result = clean_event({"eventId": event["id"], "projectId": event["projectId"],
                          "workerId": thread["workerId"], "sessionId": thread["sessionId"],
                          "revision": event["seq"], "kind": kinds[event["kind"]],
                          "occurredAt": event["occurredAt"], "content": content})
    return {"event": result, "sourceRef": {"threadId": thread["id"],
                                           "eventId": event["id"], "seq": event["seq"]}}
