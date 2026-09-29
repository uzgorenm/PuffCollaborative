"""Asynchronous-hub callable boundary with durable request deduplication.

Call from the hub's background job, not from its coding-session execution loop.
This module never delivers context, approves proposals or blocks a coding agent.
"""

import argparse
import hashlib
import json
import sqlite3
import subprocess
import sys
import time
from contextlib import closing
from pathlib import Path

from contracts import prepare


class CoordinationFailure(RuntimeError):
    def __init__(self, outcome):
        self.outcome = outcome
        super().__init__(outcome["error"])


def journal_events(path):
    if not path.exists():
        return []
    events = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            # A killed process can leave one incomplete final journal line.
            continue
    return events


def execute(prepared, directory, timeout=300):
    source, journal = directory / "input.json", directory / "events.jsonl"
    source.write_text(json.dumps(prepared), encoding="utf-8")
    worker = str(Path(__file__).with_name("chain_worker.py"))
    timed_out = False
    with subprocess.Popen(
        [sys.executable, worker, str(source), str(journal)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    ) as process:
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            process.kill()
            process.wait(timeout=2)
    events = journal_events(journal)
    success = next(
        (
            e
            for e in reversed(events)
            if e.get("stage") == "chain" and e.get("state") == "completed"
        ),
        None,
    )
    if success and not timed_out and process.returncode == 0:
        return {"state": "completed", "report": success["report"], "trace": events}
    # Cancellation runs in its own bounded process. Unobserved remote state stays unresolved.
    if journal.exists():
        try:
            subprocess.run(
                [sys.executable, worker, "cancel", str(journal)],
                timeout=4,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        except subprocess.TimeoutExpired:
            pass
    events = journal_events(journal)
    run_ids = sorted({e["runId"] for e in events if e.get("runId")})
    terminal = {
        e["runId"]: e["state"] for e in events if e.get("state", "").startswith("finished:")
    }
    auth_failed = any(e.get("errorCode") == "authentication-failed" for e in events)
    error = "Chain deadline exceeded" if timed_out else "Flower chain failed"
    if auth_failed:
        error = "SuperGrid authentication failed; refresh flwr login supergrid"
    return {
        "state": "failed",
        "error": error,
        "runIds": run_ids,
        "terminalStates": terminal,
        "remoteUnresolved": [rid for rid in run_ids if rid not in terminal],
        "submissionUnresolved": any(
            e["state"] == "submitting"
            and not any(
                r.get("stage") == e["stage"]
                and (r.get("runId") or r.get("errorCode") == "authentication-failed")
                for r in events
            )
            for e in events
        ),
        "warnings": prepared["warnings"],
        "trace": events,
    }


def coordinate(request, snapshot, *, state_dir=None, runner=execute):
    started = time.monotonic()
    prepared = prepare(request, snapshot)
    # Hash only the selected input, not private/unrelated UI data.
    fingerprint = hashlib.sha256(json.dumps(prepared, sort_keys=True).encode()).hexdigest()
    key = hashlib.sha256((request["projectId"] + "\0" + request["requestId"]).encode()).hexdigest()
    root = Path(state_dir) if state_dir else Path(__file__).parent / ".runtime"
    root.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(root / "requests.sqlite3", timeout=1)) as db, db:
        db.execute(
            "CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, fingerprint TEXT, outcome TEXT)"
        )
        db.execute("BEGIN IMMEDIATE")
        for previous_id, raw in db.execute(
            "SELECT id, outcome FROM requests WHERE id != ?", (key,)
        ):
            previous = json.loads(raw) if raw else None
            if (
                previous is None
                or previous.get("remoteUnresolved")
                or previous.get("submissionUnresolved")
            ):
                raise CoordinationFailure(
                    {
                        "state": "pending-or-unresolved",
                        "error": "Observe the previous request's terminal states before a replacement run",
                        "journal": str(root / previous_id / "events.jsonl"),
                        "trace": journal_events(root / previous_id / "events.jsonl"),
                    }
                )
        inserted = db.execute(
            "INSERT OR IGNORE INTO requests VALUES (?, ?, NULL)", (key, fingerprint)
        ).rowcount
        row = db.execute(
            "SELECT fingerprint, outcome FROM requests WHERE id = ?", (key,)
        ).fetchone()
    if not inserted:
        if row[0] != fingerprint:
            raise ValueError("requestId reused with different selected evidence")
        if row[1] is None:
            raise CoordinationFailure(
                {
                    "state": "pending-or-interrupted",
                    "error": "Request already reserved; inspect its journal before retrying",
                    "journal": str(root / key / "events.jsonl"),
                    "trace": journal_events(root / key / "events.jsonl"),
                }
            )
        outcome = json.loads(row[1])
    else:
        directory = root / key
        directory.mkdir(exist_ok=True)
        try:
            outcome = runner(
                prepared, directory, timeout=max(0.1, 300 - (time.monotonic() - started))
            )
        except Exception as error:  # noqa: BLE001 -- persist failures at the job boundary
            outcome = {
                "state": "failed",
                "error": f"Local chain failure: {type(error).__name__}",
                "submissionUnresolved": True,
                "trace": journal_events(directory / "events.jsonl"),
            }
        with closing(sqlite3.connect(root / "requests.sqlite3", timeout=1)) as db, db:
            db.execute("UPDATE requests SET outcome = ? WHERE id = ?", (json.dumps(outcome), key))
    if outcome["state"] != "completed":
        raise CoordinationFailure(outcome)
    return outcome["report"]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Puff Flower chain; one JSON envelope on stdin")
    parser.add_argument("--state-dir", default=str(Path(__file__).parent / ".runtime"))
    args = parser.parse_args()
    try:
        raw = sys.stdin.read(400_001)
        if len(raw) > 400_000:
            raise ValueError("Input envelope exceeds limit")
        envelope = json.loads(raw)
        report = coordinate(envelope["request"], envelope["snapshot"], state_dir=args.state_dir)
        print(json.dumps(report))
    except CoordinationFailure as error:
        print(json.dumps(error.outcome))
        sys.exit(1)
    except (ValueError, KeyError, TypeError):
        print(json.dumps({"state": "failed", "error": "Invalid coordination input"}))
        sys.exit(2)
