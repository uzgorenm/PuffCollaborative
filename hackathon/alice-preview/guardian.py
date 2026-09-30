"""One real published Puff Guardian run over selected Alice fixture evidence.

Uses the existing pinned transport's StartRun/StreamRunEvents/ListRuns path.
An access-only auth plugin avoids changing the user's saved Flower login. No
source output, proposal, or finding is submitted to the coding instruction queue.
"""

import argparse
import base64
import hashlib
import json
import os
import re
import signal
import stat
import sys
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

APP = "@fertonzi/puff-guardian"
HERE = Path(__file__).resolve().parent
FLOWER = HERE.parent / "flower"


def private_file(path):
    path = Path(path)
    if not stat.S_ISREG(path.stat().st_mode) or stat.S_IMODE(path.stat().st_mode) & 0o077:
        raise ValueError("Credential input must be an owner-only regular file")
    return path


def validate_result(result, captured):
    if not isinstance(result, dict) or set(result) != {"myCard", "finding", "proposal", "evidenceEventIds", "meta"}:
        raise ValueError("Guardian returned an invalid result envelope")
    meta = result["meta"]
    model = meta.get("model") if isinstance(meta, dict) else None
    if model not in {"flower-endeavor-v1.0", "openai/gpt-5.6-sol"}:
        raise ValueError("Guardian did not report a real allowed model")
    evidence = result["evidenceEventIds"]
    if not isinstance(evidence, list) or any(item not in captured["targetEventIds"] for item in evidence):
        raise ValueError("Guardian invented target evidence")
    card = result["myCard"]
    if not isinstance(card, dict) or not isinstance(card.get("discoveries"), list):
        raise ValueError("Guardian returned an invalid board card")
    for discovery in card["discoveries"]:
        if not isinstance(discovery, dict) or not isinstance(discovery.get("text"), str):
            raise ValueError("Guardian returned an invalid discovery")
        refs = discovery.get("evidenceEventIds")
        if not isinstance(refs, list) or not refs or any(item not in captured["targetEventIds"] for item in refs):
            raise ValueError("Guardian invented discovery evidence")
    finding = result["finding"]
    if finding is not None:
        if not isinstance(finding, dict) or set(finding) != {"text", "sourceThreadId", "sourceEventIds"}:
            raise ValueError("Guardian returned an invalid finding")
        text = finding.get("text")
        refs = finding.get("sourceEventIds")
        if (not isinstance(text, str) or not text.strip() or len(text) > 4000
            or finding.get("sourceThreadId") != captured["sourceThreadId"]
            or not isinstance(refs, list) or not refs or set(refs) != {captured["sourceEventId"]}):
            raise ValueError("Guardian finding does not cite the selected source")
        if re.search(r"\b(stop|abandon|switch to|replace your|cancel your|rm -rf)\b|^\s*(run|execute|delete|kill)\b", text, re.I):
            raise ValueError("A redirection cannot become informational context")
    proposal = result["proposal"]
    if proposal is not None:
        if not isinstance(proposal, dict) or not all(isinstance(proposal.get(key), str) for key in ("text", "reason")):
            raise ValueError("Guardian returned an invalid proposal")
        proposal = {**proposal, "requiresOwnerReview": True}
    return {
        "finding": finding, "proposal": proposal, "model": model,
        "myCard": card, "evidenceEventIds": evidence,
        "source": {"threadId": captured["sourceThreadId"], "eventId": captured["sourceEventId"], "seq": captured["sourceEventSeq"], "activitySeq": captured["sourceActivitySeq"], "cardVersion": captured["sourceCardVersion"]},
        "target": {"threadId": captured["targetThreadId"], "activitySeq": captured["targetActivitySeq"]},
        "delivery": "not-submitted", "execution": "analysis-only",
    }


