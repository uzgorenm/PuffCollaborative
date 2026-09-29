import asyncio
from copy import deepcopy
import json
from pathlib import Path
import unittest

from activity.pipeline import Activity, clean_event
from activity.jev import Jev, Refresh
from activity.coordination import selected_event


FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "activity"


def fixture(name="keyboard_constraint"):
    return json.loads((FIXTURES / (name + ".json")).read_text())


def loaded(name="keyboard_constraint"):
    data = fixture(name)
    activity = Activity(data["projectId"], data["sessions"], data["workers"])
    for event in data["events"]:
        activity.ingest(event)
    return activity


KEY = ("worker-compact", "compact")


class ActivityTests(unittest.TestCase):
    def test_all_synthetic_expected_cards_and_refreshes(self):
        for path in FIXTURES.glob("*.json"):
            if path.name == "sample_snapshot.json":
                continue
            data = json.loads(path.read_text())
            with self.subTest(case=data["name"]):
                self.assertTrue(data["synthetic"])
                activity = Activity(data["projectId"], data["sessions"], data["workers"])
                refresh = Refresh()
                for index, event in enumerate(data["events"]):
                    activity.ingest(event)
                    key = (event["workerId"], event["sessionId"])
                    now = index * 20
                    refresh.observe(key, event["revision"], now)
                    refresh.classified(key, event["revision"], data["classifications"][index])
                    self.assertEqual(bool(refresh.due(now + 2)), data["expectedRefresh"][index])
                for session, expected in data["expectedCards"].items():
                    card = activity.card(("worker-" + session, session))
                    self.assertEqual({key: card[key] for key in expected}, expected)

    def test_queue_does_not_change_running_objective(self):
        data = fixture("queued_vs_started")
        activity = Activity(data["projectId"], data["sessions"], data["workers"])
        for event in data["events"][:2]:
            activity.ingest(event)
        card = activity.card(KEY)
        self.assertEqual(card["objective"], "Explore navigation")
        self.assertEqual(card["status"], "running")
        self.assertEqual(card["upNext"][0]["objective"], "Build settings page")
        activity.ingest(data["events"][2])
        self.assertEqual(activity.card(KEY)["objective"], "Build settings page")

    def test_reordered_events_and_duplicate_replay(self):
        data = fixture("queued_vs_started")
        activity = Activity(data["projectId"], data["sessions"], data["workers"])
        for event in reversed(data["events"]):
            activity.ingest(event)
        self.assertEqual(activity.card(KEY), loaded("queued_vs_started").card(KEY))
        self.assertFalse(activity.ingest(data["events"][0]))
        bad = deepcopy(data["events"][0])
        bad["content"]["objective"] = "conflict"
        with self.assertRaises(ValueError):
            activity.ingest(bad)

    def test_wrong_identity_and_revision_rejected(self):
        activity = loaded()
        for field, value in (("projectId", "other"), ("workerId", "other"),
                             ("sessionId", "other"), ("revision", True), ("revision", -1)):
            event = deepcopy(fixture()["events"][0])
            event[field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                activity.ingest(event)

    def test_old_summary_cannot_overwrite_current_card_or_status(self):
        activity = loaded()
        card = activity.card(KEY)
        self.assertFalse(activity.apply_summary(KEY, 1, {"objective": "old"}, card["evidenceRefs"]))
        self.assertEqual(activity.card(KEY), card)
        self.assertTrue(activity.apply_summary(KEY, 2, {"objective": "Navigation with keyboard support"}, card["evidenceRefs"]))
        self.assertFalse(activity.apply_summary(KEY, 2, {"objective": "retry"}, card["evidenceRefs"]))
        with self.assertRaises(ValueError):
            activity.apply_summary(KEY, 2, {"status": "completed"}, card["evidenceRefs"])
        self.assertEqual(activity.card(KEY)["status"], "running")
        with self.assertRaises(ValueError):
            activity.apply_summary(KEY, 2, {"objective": "invented"}, [{"eventId": "missing"}])

    def test_snapshot_cap_allowlist_relationship_and_unshare(self):
        activity = loaded()
        for revision in range(3, 25):
            event = deepcopy(fixture()["events"][0])
            event.update(eventId=f"more-{revision}", revision=revision, kind="activity")
            event["content"] = {"toolName": "test", "toolStatus": "completed", "input": "PRIVATE", "output": "PRIVATE"}
            activity.ingest(event)
        envelope = activity.snapshot([KEY, ("worker-full", "full")])
        self.assertEqual(sum(event["sessionId"] == "compact" for event in envelope["snapshot"]["events"]), 20)
        self.assertEqual(envelope["warnings"][0]["omitted"], 4)
        self.assertNotIn("PRIVATE", json.dumps(envelope))
        self.assertTrue(all(s["relationship"] == "alternative" for s in envelope["snapshot"]["sessions"]))
        activity.set_sharing(KEY, False)
        self.assertEqual(activity.snapshot([KEY])["snapshot"]["events"], [])
        self.assertFalse(activity.ingest(fixture()["events"][0]))

    def test_oversized_and_nonpermitted_messages_rejected(self):
        event = deepcopy(fixture("continuation")["events"][1])
        event["content"]["text"] = "x" * 8001
        with self.assertRaises(ValueError):
            clean_event(event)
        event["content"] = {"role": "system", "text": "hidden"}
        with self.assertRaises(ValueError):
            clean_event(event)

    def test_unshared_and_unrequested_sessions_absent(self):
        data = fixture()
        data["sessions"][1]["shared"] = False
        activity = Activity(data["projectId"], data["sessions"], data["workers"])
        for event in data["events"]:
            activity.ingest(event)
        self.assertNotIn("worker-full", json.dumps(activity.snapshot([KEY, ("worker-full", "full")])))
        self.assertNotIn("worker-full", json.dumps(loaded().snapshot([KEY])))


class RefreshTests(unittest.TestCase):
    def test_debounce_coalesces_and_no_duplicate_runs(self):
        refresh = Refresh()
        refresh.observe(KEY, 1, 0)
        refresh.classified(KEY, 1, "added_scope")
        refresh.observe(KEY, 2, 1)
        refresh.classified(KEY, 2, "continuation")
        self.assertEqual(refresh.due(2), [])
        self.assertEqual(refresh.due(3)[0]["revision"], 2)
        self.assertFalse(refresh.observe(KEY, 2, 4))
        self.assertEqual(refresh.due(100), [])

    def test_unavailable_or_hung_classification_has_bounded_fallback(self):
        refresh = Refresh()
        for revision in range(1, 16):
            refresh.observe(KEY, revision, revision - 1)
        self.assertEqual(refresh.due(14), [])
        self.assertEqual(refresh.due(15)[0]["reason"], "fallback")

    def test_stale_classification_ignored(self):
        refresh = Refresh()
        refresh.observe(KEY, 1, 0)
        refresh.observe(KEY, 2, 1)
        self.assertFalse(refresh.classified(KEY, 1, "continuation"))
        self.assertEqual(refresh.due(15)[0]["revision"], 2)


class CoordinationTests(unittest.TestCase):
    def test_sparse_project_sequence_and_feedback_filter(self):
        thread = {"id": "thread-a", "projectId": "synthetic-puff", "workerId": KEY[0],
                  "sessionId": KEY[1], "activitySeq": 42}
        event = {"id": "evt-42", "projectId": "synthetic-puff", "threadId": "thread-a",
                 "seq": 42, "kind": "run.output", "occurredAt": "2026-09-29T18:00:00Z",
                 "payload": {"secret": "NEVER EXPORT"}}
        content = {"role": "assistant", "text": "Selected finding"}
        result = selected_event(event, thread, content, shared=True)
        self.assertEqual(result["event"]["revision"], 42)
        self.assertEqual(result["sourceRef"], {"threadId": "thread-a", "eventId": "evt-42", "seq": 42})
        self.assertNotIn("NEVER EXPORT", json.dumps(result))
        self.assertIsNone(selected_event(event, thread, content, shared=False))
        for provenance in ("awareness", "acknowledgment"):
            self.assertIsNone(selected_event(event, thread, content, shared=True, provenance=provenance))
        event["kind"] = "work-card.updated"
        self.assertIsNone(selected_event(event, thread, content, shared=True))

    def test_mismatched_identity_future_sequence_and_status_fail(self):
        thread = {"id": "thread-a", "projectId": "synthetic-puff", "workerId": KEY[0],
                  "sessionId": KEY[1], "activitySeq": 42}
        event = {"id": "evt-42", "projectId": "synthetic-puff", "threadId": "thread-a",
                 "seq": 42, "kind": "run.started", "occurredAt": "2026-09-29T18:00:00Z"}
        with self.assertRaises(ValueError):
            selected_event(event, thread, {"transition": "completed"}, shared=True)
        for field, value in (("seq", 43), ("threadId", "wrong"), ("projectId", "wrong")):
            with self.subTest(field=field), self.assertRaises(ValueError):
                selected_event({**event, field: value}, thread,
                               {"transition": "started", "instructionId": "i"}, shared=True)


class JevTests(unittest.IsolatedAsyncioTestCase):
    async def test_documented_wire_format_and_injected_client(self):
        async def client(payload):
            self.assertEqual(payload["model"], "jev-latest")
            self.assertEqual(payload["questions"]["change"]["type"], "choice")
            return {"answers": {"change": {"type": "choice", "choice": "pivot", "confidence": 0.9}}}
        activity = loaded()
        before = activity.card(KEY)
        self.assertEqual(await Jev(client).classify(activity.classifier_state(KEY, before)), "pivot")
        self.assertEqual(activity.card(KEY), before)

    async def test_bad_confidence_and_unknown_choice_fall_back(self):
        for choice, confidence in (("grant_permission", 1), ("pivot", 0.1), ("pivot", float("nan")), ("pivot", True)):
            async def client(payload):
                return {"answers": {"change": {"type": "choice", "choice": choice, "confidence": confidence}}}
            self.assertIsNone(await Jev(client).classify("synthetic"))

    async def test_timeout_failure_and_malformed_response_are_safe(self):
        async def slow(payload):
            await asyncio.sleep(1)
        async def fail(payload):
            raise RuntimeError("sensitive provider diagnostic")
        async def malformed(payload):
            return {"bad": "shape"}
        for client in (slow, fail, malformed):
            self.assertIsNone(await Jev(client, timeout=0.01).classify("synthetic"))


if __name__ == "__main__":
    unittest.main()
