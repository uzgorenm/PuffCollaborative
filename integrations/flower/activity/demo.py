"""Print only a synthetic evidence envelope; never contacts Jev or Flower."""

import json
from pathlib import Path

from activity.pipeline import Activity


def main():
    path = Path(__file__).resolve().parents[1] / "fixtures" / "activity" / "keyboard_constraint.json"
    data = json.loads(path.read_text())
    activity = Activity(data["projectId"], data["sessions"], data["workers"])
    for event in data["events"]:
        activity.ingest(event)
    envelope = activity.snapshot(list(activity.sessions))
    print(json.dumps({"synthetic": True, **envelope}, indent=2))


if __name__ == "__main__":
    main()
