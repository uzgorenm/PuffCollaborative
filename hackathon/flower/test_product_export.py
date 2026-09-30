import copy
import unittest

from contracts import prepare
from smoke import example
from product_export import build_product_job


class ProductWorkerOwnershipTest(unittest.TestCase):
    def test_one_runner_host_can_execute_two_trusted_session_owners(self):
        request, snapshot = example()
        worker = snapshot["workers"][0]["workerId"]
        snapshot["workers"] = [{"workerId": worker, "projectId": request["projectId"]}]
        for index, session in enumerate(snapshot["sharedSessions"]):
            session["workerId"] = worker
            session["ownerId"] = f"trusted-owner-{index}"
        for event in snapshot["events"]:
            event["workerId"] = worker
        request["targetWorkerId"] = worker
        for ref in request["evidenceRefs"]:
            ref["workerId"] = worker
        prepared = prepare(request, snapshot)
        self.assertEqual(len(prepared["inputs"]), 2)
        self.assertEqual({item["session"]["workerId"] for item in prepared["inputs"]}, {worker})
        mismatched = copy.deepcopy(snapshot)
        mismatched["workers"][0]["ownerId"] = "another-owner"
        with self.assertRaises(ValueError):
            prepare(request, mismatched)
        unrelated = copy.deepcopy(snapshot)
        unrelated["workers"][0]["projectId"] = "another-project"
        with self.assertRaises(ValueError):
            prepare(request, unrelated)

    def test_server_export_keeps_content_revision_distinct_from_activity_cursor(self):
        request, snapshot = example()
        # The server supplies project-global sequences, unlike smoke's old
        # independent per-session fixture revisions.
        refs = {}
        for revision, event in enumerate(snapshot["events"], start=1):
            refs[event["eventId"]] = revision
            event["revision"] = revision
        for session in snapshot["sharedSessions"]:
            session["revision"] = max(event["revision"] for event in snapshot["events"] if event["sessionId"] == session["sessionId"])
        for ref in request["evidenceRefs"]:
            ref["revision"] = refs[ref["eventId"]]
        bindings, provenance = [], []
        for index, session in enumerate(snapshot["sharedSessions"]):
            bindings.append({
                "projectId": request["projectId"], "threadId": f"thread-{index}",
                **{key: session[key] for key in ("workerId", "sessionId", "ownerId", "title", "featureTopic", "relationship")},
                "activitySeq": session["revision"] + 5,
                "evidenceRevision": session["revision"], "expectedVersion": 0,
                "shared": True, "deterministicStatus": "active", "contributors": [],
            })
        by_session = {binding["sessionId"]: binding for binding in bindings}
        for event in snapshot["events"]:
            binding = by_session[event["sessionId"]]
            provenance.append({"threadId": binding["threadId"], "eventId": event["eventId"], "eventSeq": event["revision"], "threadActivitySeq": binding["activitySeq"]})
        envelope = {"request": request, "snapshot": snapshot, "provenance": provenance,
                    "bindings": bindings, "cooperationVersions": {binding["threadId"]: 1 for binding in bindings}}
        job = build_product_job(envelope)
        self.assertEqual(job.bindings_by_session[bindings[0]["sessionId"]]["activitySeq"], bindings[0]["activitySeq"])
        self.assertEqual(job.session_revisions[bindings[0]["sessionId"]], bindings[0]["evidenceRevision"])
        bad = copy.deepcopy(envelope)
        bad["provenance"][0]["threadId"] = "another-thread"
        with self.assertRaises(ValueError):
            build_product_job(bad)
