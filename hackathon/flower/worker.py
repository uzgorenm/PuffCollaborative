"""Puff analysis worker: coordination server events -> Activity -> Jev -> Flower -> work cards.

Runs as the server's `analysis` identity. It polls the project replay route,
feeds selected thread events to the Activity reducer, asks Jev whether the change
is worth a refresh, runs the Flower chain through `bridge.coordinate_activity`
for the changed thread and its partner thread, then writes both work cards back
with `PUT /threads/:id/work-card`.

Default mode is "guardian": one Flower guardian run per triggered agent reads
that agent's instruction and recent events plus every other agent's board card,
writes the agent's own card back, and on overlap proposes (or, with autoSend,
submits) a correction instruction into that agent's thread. Mode "chain" keeps
the earlier two-analysis-plus-coordination chain through the bridge.

Awareness-note delivery into the target OpenCode session is not a server route
yet; chain-mode notes go to `deliver_note`, which records them locally.

    python worker.py --config worker.json

Credentials come from PUFF_ANALYSIS_USER / PUFF_ANALYSIS_PASSWORD (environment
or the git-ignored .env next to this file), never from the config file. Sending
guardian instructions needs a member login: PUFF_MEMBER_USER / PUFF_MEMBER_PASSWORD.
"""

import argparse
import asyncio
import base64
import json
import os
import re
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
from transport import run_agent

HERE = Path(__file__).resolve().parent
# Only these kinds advance Thread.activitySeq on the server; see bridge README.
ADVANCING = {"comment.created", "run.tool", "run.output"}
MAX_EVENTS_PER_THREAD = 20
# Marks instructions the guardian itself submitted, so they never re-trigger it.
GUARDIAN_TAG = "[Puff guardian]"
# Guardian input budget: Jev-flagged events only, paths not diffs, summarized cards.
GUARDIAN_MAX_BYTES = 6000
GUARDIAN_MAX_EVENTS = 12
PATH = re.compile(r"[\w./-]+\.[A-Za-z0-9]{1,6}")


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

    def submit_instruction(self, thread_id, request_id, text):
        body = {"requestId": request_id, "text": text}
        return self.call("POST", f"/threads/{quote(thread_id)}/instructions", body)

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


