"""Activity-to-Flower input bridge and backend-shaped result candidates.

This module does not call the server or deliver awareness notes. The caller
must submit work-card candidates through the backend CAS operation.
"""

import argparse
import json
import sys
from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from pydantic import Field

from contracts import (
    CONTENT,
    ID,
    Analysis,
    ContextRequest,
    Event,
    EvidenceRef,
    Proposal,
    Revision,
    Session,
    Strict,
    Text,
    prepare,
    ref_key,
)
from coordinator import CoordinationFailure, coordinate


class BackendEvidenceRef(Strict):
    threadId: ID
    eventId: ID
    seq: Revision


class SourceRecord(Strict):
    flowerRef: EvidenceRef
    sourceRef: BackendEvidenceRef


class BridgeRequest(Strict):
    requestId: ID
    projectId: ID
    targetThreadId: ID
    question: Text
    evidenceRefs: list[BackendEvidenceRef] = Field(min_length=1, max_length=40)
    createdAt: Text


class Binding(Strict):
    projectId: ID
    threadId: ID
    workerId: ID
    sessionId: ID
    ownerId: ID
    title: Text
    featureTopic: Text
    relationship: Literal["alternative", "unspecified"]
    activitySeq: Revision
    evidenceRevision: Revision | None = None
    expectedVersion: Revision
    shared: Literal[True]
    deterministicStatus: Literal["queued", "active", "blocked", "idle", "done"]
    contributors: list[ID] = Field(max_length=16)


FlowerRefKey = tuple[str, str, str, int]


@dataclass(frozen=True)
class BridgeJob:
    request: dict
    snapshot: dict
    target_thread_id: str
    bindings_by_session: dict[str, dict]
    session_revisions: dict[str, int]
    source_refs: dict[FlowerRefKey, dict]
    producer_warnings: list


