"""
Stage logic for Support tickets - mirrors frontend helpers.
Used for pending reminder digest (Chores&Bug and Feature/Staging by stage).
"""
from datetime import datetime
from typing import Any


def get_chores_bugs_stage(t: dict) -> dict:
    """
    Return current stage for Chores & Bug ticket.
    Keys: stage_num, stage_label, assignee_id
    """
    status_1 = t.get("status_1")
    status_2 = t.get("status_2")
    status_3 = t.get("status_3")
    actual_1 = t.get("actual_1")
    actual_2 = t.get("actual_2")
    actual_3 = t.get("actual_3")
    actual_4 = t.get("actual_4")
    planned_2 = t.get("planned_2")
    planned_3 = t.get("planned_3")
    planned_4 = t.get("planned_4")
    created_at = t.get("created_at")

    if not status_1:
        return {"stage_num": 1, "stage_label": "Stage 1", "assignee_id": t.get("assignee_id")}
    if status_1 == "yes":
        return {"stage_num": 4, "stage_label": "Stage 4", "assignee_id": t.get("assignee_id")}
    if status_1 == "no" and not status_2:
        return {"stage_num": 2, "stage_label": "Stage 2", "assignee_id": t.get("assignee_id")}
    if status_2 == "completed" and not status_3:
        return {"stage_num": 3, "stage_label": "Stage 3", "assignee_id": t.get("assignee_id")}
    if status_2 == "completed" or status_1 == "yes":
        return {"stage_num": 4, "stage_label": "Stage 4", "assignee_id": t.get("assignee_id")}
    return {"stage_num": 2, "stage_label": "Stage 2", "assignee_id": t.get("assignee_id")}


def get_staging_feature_stage(t: dict) -> dict:
    """
    Return current stage for Feature / Staging ticket.
    Keys: stage_num, stage_label, assignee_id
    """
    staging_review_status = t.get("staging_review_status")
    live_status = t.get("live_status")
    live_review_status = t.get("live_review_status")
    approval_status = t.get("approval_status")
    staging_planned = t.get("staging_planned")
    status_2 = t.get("status_2")

    # Feature not yet in staging - Approval Status section
    if not staging_planned and status_2 != "staging":
        if approval_status is None:
            return {"stage_num": 0, "stage_label": "Approval Pending", "assignee_id": t.get("assignee_id")}
        return {"stage_num": 0, "stage_label": f"Approval ({approval_status or 'pending'})", "assignee_id": t.get("assignee_id")}

    # In staging workflow
    if staging_review_status != "completed":
        return {"stage_num": 1, "stage_label": "Stage 1: Staging", "assignee_id": t.get("assignee_id")}
    if live_status != "completed":
        return {"stage_num": 2, "stage_label": "Stage 2: Live", "assignee_id": t.get("assignee_id")}
    if live_review_status != "completed":
        return {"stage_num": 3, "stage_label": "Stage 3: Live Review", "assignee_id": t.get("assignee_id")}
    return {"stage_num": 4, "stage_label": "Completed", "assignee_id": t.get("assignee_id")}


def get_feature_section_stage(t: dict) -> dict:
    """Feature section: only approved features in staging. Same as get_staging_feature_stage."""
    return get_staging_feature_stage(t)


def is_chores_bug_pending(t: dict) -> bool:
    """True if Chores & Bug ticket is still pending (not fully completed)."""
    if str(t.get("status_2") or "").strip().lower() == "na":
        return False
    quality = t.get("quality_solution")
    live_review = t.get("live_review_status")
    if quality or live_review == "completed":
        return False
    staging_planned = t.get("staging_planned")
    status_2 = t.get("status_2")
    if staging_planned or status_2 == "staging":
        return True  # in staging workflow
    return True  # in chores-bugs section


def is_feature_pending(t: dict) -> bool:
    """True if Feature ticket is pending (not fully completed)."""
    if str(t.get("status_2") or "").strip().lower() == "na":
        return False
    live_review = t.get("live_review_status")
    if live_review == "completed":
        return False
    return True
