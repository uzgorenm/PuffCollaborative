"""Puff analysis worker: coordination server events -> Activity -> Jev -> Flower -> work cards.

Runs as the server's `analysis` identity. It polls the project replay route,
feeds selected thread events to the Activity reducer, asks Jev whether the change
is worth a refresh, runs the Flower chain through `bridge.coordinate_activity`
for the changed thread and its partner thread, then writes both work cards back
with `PUT /threads/:id/work-card`.

Awareness-note delivery into the target OpenCode session is not a server route
yet; notes go to `deliver_note`, which records them under the state directory.

    python worker.py --config worker.json

Credentials come from PUFF_ANALYSIS_USER / PUFF_ANALYSIS_PASSWORD (environment
or the git-ignored .env next to this file), never from the config file.
"""

import argparse
import asyncio
import base64
import json
import os
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

from activity.coordination import selected_event
from activity.jev import Jev, Refresh
from activity.pipeline import Activity
from bridge import coordinate_activity
from coordinator import CoordinationFailure

HERE = Path(__file__).resolve().parent
# Only these kinds advance Thread.activitySeq on the server; see bridge README.
ADVANCING = {"comment.created", "run.tool", "run.output"}
MAX_EVENTS_PER_THREAD = 20


def log(message, **fields):
    stamp = datetime.now(UTC).strftime("%H:%M:%S")
    extra = " ".join(f"{key}={value}" for key, value in fields.items())
    print(f"[{stamp}] {message} {extra}".rstrip(), flush=True)


def env(name):
    if os.environ.get(name):
        return os.environ[name]
    try:
        for line in (HERE / ".env").read_text(encoding="utf-8").splitlines():
            key, _, value = line.strip().partition("=")
            if key == name and value:
                return value.strip().strip('"')
    except OSError:
        pass
    return None


class Server:
    def __init__(self, base_url, username, password, timeout=15):
        self.base = base_url.rstrip("/") + "/api/coordination/v1"
        token = base64.b64encode(f"{username}:{password}".encode()).decode()
        self.headers = {"Authorization": "Basic " + token, "Content-Type": "application/json"}
        self.timeout = timeout

    def call(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        request = Request(self.base + path, data=data, method=method, headers=self.headers)
        try:
            with urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read() or b"null")
        except HTTPError as error:
            detail = error.read(2000).decode("utf-8", "replace")
            raise RuntimeError(f"{method} {path} -> {error.code}: {detail}") from None

    def replay(self, project_id, after):
        return self.call("GET", f"/projects/{quote(project_id)}/events?after={after}&limit=256")

    def thread(self, thread_id):
        return self.call("GET", f"/threads/{quote(thread_id)}")

    def put_work_card(self, update):
        body = {key: update[key] for key in ("expectedVersion", "sourceActivitySeq", "card")}
        return self.call("PUT", f"/threads/{quote(update['threadId'])}/work-card", body)


def content_for(event):
    """Select the model-visible fields of one server event; never copy raw payloads."""
    payload, kind = event.get("payload") or {}, event["kind"]
    if kind == "instruction.submitted":
        return {
            "transition": "queued",
            "instructionId": event.get("instructionId"),
            "objective": str(payload.get("text", ""))[:1000],
        }
    if kind == "run.started":
        return {"transition": "started", "instructionId": event.get("instructionId")}
    if kind in {"run.completed", "run.failed", "run.cancelled"}:
        return {
            "transition": {
                "run.completed": "completed",
                "run.failed": "failed",
                "run.cancelled": "stopped",
            }[kind]
        }
    if kind == "run.tool":
        return {
            "toolName": str(payload.get("toolName", "tool")),
            "toolStatus": str(payload.get("status", "started")),
        }
    if kind == "run.output":
        return {"role": "assistant", "text": str(payload.get("text", ""))[:8000]}
    if kind == "comment.created":
        return {"role": "user", "text": str(payload.get("body", ""))[:8000]}
    return None


def card_status(card):
    status = card.get("status")
    if status == "running":
        return "active"
    if status == "blocked":
        return "blocked"
    if status == "completed":
        return "done"
    return "queued" if card.get("upNext") else "idle"


