"""Deterministic reduction and bounded, explicitly selected evidence projection."""

from copy import deepcopy
from datetime import datetime
import json


TEXT_FIELDS = ("objective", "approach", "currentStep", "blocker", "recentOutcome")
CONTENT = {
    "message": {"role", "text", "actorId"},
    "activity": {"toolName", "toolStatus", "actorId"},
    "status": {"transition", "instructionId", "actorId", *TEXT_FIELDS},
}
TRANSITIONS = {"queued", "started", "progress", "blocked", "completed", "failed", "stopped"}


def clean_event(event):
    """Project an already owner-selected event; never inspect arbitrary payloads."""
    fields = ("eventId", "projectId", "workerId", "sessionId", "revision", "kind", "occurredAt")
    result = {key: event[key] for key in fields}
    if any(not isinstance(result[key], str) or not result[key] for key in fields if key != "revision"):
        raise ValueError("Invalid event identity")
    if type(result["revision"]) is not int or result["revision"] < 0:
        raise ValueError("Invalid revision")
    stamp = datetime.fromisoformat(result["occurredAt"].replace("Z", "+00:00"))
    if stamp.utcoffset() is None or stamp.utcoffset().total_seconds() != 0:
        raise ValueError("Expected UTC timestamp")
    if result["kind"] not in CONTENT or not isinstance(event.get("content"), dict):
        raise ValueError("Invalid event kind/content")
    content = {key: value for key, value in event["content"].items() if key in CONTENT[result["kind"]]}
    if any(not isinstance(value, str) for value in content.values()):
        raise ValueError("Content fields must be strings")
    if sum(len(value) for value in content.values()) > 8000:
        raise ValueError("Event text exceeds 8000 characters")
    if result["kind"] == "message" and content.get("role") not in {"user", "assistant"}:
        raise ValueError("Only selected user/assistant messages are permitted")
    if result["kind"] == "status":
        if content.get("transition") not in TRANSITIONS:
            raise ValueError("Unknown status transition")
        if content["transition"] in {"queued", "started"} and not content.get("instructionId"):
            raise ValueError("Instruction identity required")
    return {**result, "content": content}


def reference(event):
    return {key: event[key] for key in ("workerId", "sessionId", "eventId", "revision")}


