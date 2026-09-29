"""Explicit provisional adapter for mvp-spec.md Shared contract v1 at 5c8e111931.

The current backend's Event.seq and Thread.activitySeq need an agreed mapping;
they are not automatically per-session revisions. See README's C3/C8 limits.
Nothing here changes or owns the shared server contract.
"""

import json
import re
from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

Text = Annotated[str, Field(min_length=1, max_length=2000)]
ID = Annotated[str, Field(min_length=1, max_length=160)]
Revision = Annotated[int, Field(strict=True, ge=0)]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class EvidenceRef(Strict):
    workerId: ID
    sessionId: ID
    eventId: ID
    revision: Revision


class ContextRequest(Strict):
    requestId: ID
    projectId: ID
    targetWorkerId: ID
    targetSessionId: ID
    question: Text
    evidenceRefs: list[EvidenceRef] = Field(max_length=40)
    createdAt: Text


class Session(Strict):
    workerId: ID
    sessionId: ID
    ownerId: ID
    title: Text
    featureTopic: Text
    relationship: Literal["alternative", "unspecified"]
    revision: Revision
    status: Text


class Event(Strict):
    eventId: ID
    projectId: ID
    workerId: ID
    sessionId: ID
    revision: Revision
    kind: Literal["message", "activity", "status"]
    occurredAt: Text
    content: dict


class Analysis(Strict):
    task: Text
    approach: Text
    workState: Literal["planned", "ongoing", "completed", "unknown"]
    progress: Text
    blockers: list[Text] = Field(max_length=10)
    evidenceRefs: list[EvidenceRef] = Field(min_length=1, max_length=20)
    warnings: list[Text] = Field(max_length=10)


class Awareness(Strict):
    sourceSessionId: ID
    text: Text
    evidenceRefs: list[EvidenceRef] = Field(min_length=2, max_length=40)


class Proposal(Strict):
    kind: Literal["overlap", "alternative", "dependency", "reuse", "context"]
    text: Text
    rationale: Text
    evidenceRefs: list[EvidenceRef] = Field(min_length=1, max_length=40)


class Finding(Strict):
    relationship: Literal["alternative", "overlap", "dependency", "reuse", "none", "uncertain"]
    awareness: Awareness | None
    proposal: Proposal | None
    warnings: list[Text] = Field(max_length=10)


def utc_now():
    return datetime.now(UTC).isoformat()


def ref_key(ref):
    if isinstance(ref, EvidenceRef):
        ref = ref.model_dump()
    return tuple(ref[k] for k in ("workerId", "sessionId", "eventId", "revision"))


def validate_refs(refs, allowed):
    if any(ref_key(ref) not in allowed for ref in refs):
        raise ValueError("Unknown or stale evidence reference")


def reject_secrets(value):
    # A backstop, not a confidentiality proof. The caller must select permitted content.
    text = json.dumps(value)
    if re.search(
        r"(?i)(bearer\s+\S+|-----BEGIN .*PRIVATE KEY|sk-[a-z0-9_-]{12,}|"
        r"(?:api[_-]?key|password|secret|access[_-]?token)\s*[=:]\s*\S+)",
        text,
    ):
        raise ValueError("Potential credential in permitted evidence; input rejected")


def prepare(request, snapshot):
    """Select exactly two requested, opted-in sessions, never infer sharing."""
    request = ContextRequest.model_validate(request).model_dump()
    if not isinstance(snapshot, dict):
        raise TypeError("Snapshot must be an object")
    for field, limit in (("sharedSessions", 100), ("workers", 100), ("events", 2000)):
        if not isinstance(snapshot.get(field), list) or len(snapshot[field]) > limit:
            raise ValueError("Snapshot collection exceeds the bounded adapter limit")
    if snapshot.get("schemaVersion") != 1 or snapshot.get("projectId") != request["projectId"]:
        raise ValueError("Wrong schema version or project")
    # sharedSessions is the explicit temporary name for the spec's shared-session list.
    sessions = [Session.model_validate(s).model_dump() for s in snapshot["sharedSessions"]]
    by_id = {s["sessionId"]: s for s in sessions}
    if len(by_id) != len(sessions):
        raise ValueError("Duplicate shared session identity")
    target = by_id.get(request["targetSessionId"])
    if not target or target["workerId"] != request["targetWorkerId"]:
        raise ValueError("Target is not an opted-in mapped session")
    selected_ids = {r["sessionId"] for r in request["evidenceRefs"]}
    selected_ids.add(target["sessionId"])
    if len(selected_ids) != 2 or not selected_ids.issubset(by_id):
        raise ValueError("Supply evidence references for exactly two shared sessions")
    selected = [by_id[sid] for sid in sorted(selected_ids)]
    workers = {(w["workerId"], w["projectId"], w["ownerId"]) for w in snapshot["workers"]}
    if any((s["workerId"], request["projectId"], s["ownerId"]) not in workers for s in selected):
        raise ValueError("Unknown project/worker/owner mapping")
    inputs, warnings, seen = [], [], set()
    for session in selected:
        events = []
        for raw in snapshot["events"]:
            if raw.get("sessionId") != session["sessionId"]:
                continue
            event = Event.model_validate(raw).model_dump()
            if (
                event["projectId"] != request["projectId"]
                or event["workerId"] != session["workerId"]
                or event["revision"] > session["revision"]
            ):
                raise ValueError("Event does not match shared session snapshot")
            if event["eventId"] in seen:
                raise ValueError("Duplicate event ID")
            seen.add(event["eventId"])
            fields = {
                "message": {"role", "text"},
                "activity": {"toolName", "status"},
                "status": {"status"},
            }[event["kind"]]
            if set(event["content"]) - fields:
                raise ValueError("Unpermitted event content fields")
            if not event["content"] or any(
                not isinstance(v, str) or len(v) > 8000 for v in event["content"].values()
            ):
                raise ValueError("Event content must contain bounded strings")
            if event["kind"] == "message" and event["content"].get("role") not in {
                "user",
                "assistant",
            }:
                raise ValueError("Only selected user/assistant messages are permitted")
            reject_secrets(event["content"])
            events.append(event)
        events.sort(key=lambda e: (e["revision"], e["eventId"]))
        if len(events) > 20:
            warnings.append(f"Truncated {session['sessionId']} to 20 recent events")
        if not events:
            raise ValueError("Selected session has no permitted evidence")
        inputs.append(
            {
                "schemaVersion": 1,
                "projectId": request["projectId"],
                "session": session,
                "events": events[-20:],
            }
        )
    allowed = {ref_key(e) for item in inputs for e in item["events"]}
    validate_refs(request["evidenceRefs"], allowed)
    # Omit arbitrary UI snapshot state, delivery machinery and unrelated history.
    prepared = {"schemaVersion": 1, "request": request, "inputs": inputs, "warnings": warnings}
    reject_secrets(prepared)
    if len(json.dumps(prepared).encode()) > 350_000:
        raise ValueError("Chain input exceeds total byte cap")
    return prepared


