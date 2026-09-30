"""Explicitly observe/cancel known runs after a failed chain; never resubmit."""

import argparse
import hashlib
import json
import sqlite3
import subprocess
import sys
from contextlib import closing
from pathlib import Path

from journal import journal_events
from private_state import secure_state_tree


def reconcile(project_id, request_id, state_dir):
    root = secure_state_tree(state_dir)
    key = hashlib.sha256((project_id + "\0" + request_id).encode()).hexdigest()
    journal = root / key / "events.jsonl"
    with closing(sqlite3.connect(root / "requests.sqlite3", timeout=1)) as db:
        row = db.execute("SELECT outcome FROM requests WHERE id = ?", (key,)).fetchone()
    if not row or not row[0]:
        raise ValueError("Missing outcome; interrupted host jobs require operator inspection")
    outcome = json.loads(row[0])
    if outcome["state"] == "completed":
        return outcome
    try:
        subprocess.run(
            [
                sys.executable,
                str(Path(__file__).with_name("chain_worker.py")),
                "cancel",
                str(journal),
            ],
            timeout=5,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except subprocess.TimeoutExpired:
        pass
    events = journal_events(journal)
    ids = sorted({e["runId"] for e in events if e.get("runId")})
    terminal = {
        e["runId"]: e["state"] for e in events if e.get("state", "").startswith("finished:")
    }
    outcome.update(
        runIds=ids,
        terminalStates=terminal,
        remoteUnresolved=[rid for rid in ids if rid not in terminal],
        trace=events,
    )
    # Never clear an ambiguous submission with no known run ID.
    with closing(sqlite3.connect(root / "requests.sqlite3", timeout=1)) as db, db:
        db.execute("UPDATE requests SET outcome = ? WHERE id = ?", (json.dumps(outcome), key))
    return outcome


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--request-id", required=True)
    parser.add_argument("--state-dir", default=".runtime")
    args = parser.parse_args()
    print(json.dumps(reconcile(args.project_id, args.request_id, args.state_dir), indent=2))
