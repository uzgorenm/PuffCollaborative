import copy
import importlib
import unittest
import json
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


class GuardianCitationTests(unittest.TestCase):
    def bridge(self):
        try:
            return importlib.import_module("guardian")
        except ModuleNotFoundError:
            self.fail("The real guardian bridge has not been implemented")

    def evidence(self):
        return {
            "projectId": "project", "sourceThreadId": "alice", "targetThreadId": "mine",
            "sourceEventId": "evt_source", "sourceEventSeq": 5,
            "sourceActivitySeq": 5, "sourceCardVersion": 1, "targetActivitySeq": 6,
            "targetEventIds": ["evt_target"],
        }

    def result(self):
        return {
            "myCard": {"currentTask": "Start server", "approach": "Inspect ports", "progress": "Investigating", "filesTouched": [], "workState": "ongoing", "blockers": [], "discoveries": []},
            "finding": {"text": "alice found that EADDRINUSE means the configured port is occupied; that finding also affects server startup here.", "sourceThreadId": "alice", "sourceEventIds": ["evt_source"]},
            "proposal": None, "evidenceEventIds": ["evt_target"],
            "meta": {"model": "flower-endeavor-v1.0"},
        }

    def test_actual_guardian_citation_is_bound_to_captured_source(self):
        valid = self.bridge().validate_result(self.result(), self.evidence())
        self.assertEqual(valid["source"]["eventId"], "evt_source")
        self.assertEqual(valid["source"]["seq"], 5)
        self.assertEqual(valid["model"], "flower-endeavor-v1.0")

    def test_invented_or_other_thread_citation_is_rejected(self):
        for update in [{"sourceThreadId": "private"}, {"sourceEventIds": ["invented"]}, {"sourceEventIds": []}]:
            result = copy.deepcopy(self.result())
            result["finding"].update(update)
            with self.assertRaises(ValueError):
                self.bridge().validate_result(result, self.evidence())

    def test_stub_or_redirect_is_rejected(self):
        for update in ["Stop this task and switch to Alice's work", "Run rm -rf ./workspace"]:
            result = copy.deepcopy(self.result())
            result["finding"]["text"] = update
            with self.assertRaises(ValueError):
                self.bridge().validate_result(result, self.evidence())
        result = self.result()
        result["meta"]["model"] = "stub"
        with self.assertRaises(ValueError):
            self.bridge().validate_result(result, self.evidence())

    def test_unknown_target_evidence_is_rejected(self):
        result = self.result()
        result["evidenceEventIds"] = ["invented"]
        with self.assertRaises(ValueError):
            self.bridge().validate_result(result, self.evidence())

    def test_empty_result_remains_empty_and_proposal_requires_owner_review(self):
        result = self.result()
        result["finding"] = None
        result["proposal"] = {"text": "Choose a different approach", "reason": "A possible conflict"}
        valid = self.bridge().validate_result(result, self.evidence())
        self.assertIsNone(valid["finding"])
        self.assertTrue(valid["proposal"]["requiresOwnerReview"])


