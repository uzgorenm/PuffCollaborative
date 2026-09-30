import copy
import json
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from contracts import make_report, prepare, validate_analysis
from coordinator import CoordinationFailure, coordinate, execute, journal_events
from smoke import example


def analysis_for(item, run_id):
    """Explicit local test data; never presented as a real Flower result."""
    event = item["events"][0]
    return {
        "runId": run_id,
        "result": {
            "task": "Explore navigation",
            "approach": item["session"]["title"],
            "workState": "ongoing",
            "progress": "Keyboard focus constraint found",
            "blockers": [],
            "recentOutcome": None,
            "warnings": [],
            "evidenceRefs": [
                {key: event[key] for key in ("workerId", "sessionId", "eventId", "revision")}
            ],
        },
    }


class ContractsTest(unittest.TestCase):
    def setUp(self):
        self.request, self.snapshot = example()
        self.prepared = prepare(self.request, self.snapshot)
        self.analyses = [
            analysis_for(item, f"test-{index}")
            for index, item in enumerate(self.prepared["inputs"])
        ]
        self.finding = {
            "relationship": "alternative",
            "awareness": {
                "sourceSessionId": "A",
                "text": "A found a keyboard focus constraint relevant to both designs.",
                "evidenceRefs": self.request["evidenceRefs"],
            },
            "proposal": None,
            "warnings": [],
        }

    def test_source_linked_note_keeps_alternatives(self):
        report = make_report(self.prepared, self.analyses, self.finding, "test-coordinator")
        self.assertEqual(report["awarenessNotes"][0]["state"], "pending")
        self.assertEqual(report["awarenessNotes"][0]["targetSessionId"], "B")
        self.assertEqual(report["summaries"][0]["runId"], "test-0")
        self.assertEqual(report["runId"], "test-coordinator")
        self.assertEqual(report["proposals"], [])

    def test_unknown_or_stale_analysis_citation_fails(self):
        for field, value in [
            ("eventId", "invented"),
            ("revision", 2),
            ("workerId", "wrong"),
            ("sessionId", "B"),
        ]:
            with self.subTest(field=field):
                result = copy.deepcopy(self.analyses[0]["result"])
                result["evidenceRefs"][0][field] = value
                with self.assertRaises(ValueError):
                    validate_analysis(result, self.prepared["inputs"][0])

    def test_coordinator_cannot_cite_evidence_not_in_handoff(self):
        self.finding["awareness"]["evidenceRefs"][0]["eventId"] = "invented"
        with self.assertRaises(ValueError):
            make_report(self.prepared, self.analyses, self.finding, "test")

    def test_alternatives_not_duplicates(self):
        self.finding["relationship"] = "overlap"
        with self.assertRaises(ValueError):
            make_report(self.prepared, self.analyses, self.finding, "test")

    def test_no_relation_returns_no_note(self):
        request, snapshot = example(unrelated=True)
        finding = {"relationship": "none", "awareness": None, "proposal": None, "warnings": []}
        report = make_report(prepare(request, snapshot), self.analyses, finding, "test")
        self.assertEqual(report["awarenessNotes"], [])
        with self.assertRaises(ValueError):
            make_report(prepare(request, snapshot), self.analyses, self.finding, "test")

    def test_redirection_is_proposed_never_approved(self):
        self.finding["awareness"] = None
        self.finding["proposal"] = {
            "kind": "context",
            "text": "Switch the experiment.",
            "rationale": "Requires owner review",
            "evidenceRefs": self.request["evidenceRefs"],
        }
        report = make_report(self.prepared, self.analyses, self.finding, "test")
        self.assertEqual(report["proposals"][0]["state"], "proposed")
        self.assertEqual(report["awarenessNotes"], [])

    def test_imperative_note_rejected(self):
        self.finding["awareness"]["text"] = "Stop your experiment and switch to compact navigation."
        with self.assertRaises(ValueError):
            make_report(self.prepared, self.analyses, self.finding, "test")

    def test_factual_mandatory_constraint_is_not_work_redirection(self):
        self.finding["awareness"]["text"] = (
            "Every navigation item must show visible keyboard focus and support Tab access."
        )
        report = make_report(self.prepared, self.analyses, self.finding, "test")
        self.assertEqual(len(report["awarenessNotes"]), 1)

    def test_wrong_request_project_or_target_fails(self):
        for field in ["projectId", "targetSessionId", "targetWorkerId"]:
            request = {**self.request, field: "other"}
            with self.subTest(field=field), self.assertRaises(ValueError):
                prepare(request, self.snapshot)

    def test_large_snapshot_rejected_before_scanning_history(self):
        self.snapshot["events"] *= 1001
        with self.assertRaises(ValueError):
            prepare(self.request, self.snapshot)

    def test_unknown_worker_and_unshared_session_fail(self):
        self.snapshot["workers"] = []
        with self.assertRaises(ValueError):
            prepare(self.request, self.snapshot)
        _, self.snapshot = example()
        self.snapshot["sharedSessions"] = self.snapshot["sharedSessions"][1:]
        with self.assertRaises(ValueError):
            prepare(self.request, self.snapshot)

    def test_unrelated_history_and_ui_secrets_never_exported(self):
        self.snapshot["events"].append(
            {"sessionId": "private", "content": {"password": "do not send"}}
        )
        self.snapshot["deliveries"] = [{"approvalToken": "do not send"}]
        self.assertNotIn("do not send", json.dumps(prepare(self.request, self.snapshot)))

    def test_payloads_secrets_and_large_events_rejected(self):
        for content in [
            {"toolOutput": "raw file"},
            {"role": "assistant", "text": "password=secret-value"},
            {"role": "assistant", "text": "x" * 8001},
        ]:
            self.snapshot["events"][0]["content"] = content
            with self.subTest(content=list(content)), self.assertRaises(ValueError):
                prepare(self.request, self.snapshot)

    def test_cap_is_visible_and_old_reference_rejected(self):
        event = self.snapshot["events"][0]
        self.snapshot["events"] += [
            {**event, "revision": n, "eventId": f"extra-{n}"} for n in range(2, 24)
        ]
        self.snapshot["sharedSessions"][0]["revision"] = 23
        with self.assertRaises(ValueError):
            prepare(self.request, self.snapshot)
        self.request["evidenceRefs"][0].update(eventId="extra-23", revision=23)
        prepared = prepare(self.request, self.snapshot)
        self.assertEqual(len(prepared["inputs"][0]["events"]), 20)
        self.assertEqual(len(prepared["warnings"]), 1)

    def test_model_cannot_add_approval_or_status_authority(self):
        self.finding["approved"] = True
        with self.assertRaises(ValueError):
            make_report(self.prepared, self.analyses, self.finding, "test")

    def test_warnings_preserved_and_planned_stays_planned(self):
        self.prepared["warnings"] = ["Input truncated"]
        self.analyses[0]["result"]["warnings"] = ["Uncertain finding"]
        self.analyses[0]["result"]["workState"] = "planned"
        self.finding["warnings"] = ["Review the source"]
        report = make_report(self.prepared, self.analyses, self.finding, "test")
        self.assertEqual(len(report["warnings"]), 3)
        self.assertEqual(report["summaries"][0]["workState"], "planned")