def feed_item(event):
    """Compact, model-visible view of one server event for the guardian."""
    payload, kind = event.get("payload") or {}, event["kind"]
    text = {
        "instruction.submitted": str(payload.get("text") or "")[:500],
        "comment.created": str(payload.get("body") or "")[:300],
        "run.output": str(payload.get("text") or "")[:300],
        # Tools and diffs carry only the file paths they touched, never diff bodies.
        "run.tool": " ".join(
            [str(payload.get("toolName") or "tool"), str(payload.get("status") or "")]
            + PATH.findall(str(payload.get("summary") or ""))[:5]
        ),
        "run.diff": "diff "
        + " ".join(PATH.findall(f"{payload.get('ref') or ''} {payload.get('summary') or ''}")[:10]),
    }.get(kind, kind.removeprefix("run."))
    return {"eventId": event["id"], "seq": event["seq"], "kind": kind, "text": text}


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
        self.mode = config.get("mode", "guardian")
        self.auto_send = config.get("autoSend", False)
        self.member = None  # Server logged in as a member, for submitting instructions
        # Reads (events, threads) go through the member login when one is configured:
        # the server grants the analysis identity only work-card updates.
        self.reader = server
        self.feed = {}  # threadId -> guardian feed items
        self.objective = {}  # threadId -> latest non-guardian instruction text
        self.board = {}  # threadId -> latest guardian card (richer than the server card)
        self.sent = {}  # threadId -> (overlapWith, monotonic time) of last correction
        self.burst = {}  # session key -> card before the current burst of events
        self.flagged = {}  # threadId -> event seqs inside bursts Jev called meaningful
        self.retry = {}  # threadId -> (due monotonic time, attempts) after a failed guardian run

    # -- setup ---------------------------------------------------------------
    def load_threads(self):
        for thread_id in self.selected:
            thread = self.reader.thread(thread_id)["thread"]
            if thread["projectId"] != self.project_id:
                raise ValueError(f"Thread {thread_id} belongs to another project")
            self.threads[thread_id] = thread
            self.events.setdefault(thread_id, [])
        if len(self.threads) < 2 or (self.mode == "chain" and len(self.threads) != 2):
            raise ValueError("Guardian mode needs at least two threads; chain mode exactly two")
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
            page = await asyncio.to_thread(self.reader.replay, self.project_id, self.cursor)
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
        item = feed_item(event)
        self.feed[thread_id] = [*self.feed.get(thread_id, []), item][-30:]
        if event["kind"] == "instruction.submitted":
            if item["text"].startswith(GUARDIAN_TAG):
                return
            self.objective[thread_id] = item["text"]
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
            if key not in self.burst:
                self.burst[key] = previous
                asyncio.create_task(self.classify(key))

    async def classify(self, key):
        """Ask Jev once per burst: wait until the session is quiet, then classify it whole."""
        while True:
            revision = self.activity.card(key)["revision"]
            await asyncio.sleep(self.config.get("burstQuietSeconds", 0.7))
            if self.activity.card(key)["revision"] == revision:
                break
        previous = self.burst.pop(key)
        state = self.activity.classifier_state(key, previous)
        label = await self.jev.classify(state)
        latest = self.activity.card(key)["revision"]
        if latest != revision and label not in (None, "continuation"):
            # New events arrived while Jev answered; the meaningful change is still
            # unanalyzed, so it carries over to the newest revision.
            revision = latest
        log("jev", session=key[1], revision=revision, label=label or "fallback")
        thread_id = next(tid for tid in self.threads if self.key(tid) == key)
        if (
            self.mode == "guardian"
            and thread_id not in self.board
            and label in (None, "continuation")
        ):
            # An agent with no board card yet always gets a first guardian run, so the
            # other guardians can see it; Jev decides every refresh after that.
            label = "meaningful_progress"
        if label not in (None, "continuation"):
            # Only the events of a burst Jev flagged become guardian input.
            self.flagged.setdefault(thread_id, set()).update(
                item["seq"]
                for item in self.feed.get(thread_id, [])
                if previous["revision"] < item["seq"] <= revision
            )
        self.refresh.classified(key, revision, label)

    # -- chain -----------------------------------------------------------------
    async def run_due(self):
        now = time.monotonic()
        for thread_id, (due, _) in list(self.retry.items()):
            if now >= due and thread_id not in self.busy:
                self.busy.add(thread_id)
                asyncio.create_task(self.run_guardian(thread_id, "retry"))
        for intent in self.refresh.due(time.monotonic()):
            thread_id = next(
                t for t in self.threads if self.key(t) == (intent["workerId"], intent["sessionId"])
            )
            if self.mode == "guardian":
                if thread_id not in self.busy:
                    self.busy.add(thread_id)
                    asyncio.create_task(self.run_guardian(thread_id, intent["reason"]))
                continue
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

    async def run_guardian(self, thread_id, reason):
        try:
            board = await asyncio.to_thread(self.board_view, thread_id)
            payload = self.guardian_input(thread_id, board)
            log(
                "guardian start",
                thread=thread_id,
                reason=reason,
                others=len(board),
                events=len(payload["me"]["events"]),
                bytes=len(json.dumps(payload)),
            )
            started, submitted_at = time.monotonic(), time.time()
            envelope = await asyncio.to_thread(
                run_agent,
                str(HERE / "guardian"),
                payload,
                str(self.state_dir / "guardian-events.jsonl"),
                f"guardian:{thread_id}",
            )
            result, run_id = envelope["result"], envelope["runId"]
            meta = result.pop("meta", {}) or {}
            total = time.monotonic() - started
            model_seconds = float(meta.get("modelSeconds") or 0)
            startup = float(meta.get("startedAt") or submitted_at) - submitted_at
            log(
                "guardian done",
                thread=thread_id,
                run=run_id,
                model=meta.get("model"),
                total=round(total, 1),
                supergridStartup=round(startup, 1),
                modelSeconds=round(model_seconds, 1),
                fallback=";".join(meta.get("fallbackReasons") or []) or "none",
                overlap=result.get("overlap"),
            )
            result["model"] = meta.get("model") or "unknown"
            card = result.get("myCard") or {}
            self.board[thread_id] = card
            self.record("board.jsonl", {"threadId": thread_id, "runId": run_id, **result})
            await asyncio.to_thread(self.write_card, thread_id, card, run_id, result)
            if result.get("overlap") and result.get("instruction"):
                await asyncio.to_thread(self.correct, thread_id, run_id, result)
            self.retry.pop(thread_id, None)
        except Exception as error:  # noqa: BLE001 - coding sessions never wait on us
            attempts = self.retry.get(thread_id, (0, 0))[1] + 1
            if attempts <= 3:
                self.retry[thread_id] = (time.monotonic() + 10 * attempts, attempts)
            else:
                self.retry.pop(thread_id, None)
            log(
                "guardian error",
                thread=thread_id,
                attempt=attempts,
                error=f"{type(error).__name__}: {error}",
            )
        finally:
            self.busy.discard(thread_id)

    def guardian_input(self, thread_id, board):
        """Bounded guardian payload: flagged events, path-only activity, summarized cards."""
        flagged = self.flagged.get(thread_id, set())
        events = [item for item in self.feed.get(thread_id, []) if item["seq"] in flagged]
        others = [
            {
                "threadId": tid,
                "currentTask": str(card.get("currentTask") or "")[:200],
                "filesTouched": [str(path)[:120] for path in (card.get("filesTouched") or [])][:10]
                or PATH.findall(str(card.get("progress") or ""))[:10],
                "workState": card.get("workState") or card.get("status") or "unknown",
            }
            for tid, card in board.items()
        ][:8]
        payload = {
            "schemaVersion": 1,
            "me": {
                "threadId": thread_id,
                "objective": self.objective.get(thread_id, self.threads[thread_id]["title"])[:500],
                "events": events[-GUARDIAN_MAX_EVENTS:],
            },
            "others": others,
        }
        while len(json.dumps(payload)) > GUARDIAN_MAX_BYTES and len(payload["me"]["events"]) > 1:
            payload["me"]["events"] = payload["me"]["events"][1:]
        return payload

    def board_view(self, thread_id):
        """Other agents' cards: their guardian's richer card, else the server's work card."""
        view = {}
        for tid in self.threads:
            if tid == thread_id:
                continue
            if tid in self.board:
                view[tid] = self.board[tid]
                continue
            server_card = self.reader.thread(tid).get("workCard")
            if server_card:
                view[tid] = {
                    k: server_card[k] for k in ("currentTask", "progress", "blockers", "status")
                }
                continue
            view[tid] = {
                "currentTask": self.objective.get(tid, self.threads[tid]["title"]),
                "progress": "unknown",
            }
        return view

    def write_card(self, thread_id, card, run_id, result):
        """Publish this agent's guardian card to the shared board (server work card)."""
        snapshot = self.reader.thread(thread_id)
        seq, existing = snapshot["thread"]["activitySeq"], snapshot.get("workCard")
        seqs = {item["eventId"]: item["seq"] for item in self.feed.get(thread_id, [])}
        refs = [
            {"threadId": thread_id, "eventId": event_id, "seq": seqs[event_id]}
            for event_id in result.get("evidenceEventIds") or []
            if event_id in seqs and seqs[event_id] <= seq
        ]
        files = ", ".join(str(item) for item in (card.get("filesTouched") or [])[:10])
        model = result.get("model", "unknown")
        progress = (
            str(card.get("progress") or "")[:1400]
            + (f" | Files: {files}" if files else "")
            + f" | Model: {model}"
        )
        activity_card = self.activity.card(self.key(thread_id))
        update = {
            "threadId": thread_id,
            "expectedVersion": existing["version"] if existing else 0,
            "sourceActivitySeq": seq,
            "card": {
                "currentTask": str(card.get("currentTask") or "unknown")[:1000],
                "progress": progress,
                "blockers": [str(item)[:500] for item in (card.get("blockers") or [])][:10],
                "status": card_status(activity_card),
                "summaryJobId": f"{run_id}:{model}",
                "recentVerifiedOutcome": None,
                "contributors": activity_card["contributors"][:16],
                "evidenceRefs": refs,
                "generatedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            },
        }
        try:
            saved = self.server.put_work_card(update)
            log("board card written", thread=thread_id, version=saved.get("version"))
        except RuntimeError as error:
            log("board card rejected", thread=thread_id, error=error)

    def correct(self, thread_id, run_id, result):
        """Propose, or with autoSend submit, the guardian's correction to its own agent."""
        other, now = result.get("overlapWith"), time.monotonic()
        last = self.sent.get(thread_id)
        cooldown = self.config.get("correctionCooldownSeconds", 300)
        if last and last[0] == other and now - last[1] < cooldown:
            log("correction suppressed (cooldown)", thread=thread_id, overlapWith=other)
            return
        text = f"{GUARDIAN_TAG} {result['instruction']} (Reason: {result.get('reason', '')})"
        proposal = {"threadId": thread_id, "runId": run_id, "overlapWith": other, "text": text}
        proposal["sent"] = bool(self.auto_send and self.member)
        if proposal["sent"]:
            self.member.submit_instruction(thread_id, f"guardian-{run_id}", text)
            self.sent[thread_id] = (other, now)
            log("CORRECTION SENT", thread=thread_id, text=json.dumps(text))
        else:
            log("CORRECTION PROPOSED (owner approval)", thread=thread_id, text=json.dumps(text))
        self.record("corrections.jsonl", proposal)

    def capture(self, source_id, target_id):
        """Build one bridge job pinned to the server's current activitySeq for both threads."""
        snapshots = {tid: self.reader.thread(tid) for tid in (source_id, target_id)}
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
    member_user, member_password = env("PUFF_MEMBER_USER"), env("PUFF_MEMBER_PASSWORD")
    if member_user and member_password:
        worker.member = Server(config["serverUrl"], member_user, member_password)
        worker.reader = worker.member
    try:
        asyncio.run(worker.run(args.interval))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
