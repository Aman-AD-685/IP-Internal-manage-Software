"""Support tickets marked NA via status_2 = 'na' (Chores Stage 2 / Feature Stage 1)."""


def ticket_marked_na(t: dict | None) -> bool:
    if not t:
        return False
    return str(t.get("status_2") or "").strip().lower() == "na"


def apply_exclude_ticket_na(q):
    """Hide NA-marked tickets from default lists and KPI queries."""
    return q.or_("status_2.is.null,status_2.neq.na")


def filter_out_ticket_na(rows: list[dict]) -> list[dict]:
    return [t for t in rows if not ticket_marked_na(t)]
