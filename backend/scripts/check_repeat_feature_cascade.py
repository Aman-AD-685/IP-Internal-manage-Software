"""Assert demo: Feature Done → Chore Form patch stops pending reminders."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.reminder_utils import is_chores_bug_pending
from app.ticket_similarity import build_chore_bug_auto_close_patch


def main() -> None:
    pending_child = {
        "type": "chore",
        "status": "open",
        "status_2": "pending",
        "status_3": "pending",
        "status_4": None,
        "quality_solution": None,
        "actual_2": None,
        "actual_3": None,
        "actual_4": None,
        "resolved_at": None,
    }
    assert is_chores_bug_pending(pending_child) is True

    patch = build_chore_bug_auto_close_patch(pending_child, now="2026-07-17T00:00:00Z")
    assert patch.get("quality_solution") == "Done"
    assert patch.get("status_3") == "completed"
    assert patch.get("status_4") == "completed"
    assert patch.get("status") == "resolved"
    assert patch.get("actual_2") == "2026-07-17T00:00:00Z"
    assert patch.get("actual_3") == "2026-07-17T00:00:00Z"
    assert patch.get("actual_4") == "2026-07-17T00:00:00Z"
    assert patch.get("resolved_at") == "2026-07-17T00:00:00Z"

    closed = {**pending_child, **patch}
    assert is_chores_bug_pending(closed) is False

    # Idempotent: already Done → empty patch
    assert build_chore_bug_auto_close_patch(closed) == {}

    # Feature-type child is ignored
    assert build_chore_bug_auto_close_patch({"type": "feature", "status_2": "pending"}) == {}

    print("ok: feature->chore auto-close patch stops pending reminders")


if __name__ == "__main__":
    main()