def validate_analysis(result, item):
    analysis = Analysis.model_validate(result).model_dump()
    validate_refs(analysis["evidenceRefs"], {ref_key(e) for e in item["events"]})
    reject_secrets(analysis)
    return analysis


def make_report(prepared, analyses, result, run_id):
    finding = Finding.model_validate(result).model_dump()
    request = prepared["request"]
    sessions = {item["session"]["sessionId"]: item["session"] for item in prepared["inputs"]}
    allowed = {ref_key(r) for a in analyses for r in a["result"]["evidenceRefs"]}
    same_topic = len({s["featureTopic"] for s in sessions.values()}) == 1
    alternatives = same_topic and all(s["relationship"] == "alternative" for s in sessions.values())
    if alternatives and (
        finding["relationship"] == "overlap"
        or (finding["proposal"] and finding["proposal"]["kind"] == "overlap")
    ):
        raise ValueError("Deliberate alternatives cannot be labeled duplicates")
    if not same_topic and (
        finding["relationship"] != "none" or finding["awareness"] or finding["proposal"]
    ):
        raise ValueError("Unrelated topics cannot generate an exchange")
    if finding["relationship"] == "none" and (finding["awareness"] or finding["proposal"]):
        raise ValueError("No relationship cannot contain a finding")
    summaries = []
    for item, analysis in zip(prepared["inputs"], analyses, strict=True):
        session = item["session"]
        summaries.append(
            {
                "summaryId": f"{request['requestId']}:{session['sessionId']}",
                "projectId": request["projectId"],
                "workerId": session["workerId"],
                "sessionId": session["sessionId"],
                "revision": session["revision"],
                **{k: v for k, v in analysis["result"].items() if k != "warnings"},
                "generatedAt": utc_now(),
                "runId": analysis["runId"],
            }
        )
    notes, proposals = [], []
    if finding["awareness"]:
        note = finding["awareness"]
        validate_refs(note["evidenceRefs"], allowed)
        source = sessions.get(note["sourceSessionId"])
        if not source or source["sessionId"] == request["targetSessionId"]:
            raise ValueError("Invalid awareness source")
        if {r["sessionId"] for r in note["evidenceRefs"]} != set(sessions):
            raise ValueError("Awareness must cite source and target evidence")
        # Conservative backstop; model output is never delivery authorization.
        if re.search(
            r"(?i)\b(stop|abandon|switch|must|should|please|instead|implement|replace)\b",
            note["text"],
        ):
            raise ValueError("Potential work redirection must be a proposal")
        notes.append(
            {
                "noteId": f"{request['requestId']}:awareness",
                "projectId": request["projectId"],
                "sourceWorkerId": source["workerId"],
                "sourceSessionId": source["sessionId"],
                "sourceRevision": source["revision"],
                "targetWorkerId": request["targetWorkerId"],
                "targetSessionId": request["targetSessionId"],
                "featureTopic": source["featureTopic"],
                "text": note["text"],
                "evidenceRefs": note["evidenceRefs"],
                "state": "pending",
            }
        )
    if finding["proposal"]:
        validate_refs(finding["proposal"]["evidenceRefs"], allowed)
        proposals.append(
            {
                **finding["proposal"],
                "proposalId": f"{request['requestId']}:proposal",
                "projectId": request["projectId"],
                "requestId": request["requestId"],
                "targetWorkerId": request["targetWorkerId"],
                "targetSessionId": request["targetSessionId"],
                "version": 1,
                "state": "proposed",
            }
        )
    report = {
        "requestId": request["requestId"],
        "runId": run_id,
        "summaries": summaries,
        "awarenessNotes": notes,
        "proposals": proposals,
        "warnings": prepared["warnings"]
        + finding["warnings"]
        + [w for a in analyses for w in a["result"]["warnings"]],
    }
    reject_secrets(report)
    return report
