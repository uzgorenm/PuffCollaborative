"""Pinned Flower 1.39 CLI transport, isolated from the product contract.

Uses the same Control client, FAB loader and StartRun path as `flwr chat`.
These Python CLI helpers are version-specific, not a stable public SDK.
"""

import json
import os
import threading
import time
from pathlib import Path

from flwr.cli.chat.chat_app import parse_task_event, start_chat_run
from flwr.cli.chat.chat_local_agent import build_local_agent
from flwr.cli.flower_config import read_superlink_connection
from flwr.cli.utils import init_http_client_from_connection
from flwr.proto.control_pb2 import (
    ListFederationsRequest,
    ListRunsRequest,
    StopRunRequest,
    StreamRunEventsRequest,
)

LOCK = threading.Lock()
# Flower rewrites ~/.flwr/credentials.yaml on token refresh; on Windows concurrent
# runs collide on that file, so connection setup and submission are serialized.
CONNECT = threading.Lock()


def record(path, event):
    with LOCK, Path(path).open("a", encoding="utf-8") as output:
        output.write(json.dumps(event) + "\n")
        output.flush()


def run_agent(project, payload, journal, stage):
    app = build_local_agent(Path(project))
    federation = os.environ.get("PUFF_FLOWER_FEDERATION", "supergrid")
    with CONNECT:
        connection = read_superlink_connection(federation)
        client = init_http_client_from_connection(connection)
    run_id = None
    try:
        # Authenticate before any paid submission. No credential values enter the journal.
        with CONNECT:
            client.ListFederations(ListFederationsRequest())
        record(
            journal,
            {
                "stage": stage,
                "state": "submitting",
                "app": app.app_spec,
                "fabHash": app.fab_hash,
                "warnings": list(app.warnings),
            },
        )
        with CONNECT:
            run_id, series_id = start_chat_run(
                client,
                json.dumps(payload),
                connection.federation,
                None,
                app.app_spec,
                app.fab_hash,
                app.fab_content,
            )
        record(
            journal,
            {
                "stage": stage,
                "runId": str(run_id),
                "seriesId": str(series_id),
                "state": "submitted",
            },
        )
        chunks, completed, size = [], False, 0
        for response in client.StreamRunEvents(StreamRunEventsRequest(run_id=run_id)):
            if response.task_event.run_id != run_id:
                raise ValueError("Event belongs to another run")
            kind, data = parse_task_event(response.task_event)
            if kind in {"error", "response.failed", "response.incomplete"}:
                raise RuntimeError(f"Application event: {kind}")
            if kind == "response.output_text.delta":
                delta = data.get("delta")
                if not isinstance(delta, str):
                    raise ValueError("Malformed output delta")
                size += len(delta.encode())
                if size > 50_000:
                    raise ValueError("Application output exceeds limit")
                chunks.append(delta)
            if kind == "response.completed":
                completed = True
                break
        if not completed:
            raise RuntimeError("Stream ended without application completion")
        # Application completion alone does not establish a completed SuperGrid run.
        while True:
            runs = client.ListRuns(ListRunsRequest(run_id=run_id)).run_dict
            if run_id not in runs:
                raise RuntimeError("Submitted run missing from status response")
            status = runs[run_id].status
            if status.status == "finished":
                state = f"{status.status}:{status.sub_status}"
                record(journal, {"stage": stage, "runId": str(run_id), "state": state})
                if status.sub_status != "completed":
                    raise RuntimeError("SuperGrid run did not complete successfully")
                break
            time.sleep(0.3)
        envelope = json.loads("".join(chunks))
        if (
            set(envelope) != {"schemaVersion", "runId", "result"}
            or envelope["schemaVersion"] != 1
            or envelope["runId"] != str(run_id)
        ):
            raise ValueError("Result envelope does not match completed run")
        record(
            journal,
            {
                "stage": stage,
                "runId": str(run_id),
                "state": "output-retrieved",
                "channel": "StreamRunEvents",
                "result": envelope["result"],
            },
        )
        return envelope
    except Exception as error:
        message = str(error).lower()
        code = "authentication-failed" if "authenticat" in message else "transport-or-result-error"
        record(
            journal,
            {
                "stage": stage,
                "runId": str(run_id) if run_id else None,
                "state": "error",
                "errorType": type(error).__name__,
                "errorCode": code,
            },
        )
        raise
    finally:
        client.close()


def cancel_runs(journal):
    events = [json.loads(line) for line in Path(journal).read_text(encoding="utf-8").splitlines()]
    ids = {e["runId"] for e in events if e.get("runId")}
    terminal = {e["runId"] for e in events if e["state"].startswith("finished:")}
    federation = os.environ.get("PUFF_FLOWER_FEDERATION", "supergrid")
    client = init_http_client_from_connection(read_superlink_connection(federation))
    try:
        for run_id in ids - terminal:
            status = (
                client.ListRuns(ListRunsRequest(run_id=int(run_id))).run_dict[int(run_id)].status
            )
            cancel_requested = status.status != "finished"
            if cancel_requested:
                client.StopRun(StopRunRequest(run_id=int(run_id)))
                status = (
                    client.ListRuns(ListRunsRequest(run_id=int(run_id)))
                    .run_dict[int(run_id)]
                    .status
                )
            state = (
                f"{status.status}:{status.sub_status}"
                if status.status == "finished"
                else "remote-unresolved"
            )
            record(
                journal,
                {
                    "stage": "cleanup",
                    "runId": run_id,
                    "state": state,
                    "cancelRequested": cancel_requested,
                },
            )
    finally:
        client.close()