def build_job(request, activity_envelope, *, bindings, source_refs):
    """Build one two-session chain request from trusted thread bindings.

    `source_refs` is JSON-safe: each item is `{flowerRef:{workerId,sessionId,
    eventId,revision},sourceRef:{threadId,eventId,seq}}`.
    """
    request = BridgeRequest.model_validate(request)
    if not isinstance(activity_envelope, dict) or set(activity_envelope) != {
        "snapshot",
        "warnings",
    }:
        raise ValueError("Expected the Activity.snapshot envelope")
    snapshot = activity_envelope["snapshot"]
    warnings = activity_envelope["warnings"]
    if not isinstance(snapshot, dict) or not isinstance(warnings, list) or len(warnings) > 100:
        raise ValueError("Invalid activity snapshot or warning list")
    if len(json.dumps(warnings, allow_nan=False).encode("utf-8")) > 32_000:
        raise ValueError("Activity warnings exceed the bounded size")
    if not isinstance(bindings, (list, tuple)) or len(bindings) != 2:
        raise ValueError("Exactly two trusted thread bindings are required")
    bindings = [Binding.model_validate(item).model_dump() for item in bindings]
    if any(item["projectId"] != request.projectId for item in bindings):
        raise ValueError("Thread binding belongs to another project")
    by_thread = {item["threadId"]: item for item in bindings}
    by_session = {item["sessionId"]: item for item in bindings}
    if len(by_thread) != 2 or len(by_session) != 2:
        raise ValueError("Thread and session bindings must be unique")
    target = by_thread.get(request.targetThreadId)
    if not target:
        raise ValueError("Target thread is not one of the trusted shared bindings")
    if (
        type(snapshot.get("schemaVersion")) is not int
        or snapshot["schemaVersion"] != 1
        or snapshot.get("projectId") != request.projectId
        or not isinstance(snapshot.get("workers"), list)
        or not isinstance(snapshot.get("sessions"), list)
        or not isinstance(snapshot.get("events"), list)
        or len(snapshot["sessions"]) != 2
        or len(snapshot["workers"]) > 100
        or len(snapshot["events"]) > 40
    ):
        raise ValueError("Activity snapshot must contain the selected two sessions")

    sessions = {}
    for raw in snapshot["sessions"]:
        session = Session.model_validate(raw).model_dump()
        binding = by_session.get(session["sessionId"])
        if not binding or any(
            session[field] != binding[field]
            for field in ("workerId", "ownerId", "title", "featureTopic", "relationship")
        ):
            raise ValueError("Activity session does not match trusted selection metadata")
        evidence_revision = binding.get("evidenceRevision")
        if evidence_revision is None:
            evidence_revision = binding["activitySeq"]
        if session["revision"] != evidence_revision or evidence_revision > binding["activitySeq"]:
            raise ValueError("Activity evidence differs from the captured selected revision")
        sessions[session["sessionId"]] = session
    if len(sessions) != 2 or set(sessions) != set(by_session):
        raise ValueError("Activity and backend bindings select different sessions")

    workers = {}
    for worker in snapshot["workers"]:
        if not isinstance(worker, dict):
            raise TypeError("Invalid Activity worker row")
        worker_id, owner_id = worker.get("workerId"), worker.get("ownerId")
        if worker.get("projectId") != request.projectId or not isinstance(worker_id, str):
            raise ValueError("Activity worker belongs to another project")
        owners = {item["ownerId"] for item in bindings if item["workerId"] == worker_id}
        if (
            not owners
            or ("ownerId" in worker and owners != {owner_id})
            or worker_id in workers
        ):
            raise ValueError("Activity worker owner does not match trusted bindings")
        workers[worker_id] = {"workerId": worker_id, "projectId": request.projectId}
        if "ownerId" in worker:
            workers[worker_id]["ownerId"] = owner_id
    if set(workers) != {item["workerId"] for item in bindings}:
        raise ValueError("Activity worker roster does not match the selected sessions")

    refs = _source_map(source_refs)
    events, seen, seen_project_sequences, backend_to_flower = [], set(), set(), {}
    event_counts = {session_id: 0 for session_id in sessions}
    for raw in snapshot["events"]:
        event = Event.model_validate(raw).model_dump()
        binding = by_session.get(event["sessionId"])
        session = sessions.get(event["sessionId"])
        key = ref_key(event)
        source = refs.get(key)
        if (
            not binding
            or not session
            or event["projectId"] != request.projectId
            or event["workerId"] != binding["workerId"]
            or event["revision"] > session["revision"]
            or event["revision"] > binding["activitySeq"]
            or not source
            or source["threadId"] != binding["threadId"]
            or source["eventId"] != event["eventId"]
            or source["seq"] != event["revision"]
        ):
            raise ValueError("Activity event does not resolve to its captured backend source")
        content = event["content"]
        if set(content) - CONTENT[event["kind"]] - {"actorId"}:
            raise ValueError("Activity event contains unpermitted content")
        if "actorId" in content and (
            not isinstance(content["actorId"], str) or not content["actorId"]
        ):
            raise ValueError("Invalid event actor identity")
        event["content"] = {key: value for key, value in content.items() if key != "actorId"}
        event_counts[event["sessionId"]] += 1
        if event_counts[event["sessionId"]] > 20:
            raise ValueError("Activity snapshot exceeds the producer's 20-event session cap")
        backend_key = (source["threadId"], source["eventId"], source["seq"])
        if key in seen or backend_key in backend_to_flower:
            raise ValueError("Duplicate Activity source identity")
        if source["seq"] in seen_project_sequences:
            raise ValueError("Selected source events reuse a project sequence")
        seen.add(key)
        seen_project_sequences.add(source["seq"])
        backend_to_flower[backend_key] = key
        events.append(event)
    if seen != set(refs):
        raise ValueError("Source-reference list must cover exactly the selected Activity events")
    for session_id, session in sessions.items():
        matching = [event["revision"] for event in events if event["sessionId"] == session_id]
        if not matching or max(matching) != session["revision"]:
            raise ValueError("Activity session revision does not match its selected events")

    evidence_refs = []
    for source in request.evidenceRefs:
        key = backend_to_flower.get((source.threadId, source.eventId, source.seq))
        if not key:
            raise ValueError("Requested backend evidence is absent from Activity snapshot")
        evidence_refs.append(
            dict(zip(("workerId", "sessionId", "eventId", "revision"), key, strict=True))
        )
    chain_request = ContextRequest.model_validate(
        {
            "requestId": request.requestId,
            "projectId": request.projectId,
            "targetWorkerId": target["workerId"],
            "targetSessionId": target["sessionId"],
            "question": request.question,
            "evidenceRefs": evidence_refs,
            "createdAt": request.createdAt,
        }
    ).model_dump()
    chain_snapshot = {
        "schemaVersion": 1,
        "projectId": request.projectId,
        "workers": list(workers.values()),
        "sharedSessions": list(sessions.values()),
        "events": events,
    }
    prepare(chain_request, chain_snapshot)
    return BridgeJob(
        chain_request,
        chain_snapshot,
        target["threadId"],
        deepcopy(by_session),
        {session_id: item["revision"] for session_id, item in sessions.items()},
        refs,
        deepcopy(warnings),
    )


def coordinate_activity(request, activity_envelope, *, bindings, source_refs, state_dir=None):
    """Run the existing Flower chain on a bridged snapshot and map its report."""
    job = build_job(request, activity_envelope, bindings=bindings, source_refs=source_refs)
    options = {"state_dir": state_dir} if state_dir is not None else {}
    report = coordinate(job.request, job.snapshot, **options)
    result = map_report(job, report)
    result["state"] = "completed"
    result["flowerRuns"] = [
        {
            "stage": "session_analysis",
            "sessionId": summary["sessionId"],
            "runId": summary["runId"],
            "state": "finished:completed",
        }
        for summary in report["summaries"]
    ] + [{"stage": "coordination", "runId": report["runId"], "state": "finished:completed"}]
    return result