class Activity:
    """One project, explicit shared roster, project-sequence replay per session.

    Hub authorization happens before this boundary. A registry entry alone does
    not opt a session in: `shared: true` must be supplied by the trusted caller.
    """

    def __init__(self, project_id, sessions, workers):
        self.project_id = project_id
        self.workers = {}
        for worker in workers:
            if worker.get("projectId") != project_id or worker.get("state") not in {"online", "offline"}:
                raise ValueError("Invalid worker")
            if worker["workerId"] in self.workers:
                raise ValueError("Duplicate worker")
            self.workers[worker["workerId"]] = {
                field: worker[field] for field in ("workerId", "projectId", "ownerId", "lastSeenAt", "state")}
        self.sessions = {}
        for session in sessions:
            key = (session["workerId"], session["sessionId"])
            if key in self.sessions:
                raise ValueError("Duplicate session")
            if key[0] not in self.workers or self.workers[key[0]]["ownerId"] != session["ownerId"]:
                raise ValueError("Unknown worker/owner mapping")
            if session.get("relationship") not in {"alternative", "unspecified"}:
                raise ValueError("Invalid relationship")
            for field in ("workerId", "sessionId", "ownerId", "title", "featureTopic"):
                if not isinstance(session.get(field), str) or not session[field]:
                    raise ValueError("Invalid session metadata")
            self.sessions[key] = deepcopy(session)
        self.events = {key: {} for key in self.sessions}
        self.cards = {key: self._reduce(key) for key in self.sessions}
        self.summaries = {}

    def ingest(self, raw):
        key = (raw.get("workerId"), raw.get("sessionId"))
        if raw.get("projectId") != self.project_id or key not in self.sessions:
            raise ValueError("Unknown project/session/worker mapping")
        if self.sessions[key].get("shared") is not True:
            return False
        event = clean_event(raw)
        for records in self.events.values():
            for previous in records.values():
                if previous["eventId"] == event["eventId"]:
                    if previous != event:
                        raise ValueError("Conflicting event identity")
                    return False
        previous = self.events[key].get(event["revision"])
        if previous is not None:
            raise ValueError("Conflicting revision")
        self.events[key][event["revision"]] = event
        self.cards[key] = self._reduce(key)
        summary = self.summaries.get(key)
        if summary and summary["revision"] == self.cards[key]["revision"]:
            self.cards[key].update(summary["fields"])
        return True

    def _reduce(self, key):
        card = dict.fromkeys(TEXT_FIELDS, "")
        card.update(workerId=key[0], sessionId=key[1], revision=-1, status="unknown",
                    contributors=[], upNext=[], evidenceRefs=[])
        for event in sorted(self.events.get(key, {}).values(), key=lambda item: item["revision"]):
            content = event["content"]
            card["revision"] = event["revision"]
            card["evidenceRefs"].append(reference(event))
            if content.get("actorId") and content["actorId"] not in card["contributors"]:
                card["contributors"].append(content["actorId"])
            if event["kind"] != "status":
                continue
            transition = content["transition"]
            if transition == "queued":
                card["upNext"] = [item for item in card["upNext"] if item["instructionId"] != content["instructionId"]]
                card["upNext"].append({key: content[key] for key in ("instructionId", *TEXT_FIELDS) if key in content})
                continue
            if transition == "started":
                pending = next((item for item in card["upNext"] if item["instructionId"] == content["instructionId"]), {})
                card.update({key: pending[key] for key in TEXT_FIELDS if key in pending})
                card["upNext"] = [item for item in card["upNext"] if item["instructionId"] != content["instructionId"]]
                card["status"] = "running"
                card["blocker"] = ""
            if transition in {"blocked", "completed", "failed", "stopped"}:
                card["status"] = transition
            card.update({key: content[key] for key in TEXT_FIELDS if key in content})
        for field in TEXT_FIELDS:
            card[field] = card[field][:1000]
        card["evidenceRefs"] = card["evidenceRefs"][-20:]
        return card

    def card(self, key):
        return deepcopy(self.cards[key])

    def set_sharing(self, key, shared):
        self.sessions[key]["shared"] = shared is True
        if not shared:
            self.events[key].clear()
            self.summaries.pop(key, None)
            self.cards[key] = self._reduce(key)

    def apply_summary(self, key, revision, fields, evidence_refs):
        """Accept only current, source-backed descriptive fields, never status."""
        if self.sessions[key].get("shared") is not True or revision != self.cards[key]["revision"]:
            return False
        if not fields or set(fields) - set(TEXT_FIELDS):
            raise ValueError("Summary may change descriptive fields only")
        if any(not isinstance(value, str) or len(value) > 1000 for value in fields.values()):
            raise ValueError("Invalid summary text")
        known = self.cards[key]["evidenceRefs"]
        if not evidence_refs or any(ref not in known for ref in evidence_refs):
            raise ValueError("Unknown summary evidence")
        if self.summaries.get(key, {}).get("revision", -1) >= revision:
            return False
        self.summaries[key] = {"revision": revision, "fields": deepcopy(fields)}
        self.cards[key].update(fields)
        return True

    def snapshot(self, requested):
        """Return {snapshot: ProjectSnapshot projection, warnings: [...]}.

        Descriptive model cards stay outside the evidence snapshot until Agent 1
        maps them to the published Summary record with a real runId.
        """
        keys = list(dict.fromkeys(requested))
        if any(key not in self.sessions for key in keys):
            raise ValueError("Unknown requested session")
        keys = [key for key in keys if self.sessions[key].get("shared") is True]
        workers, sessions, events, warnings = {}, [], [], []
        for key in keys:
            session = self.sessions[key]
            if key[0] in workers and workers[key[0]]["ownerId"] != session["ownerId"]:
                raise ValueError("Conflicting worker owner")
            records = sorted(self.events[key].values(), key=lambda item: item["revision"])
            if not records:
                continue
            workers[key[0]] = deepcopy(self.workers[key[0]])
            sessions.append({**{field: session[field] for field in
                             ("workerId", "sessionId", "ownerId", "title", "featureTopic", "relationship")},
                             "revision": self.cards[key]["revision"], "status": self.cards[key]["status"]})
            if len(records) > 20:
                warnings.append({"workerId": key[0], "sessionId": key[1], "code": "events_truncated",
                                 "omitted": len(records) - 20})
            events.extend(deepcopy(records[-20:]))
        return {"snapshot": {"schemaVersion": 1, "projectId": self.project_id,
                             "workers": list(workers.values()), "sessions": sessions, "events": events,
                             "summaries": [], "proposals": [], "awarenessNotes": [], "decisions": [],
                             "deliveries": []}, "warnings": warnings}

    def classifier_state(self, key, previous):
        if self.sessions[key].get("shared") is not True:
            raise ValueError("Session is not shared")
        return json.dumps({"previousWorkCard": previous, "currentWorkCard": self.card(key),
                           **self.snapshot([key])}, separators=(",", ":"))