class Worker:
    def __init__(self, config, server, jev, state_dir):
        self.config, self.server, self.jev = config, server, jev
        self.project_id = config["projectId"]
        self.selected = config["threads"]  # threadId -> {featureTopic, relationship}
        self.state_dir = Path(state_dir)
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.refresh = Refresh(
            debounce=config.get("debounceSeconds", 2), fallback=config.get("fallbackSeconds", 15)
        )
        self.threads = {}  # threadId -> Thread
        self.events = {}  # threadId -> list of selected {event, sourceRef, kind}
        self.activity = None
        self.cursor = -1
        self.busy = set()

    # -- setup ---------------------------------------------------------------
    def load_threads(self):
        for thread_id in self.selected:
            thread = self.server.thread(thread_id)["thread"]
            if thread["projectId"] != self.project_id:
                raise ValueError(f"Thread {thread_id} belongs to another project")
            self.threads[thread_id] = thread
            self.events.setdefault(thread_id, [])
        if len(self.threads) != 2:
            raise ValueError("The worker currently pairs exactly two shared threads")
        self.activity = self._activity(self.threads)

    def _activity(self, threads):
        workers, sessions = {}, []
        for thread_id, thread in threads.items():
            meta = self.selected[thread_id]
            workers.setdefault(
                thread["workerId"],
                {
                    "workerId": thread["workerId"],
                    "projectId": self.project_id,
                    "ownerId": thread["createdBy"],
                    "lastSeenAt": thread["createdAt"],
                    "state": "online",
                },
            )
            sessions.append(
                {
                    "workerId": thread["workerId"],
                    "sessionId": thread["sessionId"],
                    "ownerId": thread["createdBy"],
                    "title": thread["title"],
                    "featureTopic": meta["featureTopic"],
                    "relationship": meta.get("relationship", "alternative"),
                    "shared": True,
                }
            )
        return Activity(self.project_id, sessions, list(workers.values()))

    def key(self, thread_id):
        thread = self.threads[thread_id]
        return (thread["workerId"], thread["sessionId"])

    def partner(self, thread_id):
        return next(other for other in self.threads if other != thread_id)

    # -- ingest ----------------------------------------------------------------
    async def poll(self):
        while True:
            page = await asyncio.to_thread(self.server.replay, self.project_id, self.cursor)
            for event in page["events"]:
                try:
                    await self.ingest(event)
                except (KeyError, TypeError, ValueError) as error:
                    log("skip event", seq=event.get("seq"), kind=event.get("kind"), error=error)
            self.cursor = page["cursor"]
            if not page["hasMore"]:
                return

    async def ingest(self, event):
        thread_id = event.get("threadId")
        if thread_id not in self.threads:
            return
        content = content_for(event)
        if content is None:
            return
        thread = self.threads[thread_id]
        if event["kind"] in ADVANCING:
            thread["activitySeq"] = max(thread["activitySeq"], event["seq"])
        # Live ingestion only needs a monotonic revision; the capture-time check
        # against the server's activitySeq happens again in run_chain.
        live_thread = {**thread, "activitySeq": max(thread["activitySeq"], event["seq"])}
        selected = selected_event(event, live_thread, content, shared=True)
        if selected is None:
            return
        self.events[thread_id].append({**selected, "kind": event["kind"]})
        key = self.key(thread_id)
        previous = self.activity.card(key)
        if not self.activity.ingest(selected["event"]):
            return
        revision = self.activity.card(key)["revision"]
        if self.refresh.observe(key, revision, time.monotonic()):
            log("activity", thread=thread_id, seq=event["seq"], kind=event["kind"])
            state = self.activity.classifier_state(key, previous)
            asyncio.create_task(self.classify(key, revision, state))

    async def classify(self, key, revision, state):
        label = await self.jev.classify(state)
        self.refresh.classified(key, revision, label)
        log("jev", session=key[1], revision=revision, label=label or "fallback")

    # -- chain -----------------------------------------------------------------
    async def run_due(self):
        for intent in self.refresh.due(time.monotonic()):
            thread_id = next(
                t for t in self.threads if self.key(t) == (intent["workerId"], intent["sessionId"])
            )
            pair = frozenset((thread_id, self.partner(thread_id)))
            if pair in self.busy:
                continue
            self.busy.add(pair)
            asyncio.create_task(self.run_chain(thread_id, intent["reason"], pair))

    async def run_chain(self, source_id, reason, pair):
        target_id = self.partner(source_id)
        try:
            job = await asyncio.to_thread(self.capture, source_id, target_id)
            if job is None:
                return
            log(
                "flower chain start",
                source=source_id,
                target=target_id,
                reason=reason,
                request=job["request"]["requestId"],
            )
            started = time.monotonic()
            result = await asyncio.to_thread(
                coordinate_activity,
                job["request"],
                job["activitySnapshot"],
                bindings=job["bindings"],
                source_refs=job["sourceRefs"],
                state_dir=str(self.state_dir / "flower"),
            )
            log(
                "flower chain done",
                run=result["coordinationRunId"],
                seconds=round(time.monotonic() - started, 1),
                notes=len(result["awarenessNoteCandidates"]),
            )
            for update in result["workCardUpdates"]:
                try:
                    card = await asyncio.to_thread(self.server.put_work_card, update)
                    log("work card updated", thread=update["threadId"], version=card.get("version"))
                except RuntimeError as error:
                    log("work card rejected", thread=update["threadId"], error=error)
            for note in result["awarenessNoteCandidates"]:
                await asyncio.to_thread(self.deliver_note, note, result)
            for proposal in result["proposalCandidates"]:
                self.record("proposals.jsonl", proposal)
        except CoordinationFailure as error:
            log("flower chain failed", outcome=json.dumps(error.outcome)[:500])
        except Exception as error:  # noqa: BLE001 - coding sessions never wait on us
            log("flower chain error", error=f"{type(error).__name__}: {error}")
        finally:
            self.busy.discard(pair)

    def capture(self, source_id, target_id):
        """Build one bridge job pinned to the server's current activitySeq for both threads."""
        snapshots = {tid: self.server.thread(tid) for tid in (source_id, target_id)}
        threads = {tid: snap["thread"] for tid, snap in snapshots.items()}
        activity = self._activity(threads)
        source_refs, bindings = [], []
        for tid, thread in threads.items():
            usable = [
                item
                for item in self.events[tid]
                if item["event"]["revision"] <= thread["activitySeq"]
            ]
            if not any(item["event"]["revision"] == thread["activitySeq"] for item in usable):
                log(
                    "skip: no selected evidence at thread activitySeq",
                    thread=tid,
                    activitySeq=thread["activitySeq"],
                )
                return None
            # Keep the newest events but always end on the activitySeq event.
            for item in usable[-MAX_EVENTS_PER_THREAD:]:
                activity.ingest(item["event"])
                source_refs.append(
                    {
                        "flowerRef": {
                            k: item["event"][k]
                            for k in ("workerId", "sessionId", "eventId", "revision")
                        },
                        "sourceRef": item["sourceRef"],
                    }
                )
            card = activity.card((thread["workerId"], thread["sessionId"]))
            work_card = snapshots[tid].get("workCard")
            meta = self.selected[tid]
            bindings.append(
                {
                    "projectId": self.project_id,
                    "threadId": tid,
                    "workerId": thread["workerId"],
                    "sessionId": thread["sessionId"],
                    "ownerId": thread["createdBy"],
                    "title": thread["title"],
                    "featureTopic": meta["featureTopic"],
                    "relationship": meta.get("relationship", "alternative"),
                    "activitySeq": thread["activitySeq"],
                    "expectedVersion": work_card["version"] if work_card else 0,
                    "shared": True,
                    "deterministicStatus": card_status(card),
                    "contributors": card["contributors"][:16],
                }
            )
        envelope = activity.snapshot([(t["workerId"], t["sessionId"]) for t in threads.values()])
        request_id = f"puff-{source_id}-{threads[source_id]['activitySeq']}-{threads[target_id]['activitySeq']}"
        return {
            "request": {
                "requestId": request_id[:160],
                "projectId": self.project_id,
                "targetThreadId": target_id,
                "question": "Does the other session have a finding that is useful for this session's ongoing work?",
                "evidenceRefs": [item["sourceRef"] for item in source_refs][:40],
                "createdAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            },
            "activitySnapshot": envelope,
            "bindings": bindings,
            "sourceRefs": source_refs,
        }

    # -- delivery (placeholder until the server exposes note admission) ---------
    def deliver_note(self, note, result):
        self.record("notes.jsonl", {**note, "coordinationRunId": result["coordinationRunId"]})
        log("AWARENESS NOTE", target=note["targetThreadId"], text=json.dumps(note["text"]))

    def record(self, name, item):
        with (self.state_dir / name).open("a", encoding="utf-8") as output:
            output.write(json.dumps(item) + "\n")

    async def run(self, interval):
        self.load_threads()
        log("worker ready", project=self.project_id, threads=",".join(self.threads))
        while True:
            try:
                await self.poll()
                await self.run_due()
            except Exception as error:  # noqa: BLE001 - keep polling
                log("poll error", error=f"{type(error).__name__}: {error}")
            await asyncio.sleep(interval)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--state-dir", default=str(HERE / ".runtime" / "worker"))
    parser.add_argument("--interval", type=float, default=1.0)
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding="utf-8"))
    username, password = env("PUFF_ANALYSIS_USER"), env("PUFF_ANALYSIS_PASSWORD")
    if not username or not password:
        sys.exit("Set PUFF_ANALYSIS_USER and PUFF_ANALYSIS_PASSWORD (environment or .env)")
    server = Server(config["serverUrl"], username, password)
    worker = Worker(config, server, Jev(timeout=config.get("jevTimeoutSeconds", 5)), args.state_dir)
    try:
        asyncio.run(worker.run(args.interval))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