def map_report(job, report):
    """Return backend-shaped WorkCard updates and undelivered note candidates."""
    if not isinstance(job, BridgeJob) or not isinstance(report, dict):
        raise TypeError("Expected a BridgeJob and Flower report")
    if (
        report.get("requestId") != job.request["requestId"]
        or not isinstance(report.get("runId"), str)
        or not report["runId"].strip()
        or not isinstance(report.get("warnings"), list)
        or not isinstance(report.get("awarenessNotes"), list)
        or not isinstance(report.get("proposals"), list)
    ):
        raise ValueError("Flower report does not match the reserved request")
    summaries = report.get("summaries")
    if not isinstance(summaries, list) or len(summaries) != 2:
        raise ValueError("Expected one Flower summary for each selected session")
    updates, seen = [], set()
    for summary in summaries:
        if not isinstance(summary, dict):
            raise TypeError("Invalid Flower summary")
        session_id = summary.get("sessionId")
        binding = job.bindings_by_session.get(session_id)
        if (
            not binding
            or session_id in seen
            or summary.get("projectId") != job.request["projectId"]
            or summary.get("workerId") != binding["workerId"]
            or summary.get("revision") != job.session_revisions[session_id]
        ):
            raise ValueError("Flower summary identity or evidence revision is stale")
        analysis = Analysis.model_validate(
            {
                key: summary.get(key)
                for key in (
                    "task",
                    "approach",
                    "workState",
                    "progress",
                    "blockers",
                    "recentOutcome",
                    "evidenceRefs",
                )
            }
            | {"warnings": []}
        )
        citations = _backend_refs(job, analysis.evidenceRefs, session_id)
        if not isinstance(summary.get("runId"), str) or not summary["runId"].strip():
            raise ValueError("Flower session run ID is required")
        seen.add(session_id)
        updates.append(
            {
                "threadId": binding["threadId"],
                "expectedVersion": binding["expectedVersion"],
                "sourceActivitySeq": binding["activitySeq"],
                "card": {
                    "currentTask": analysis.task,
                    "progress": analysis.progress,
                    "blockers": analysis.blockers,
                    "status": binding["deterministicStatus"],
                    "summaryJobId": job.request["requestId"],
                    "recentVerifiedOutcome": analysis.recentOutcome,
                    "contributors": list(binding["contributors"]),
                    "evidenceRefs": citations,
                    "generatedAt": _backend_timestamp(summary.get("generatedAt")),
                },
                "analysisMetadata": {
                    "approach": analysis.approach,
                    "modelWorkState": analysis.workState,
                    "sessionRunId": summary["runId"],
                    "chainRunId": report["runId"],
                },
            }
        )
    if seen != set(job.bindings_by_session):
        raise ValueError("Flower report omitted a selected session summary")

    notes = []
    for note in report.get("awarenessNotes", []):
        if not isinstance(note, dict):
            raise TypeError("Invalid Flower awareness note")
        source = job.bindings_by_session.get(note.get("sourceSessionId"))
        target = job.bindings_by_session.get(note.get("targetSessionId"))
        if (
            not source
            or not target
            or target["threadId"] != job.target_thread_id
            or source["sessionId"] == target["sessionId"]
            or note.get("projectId") != job.request["projectId"]
            or note.get("sourceWorkerId") != source["workerId"]
            or note.get("targetWorkerId") != target["workerId"]
            or note.get("sourceRevision") != job.session_revisions[source["sessionId"]]
            or note.get("featureTopic") != source["featureTopic"]
            or note.get("state") != "pending"
            or not isinstance(note.get("text"), str)
            or not note["text"].strip()
        ):
            raise ValueError("Awareness note does not match the selected source and target")
        citations = _backend_refs(job, note.get("evidenceRefs"))
        if {item["threadId"] for item in citations} != {source["threadId"], target["threadId"]}:
            raise ValueError("Awareness note must cite source and target threads")
        notes.append(
            {
                "noteId": note["noteId"],
                "sourceThreadId": source["threadId"],
                "sourceActivitySeq": source["activitySeq"],
                "targetThreadId": target["threadId"],
                "targetActivitySeq": target["activitySeq"],
                "featureTopic": source["featureTopic"],
                "text": note["text"],
                "evidenceRefs": citations,
                "candidateState": "pending",
                "deliveryState": "not_attempted",
            }
        )

    proposals = []
    for raw in report["proposals"]:
        if not isinstance(raw, dict):
            raise TypeError("Invalid Flower proposal")
        proposal = Proposal.model_validate(
            {key: raw.get(key) for key in ("kind", "text", "rationale", "evidenceRefs")}
        )
        target = job.bindings_by_session.get(raw.get("targetSessionId"))
        if (
            not target
            or target["threadId"] != job.target_thread_id
            or raw.get("projectId") != job.request["projectId"]
            or raw.get("requestId") != job.request["requestId"]
            or raw.get("targetWorkerId") != target["workerId"]
            or raw.get("state") != "proposed"
        ):
            raise ValueError("Proposal does not match the selected target")
        proposals.append(
            {
                "proposalId": raw.get("proposalId"),
                "projectId": job.request["projectId"],
                "requestId": job.request["requestId"],
                "targetThreadId": target["threadId"],
                "targetSessionId": target["sessionId"],
                "kind": proposal.kind,
                "text": proposal.text,
                "rationale": proposal.rationale,
                "evidenceRefs": _backend_refs(job, proposal.evidenceRefs),
                "candidateState": "proposed",
                "requiresOwnerApproval": True,
            }
        )

    return {
        "state": "mapped",
        "requestId": job.request["requestId"],
        "coordinationRunId": report["runId"],
        "workCardUpdates": updates,
        "awarenessNoteCandidates": notes,
        "proposalCandidates": proposals,
        "producerWarnings": deepcopy(job.producer_warnings),
        "flowerWarnings": deepcopy(report.get("warnings", [])),
    }