class GuardianCaptureTests(unittest.TestCase):
    def setUp(self):
        self.source_event = {"id": "evt_source", "projectId": "project", "threadId": "alice", "seq": 5, "kind": "comment.created", "actorId": "usr_alice", "payload": {"body": "Measured EADDRINUSE; healthy startup on another port."}}
        self.target_events = [
            {"id": "evt_old", "projectId": "project", "threadId": "mine", "seq": 6, "kind": "comment.created", "actorId": "usr_serdar", "payload": {"body": "Start the app server"}},
            {"id": "evt_error", "projectId": "project", "threadId": "mine", "seq": 8, "kind": "instruction.submitted", "actorId": "usr_serdar", "payload": {"text": "My actual server now fails with EADDRINUSE"}},
        ]
        self.source = {"thread": {"id": "alice", "projectId": "project", "createdBy": "usr_alice", "activitySeq": 5}, "workCard": {"status": "done", "recentVerifiedOutcome": "Measured healthy startup", "sourceActivitySeq": 5, "version": 1, "currentTask": "Fix server startup", "contributors": ["usr_alice"], "evidenceRefs": [{"threadId": "alice", "eventId": "evt_source", "seq": 5}]}}
        self.target = {"thread": {"id": "mine", "projectId": "project", "createdBy": "usr_serdar", "activitySeq": 8}, "workCard": {"sourceActivitySeq": 6, "currentTask": "Old task", "evidenceRefs": [{"threadId": "mine", "eventId": "evt_old", "seq": 6}]}, "instructions": [{"text": "Start the app server", "submittedAt": "2026-09-29T01:00:00Z"}, {"text": "My actual server now fails with EADDRINUSE", "submittedAt": "2026-09-29T02:00:00Z"}]}
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                route = urlparse(self.path)
                after = int(parse_qs(route.query).get("after", [-1])[0])
                if route.path.endswith("/projects/project"):
                    data = {"members": [{"userId": user, "projectId": "project"} for user in ["usr_alice", "usr_serdar"]]}
                elif route.path.endswith("/threads/alice"):
                    data = fixture.source
                elif route.path.endswith("/threads/mine"):
                    data = fixture.target
                elif route.path.endswith("/threads/mine/events"):
                    events = [event for event in fixture.target_events if event["seq"] > after]
                    data = {"events": events, "cursor": events[-1]["seq"] if events else after, "hasMore": False}
                elif route.path.endswith("/projects/project/events"):
                    events = [event for event in [fixture.source_event, *fixture.target_events] if event["seq"] > after][:1]
                    data = {"events": events, "cursor": events[-1]["seq"] if events else after, "hasMore": False}
                else:
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(data).encode())

            def log_message(self, *_args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.home = tempfile.TemporaryDirectory()
        self.addCleanup(self.home.cleanup)
        self.member = Path(self.home.name) / "member.json"
        self.member.write_text(json.dumps({"url": f"http://127.0.0.1:{self.server.server_port}", "username": "serdar", "password": "local-fixture-only", "userId": "usr_serdar", "projectId": "project", "sourceThreadId": "alice", "targetThreadId": "mine"}))
        self.member.chmod(0o600)

    def test_latest_owner_error_is_exported_when_target_work_card_is_stale(self):
        payload, captured = importlib.import_module("guardian").capture(self.member)
        self.assertEqual(payload["me"]["objective"], "My actual server now fails with EADDRINUSE")
        self.assertIn("evt_error", captured["targetEventIds"])
        self.assertEqual(payload["me"]["events"][-1]["text"], "My actual server now fails with EADDRINUSE")
        self.assertEqual(captured["sourceEventId"], "evt_source")
        self.assertEqual(captured["targetActivitySeq"], 8)

    def test_stale_source_is_still_rejected(self):
        self.source["thread"]["activitySeq"] = 7
        with self.assertRaisesRegex(ValueError, "source finding is stale"):
            importlib.import_module("guardian").capture(self.member)

    def test_snapshot_cursor_includes_queued_input_before_activity_projection(self):
        self.target["thread"]["activitySeq"] = 6
        self.target["cursor"] = 8
        payload, captured = importlib.import_module("guardian").capture(self.member)
        self.assertIn("evt_error", captured["targetEventIds"])
        self.assertEqual(payload["me"]["objective"], "My actual server now fails with EADDRINUSE")
        self.assertEqual(captured["targetActivitySeq"], 6)

    def test_target_owner_and_project_boundaries_are_unchanged(self):
        for field, value in [("createdBy", "usr_alice"), ("projectId", "another_project")]:
            original = self.target["thread"][field]
            self.target["thread"][field] = value
            with self.assertRaisesRegex(ValueError, "Invalid selected source or target"):
                importlib.import_module("guardian").capture(self.member)
            self.target["thread"][field] = original

    def test_other_thread_event_cannot_enter_target_context(self):
        self.target_events[-1]["threadId"] = "private"
        with self.assertRaisesRegex(ValueError, "Target event identity changed"):
            importlib.import_module("guardian").capture(self.member)


if __name__ == "__main__":
    unittest.main()