def capture(member_path):
    config = json.loads(private_file(member_path).read_text())
    origin = urlparse(config["url"])
    if origin.hostname not in {"127.0.0.1", "localhost"} or origin.scheme != "http" or origin.username or origin.password:
        raise ValueError("This bridge only reads the isolated loopback preview")
    credential = base64.b64encode(f'{config["username"]}:{config["password"]}'.encode()).decode()

    def read(path):
        request = Request(config["url"].rstrip("/") + "/api/coordination/v1" + path, headers={"Authorization": "Basic " + credential})
        with urlopen(request, timeout=15) as response:
            return json.load(response)

    project_id = config["projectId"]
    project = read("/projects/" + quote(project_id, safe=""))
    members = {item["userId"] for item in project["members"] if item["projectId"] == project_id}
    if config["userId"] not in members:
        raise ValueError("The configured viewer is not a current project member")
    source_id, target_id = config["sourceThreadId"], config["targetThreadId"]
    source = read("/threads/" + quote(source_id, safe=""))
    target = read("/threads/" + quote(target_id, safe=""))
    if source_id == target_id or source["thread"]["projectId"] != project_id or target["thread"]["projectId"] != project_id or target["thread"]["createdBy"] != config["userId"]:
        raise ValueError("Invalid selected source or target")
    card = source.get("workCard")
    if not card or card["status"] != "done" or not card["recentVerifiedOutcome"] or card["sourceActivitySeq"] != source["thread"]["activitySeq"]:
        raise ValueError("The selected source finding is stale or incomplete")

    def event(ref, thread_id, activity_seq):
        page = read(f'/projects/{quote(project_id, safe="")}/events?after={ref["seq"] - 1}&limit=1')
        events = page["events"]
        if len(events) != 1:
            raise ValueError("Source event is missing")
        item = events[0]
        if item["projectId"] != project_id or item.get("threadId") != thread_id or item["id"] != ref["eventId"] or item["seq"] != ref["seq"] or item["seq"] > activity_seq:
            raise ValueError("Source event identity changed")
        return item

    sources = [event(ref, source_id, card["sourceActivitySeq"]) for ref in card["evidenceRefs"] if ref["threadId"] == source_id]
    selected = next((item for item in sources if item["kind"] == "comment.created" and "EADDRINUSE" in str(item["payload"].get("body", ""))), None)
    if not selected or selected.get("actorId") not in members or selected["actorId"] not in card["contributors"]:
        raise ValueError("The recorded finding has no established author")
    target_card = target.get("workCard")
    # New owner messages advance activity before a WorkCard projection catches up.
    # Queue admission can precede activity projection; the transactional snapshot
    # cursor bounds all committed target instructions and runtime events.
    own = []
    after = -1
    target_activity = target.get("cursor", target["thread"]["activitySeq"])
    while True:
        page = read(f'/threads/{quote(target_id, safe="")}/events?after={after}&limit=256')
        for item in page["events"]:
            if item["projectId"] != project_id or item.get("threadId") != target_id or item["seq"] <= after:
                raise ValueError("Target event identity changed")
            if item["seq"] > target_activity:
                continue
            text = item["payload"].get("body", item["payload"].get("text", item["payload"].get("summary", "")))
            if item["kind"] in {"comment.created", "instruction.submitted", "run.output", "run.tool", "run.diff"} and isinstance(text, str) and text.strip():
                own = [*own, item][-12:]
        if not page["hasMore"] or page["cursor"] >= target_activity:
            break
        if page["cursor"] <= after:
            raise ValueError("Target journal cursor did not advance")
        after = page["cursor"]
    if not own:
        raise ValueError("The target has no permitted context evidence")
    instructions = sorted(target["instructions"], key=lambda item: item["submittedAt"])
    objective = instructions[-1]["text"] if instructions else target_card["currentTask"] if target_card else target["thread"]["title"]
    captured = {
        "projectId": project_id, "sourceThreadId": source_id, "targetThreadId": target_id,
        "sourceEventId": selected["id"], "sourceEventSeq": selected["seq"],
        "sourceActivitySeq": card["sourceActivitySeq"], "sourceCardVersion": card["version"],
        "targetActivitySeq": target["thread"]["activitySeq"], "targetEventIds": [item["id"] for item in own],
    }
    payload = {
        "schemaVersion": 1,
        "me": {"threadId": target_id, "objective": objective[:1000], "events": [{"eventId": item["id"], "kind": item["kind"], "text": str(item["payload"].get("body", item["payload"].get("text", item["payload"].get("summary", ""))))[:4000]} for item in own]},
        "others": [{"threadId": source_id, "currentTask": card["currentTask"], "filesTouched": [], "workState": "completed", "discoveries": [{"text": selected["payload"]["body"][:4000], "evidenceEventIds": [selected["id"]]}]}],
    }
    if len(json.dumps(payload).encode()) > 12000:
        raise ValueError("Selected evidence exceeds the bounded export budget")
    return payload, captured