class LifecycleTest(unittest.TestCase):
    def test_new_id_cannot_replace_unresolved_remote_run(self):
        calls = []

        def runner(prepared, directory, timeout):
            calls.append(1)
            return {
                "state": "failed",
                "error": "Timeout",
                "runIds": ["test-run"],
                "remoteUnresolved": ["test-run"],
            }

        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            for request_id in ["first", "replacement"]:
                with self.assertRaises(CoordinationFailure):
                    coordinate(*example(request_id), state_dir=directory, runner=runner)
        self.assertEqual(len(calls), 1)

    def test_durable_repeat_request_launches_once_and_conflict_fails(self):
        calls = []

        def runner(prepared, directory, timeout):
            calls.append(prepared)
            return {"state": "completed", "report": {"requestId": prepared["request"]["requestId"]}}

        request, snapshot = example()
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            first = coordinate(request, snapshot, state_dir=directory, runner=runner)
            self.assertEqual(
                coordinate(request, snapshot, state_dir=directory, runner=runner), first
            )
            snapshot["events"][0]["content"]["text"] += " Changed evidence."
            with self.assertRaises(ValueError):
                coordinate(request, snapshot, state_dir=directory, runner=runner)
        self.assertEqual(len(calls), 1)

    def test_failed_run_not_success_and_retry_does_not_launch(self):
        calls = []

        def runner(prepared, directory, timeout):
            calls.append(1)
            return {
                "state": "failed",
                "error": "Remote failure",
                "runIds": ["test-123"],
                "terminalStates": {"test-123": "finished:failed"},
            }

        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            for _ in range(2):
                with self.assertRaises(CoordinationFailure) as caught:
                    coordinate(*example(), state_dir=directory, runner=runner)
                self.assertEqual(caught.exception.outcome["runIds"], ["test-123"])
        self.assertEqual(len(calls), 1)

    def test_concurrent_requests_only_launch_once(self):
        calls = []

        def runner(prepared, directory, timeout):
            calls.append(1)
            return {"state": "completed", "report": {"requestId": "test"}}

        def call(directory):
            try:
                return coordinate(*example(), state_dir=directory, runner=runner)
            except CoordinationFailure:
                return None

        with (
            tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory,
            ThreadPoolExecutor(max_workers=2) as pool,
        ):
            list(pool.map(call, [directory, directory]))
        self.assertEqual(len(calls), 1)

    def test_real_subprocess_deadline_without_network(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            outcome = execute(prepare(*example()), Path(directory), timeout=0.001)
        self.assertEqual(outcome["state"], "failed")
        self.assertIn("deadline", outcome["error"])

    def test_partial_journal_preserves_run_id(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            path = Path(directory) / "events.jsonl"
            path.write_text('{"runId":"123","state":"submitted"}\n{"truncated', encoding="utf-8")
            self.assertEqual(journal_events(path)[0]["runId"], "123")


if __name__ == "__main__":
    unittest.main()
