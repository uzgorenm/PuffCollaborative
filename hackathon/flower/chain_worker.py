"""Isolated process for network calls; the parent enforces the entire deadline."""

import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from contracts import make_report, validate_analysis
from transport import cancel_runs, record, run_agent


def run(prepared, journal):
    root = Path(__file__).parent
    # Independent session runs overlap so the bounded chain can finish within 90 seconds.
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [
            pool.submit(
                run_agent,
                root / "session",
                item,
                journal,
                f"session:{item['session']['sessionId']}",
            )
            for item in prepared["inputs"]
        ]
        analyses = [future.result() for future in futures]
    for item, analysis in zip(prepared["inputs"], analyses, strict=True):
        analysis["result"] = validate_analysis(analysis["result"], item)
    payload = {
        "schemaVersion": 1,
        "request": prepared["request"],
        "analyses": [
            {"session": item["session"], **analysis}
            for item, analysis in zip(prepared["inputs"], analyses, strict=True)
        ],
    }
    record(
        journal,
        {
            "stage": "handoff",
            "state": "validated",
            "sourceRunIds": [a["runId"] for a in analyses],
            "input": payload,
        },
    )
    coordination = run_agent(root / "coordination", payload, journal, "coordination")
    report = make_report(prepared, analyses, coordination["result"], coordination["runId"])
    record(journal, {"stage": "chain", "state": "completed", "report": report})


if __name__ == "__main__":
    if sys.argv[1] == "cancel":
        cancel_runs(sys.argv[2])
    else:
        try:
            run(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")), sys.argv[2])
        except Exception as error:  # noqa: BLE001 -- child process failure boundary
            record(
                sys.argv[2],
                {"stage": "chain", "state": "failed", "errorType": type(error).__name__},
            )
            sys.exit(1)