def _source_map(source_refs):
    if not isinstance(source_refs, list):
        raise TypeError("source_refs must be a JSON-safe list of source records")
    result = {}
    for raw in source_refs:
        record = SourceRecord.model_validate(raw)
        flower = ref_key(record.flowerRef)
        backend = record.sourceRef.model_dump()
        if backend["eventId"] != flower[2] or backend["seq"] != flower[3] or flower in result:
            raise ValueError("Source event identity or sequence is inconsistent")
        result[flower] = backend
    return result


def _backend_refs(job, refs, expected_session=None):
    if not isinstance(refs, list) or not refs:
        raise ValueError("Flower output must cite source events")
    result, seen = [], set()
    for raw in refs:
        ref = EvidenceRef.model_validate(raw)
        key = ref_key(ref)
        source = job.source_refs.get(key)
        binding = job.bindings_by_session.get(ref.sessionId)
        if not source or not binding or source["threadId"] != binding["threadId"]:
            raise ValueError("Flower cited an unknown backend source event")
        if expected_session and ref.sessionId != expected_session:
            raise ValueError("Session summary cited another session")
        identity = (source["threadId"], source["eventId"], source["seq"])
        if identity in seen:
            raise ValueError("Duplicate backend source citation")
        seen.add(identity)
        result.append(deepcopy(source))
    return result


def _backend_timestamp(value):
    if not isinstance(value, str):
        raise TypeError("Flower summary timestamp is missing")
    try:
        stamp = datetime.fromisoformat(value)
    except ValueError as error:
        raise ValueError("Invalid Flower summary timestamp") from error
    if stamp.utcoffset() is None or stamp.utcoffset().total_seconds() != 0:
        raise ValueError("Flower summary timestamp must be UTC")
    return stamp.astimezone(UTC).isoformat().replace("+00:00", "Z")


def main():
    parser = argparse.ArgumentParser(description="Run the Puff activity-to-Flower bridge")
    parser.add_argument("--state-dir", help="Private runtime directory outside AgentApp projects")
    args = parser.parse_args()
    raw = sys.stdin.read(400_001)
    if len(raw.encode("utf-8")) > 400_000:
        print(json.dumps({"state": "failed", "error": "Bridge input exceeds the size limit"}))
        return 2
    try:
        envelope = json.loads(raw)
        if not isinstance(envelope, dict) or set(envelope) != {
            "request",
            "activitySnapshot",
            "bindings",
            "sourceRefs",
        }:
            raise ValueError("Invalid bridge envelope")
        result = coordinate_activity(
            envelope["request"],
            envelope["activitySnapshot"],
            bindings=envelope["bindings"],
            source_refs=envelope["sourceRefs"],
            state_dir=args.state_dir,
        )
        print(json.dumps(result))
        return 0
    except CoordinationFailure as error:
        outcome = error.outcome
        print(
            json.dumps(
                {
                    "state": outcome.get("state", "failed"),
                    "error": outcome.get("error", "Flower coordination failed"),
                    "runIds": outcome.get("runIds", []),
                    "terminalStates": outcome.get("terminalStates", {}),
                    "remoteUnresolved": outcome.get("remoteUnresolved", []),
                }
            )
        )
        return 1
    except Exception:  # noqa: BLE001 -- hide provider/request details at the CLI boundary
        # Never echo request bodies, provider responses, or exception details.
        print(json.dumps({"state": "failed", "error": "Invalid or unavailable bridge request"}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