def transport_with_token(token_path, federation=None):
    # Pinned CLI auth extension: its interceptor emits Bearer from access metadata.
    # No refresh metadata is provided and the user's credential store is untouched.
    import flwr
    from flwr.cli.typing import SuperLinkConnection
    from flwr.cli.utils import init_http_client_from_connection
    from flwr.common.constant import ACCESS_TOKEN_KEY
    from flwr.proto.control_pb2 import ListAppsRequest, ListFederationsRequest

    if flwr.__version__ != "1.39.0":
        raise ValueError("This transport requires verified Flower 1.39.0")

    class TokenFileAuth:
        def load_tokens(self):
            self.token = private_file(token_path).read_text().strip()
            if not self.token or len(self.token) > 16000 or any(character.isspace() for character in self.token):
                raise ValueError("Invalid private access-token file")

        def write_tokens_to_metadata(self, metadata):
            return [*metadata, (ACCESS_TOKEN_KEY, self.token)]

        def store_tokens(self, _credentials):
            raise ValueError("Service-account tokens are not refreshed by this bridge")

    connection = SuperLinkConnection(name="supergrid", address="api.flower.ai", federation=federation)

    def client(_connection=connection):
        return init_http_client_from_connection(connection, auth_plugin=TokenFileAuth())

    control = client()
    try:
        federations = control.ListFederations(ListFederationsRequest()).federations
        names = [item.name for item in federations]
        chosen = federation or next((value for value in names if value.endswith("/personal")), names[0] if names else None)
        if not chosen or chosen not in names:
            raise ValueError("The token has no accessible selected federation")
        connection.federation = chosen
        apps = control.ListApps(ListAppsRequest(federation_id=chosen)).apps
        published = next((item for item in apps if item.app_id.lstrip("@").split(":")[0] == APP.lstrip("@")), None)
        if not published:
            raise ValueError("The published Puff Guardian is unavailable in this federation")
        selection = SimpleNamespace(app_spec=published.app_id, fab_hash=published.fab_hash, fab_content=None, warnings=())
        return client, connection, selection
    finally:
        control.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--member", required=True)
    parser.add_argument("--token-file", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--federation")
    parser.add_argument("--preflight", action="store_true")
    args = parser.parse_args()
    output = Path(args.output_dir)
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(output, 0o700)
    payload, captured = capture(args.member)
    sys.path.insert(0, str(FLOWER))
    import transport
    client, connection, selection = transport_with_token(args.token_file, args.federation)
    if args.preflight:
        print(json.dumps({"state": "ready", "app": selection.app_spec, "federation": connection.federation, "flowerVersion": "1.39.0", "source": captured, "paidRun": False}))
        return
    key = hashlib.sha256(json.dumps(captured, sort_keys=True).encode()).hexdigest()
    final_path = output / (key + ".json")
    pending_path = output / (key + ".pending.json")
    journal = output / (key + ".events.jsonl")
    if final_path.exists():
        print(final_path.read_text())
        return
    try:
        with pending_path.open("x") as file:
            json.dump({"state": "submission-started", "captured": captured, "app": selection.app_spec}, file)
        os.chmod(pending_path, 0o600)
    except FileExistsError:
        print(json.dumps({"state": "unresolved", "message": "A prior run must be reconciled before another paid submission.", "journal": str(journal)}))
        return
    journal.touch(mode=0o600)
    original_client, original_connection, original_build = transport.init_http_client_from_connection, transport.read_superlink_connection, transport.build_local_agent
    transport.init_http_client_from_connection = client
    transport.read_superlink_connection = lambda _name: connection
    # The transport normally builds a local FAB. Select the actual published app
    # instead: StartRun receives app_spec and fab_content=None, never stub output.
    transport.build_local_agent = lambda _path: selection

    def timed_out(_number, _frame):
        raise TimeoutError("Guardian transport deadline reached")

    signal.signal(signal.SIGALRM, timed_out)
    signal.alarm(240)
    try:
        envelope = transport.run_agent(FLOWER / "guardian", payload, journal, "alice-guardian")
        checked = validate_result(envelope["result"], captured)
        _, current = capture(args.member)
        if current != captured:
            raise ValueError("Source or target changed while the guardian was running")
        result = {"state": "completed", "runId": envelope["runId"], "app": selection.app_spec, "federation": connection.federation, **checked}
        final_path.write_text(json.dumps(result))
        os.chmod(final_path, 0o600)
        print(json.dumps(result))
    except Exception as error:
        # Deliberately retain pending intent and journal: failure is not proof the
        # remote run stopped, so an ambiguous attempt never triggers a paid retry.
        print(json.dumps({"state": "unresolved", "errorType": type(error).__name__, "journal": str(journal), "message": "Inspect the correlated remote run before any retry."}))
        raise SystemExit(1) from None
    finally:
        signal.alarm(0)
        transport.init_http_client_from_connection, transport.read_superlink_connection, transport.build_local_agent = original_client, original_connection, original_build


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        response = getattr(error, "response", None)
        print(json.dumps({"state": "unavailable", "errorType": type(error).__name__, "httpStatus": getattr(response, "status_code", None), "message": "Guardian preflight or selected evidence validation failed."}))
        raise SystemExit(1) from None
