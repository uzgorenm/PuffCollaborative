"""Regression coverage for the local producer-to-chain walkthrough."""

import io
import json
import unittest
from contextlib import redirect_stdout

from bridge_demo import main


class BridgeDemoTest(unittest.TestCase):
    def test_current_source_finding_maps_to_an_undelivered_candidate(self):
        output = io.StringIO()
        with redirect_stdout(output):
            main()
        result = json.loads(output.getvalue())
        self.assertTrue(result["synthetic"])
        self.assertFalse(result["actorIdsForwardedToFlower"])
        self.assertEqual(result["selectedEventCount"], 4)
        note = result["awarenessNoteCandidate"]
        self.assertEqual(note["sourceActivitySeq"], 3)
        self.assertEqual(note["deliveryState"], "not_attempted")
        self.assertEqual(
            [ref for ref in note["evidenceRefs"] if ref["threadId"] == "thread-compact"],
            [{"threadId": "thread-compact", "eventId": "compact-3", "seq": 3}],
        )
        card = next(item for item in result["workCardUpdates"] if item["threadId"] == "thread-compact")
        self.assertEqual(card["sourceActivitySeq"], 3)
        self.assertIn("passed", card["recentVerifiedOutcome"])
        self.assertIn("OpenCode delivery or use", result["notProven"])
