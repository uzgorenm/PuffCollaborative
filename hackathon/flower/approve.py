"""Owner approval for guardian corrections proposed while autoSend is off.

    python approve.py --config worker.json            # list pending corrections
    python approve.py --config worker.json RUN_ID     # send one to its agent
    python approve.py --config worker.json RUN_ID --reject

Sending uses the member login PUFF_MEMBER_USER / PUFF_MEMBER_PASSWORD, so the
instruction is attributed to the approving owner.
"""

import argparse
import json
import sys
from pathlib import Path

from worker import HERE, Server, env


def main():
    parser = argparse.ArgumentParser(description="Approve or reject a guardian correction")
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--state-dir", default=str(HERE / ".runtime" / "worker"))
    parser.add_argument("run_id", nargs="?")
    parser.add_argument("--reject", action="store_true")
    args = parser.parse_args()
    log = Path(args.state_dir) / "corrections.jsonl"
    rows = (
        [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]
        if log.exists()
        else []
    )
    key = lambda row: row.get("id") or row["runId"]
    decided = {key(row) for row in rows if row.get("sent") or row.get("decision")}
    pending = [row for row in rows if key(row) not in decided]
    if not args.run_id:
        for row in pending:
            print(
                f"{key(row)}  [{row.get('kind', 'correction')}] -> {row['threadId']}\n    {row['text']}\n"
            )
        print(f"{len(pending)} pending")
        return
    row = next((item for item in pending if args.run_id in (key(item), item["runId"])), None)
    if row is None:
        sys.exit("No pending correction with that run ID")
    decision = {**row, "decision": "rejected" if args.reject else "approved"}
    if not args.reject:
        config = json.loads(args.config.read_text(encoding="utf-8"))
        user, password = env("PUFF_MEMBER_USER"), env("PUFF_MEMBER_PASSWORD")
        if not user or not password:
            sys.exit("Set PUFF_MEMBER_USER and PUFF_MEMBER_PASSWORD (environment or .env)")
        Server(config["serverUrl"], user, password).submit_instruction(
            row["threadId"], f"guardian-{key(row)}".replace(":", "-"), row["text"]
        )
        decision["sent"] = True
    with log.open("a", encoding="utf-8") as output:
        output.write(json.dumps(decision) + "\n")
    print(f"{decision['decision']}: {row['threadId']}")


if __name__ == "__main__":
    main()
