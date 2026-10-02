"""Read complete chain records while tolerating an interrupted final write."""

import json
from pathlib import Path


def journal_events(path):
    path = Path(path)
    if not path.exists():
        return []
    events = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            # A killed process can leave one incomplete journal line.
            continue
    return events
