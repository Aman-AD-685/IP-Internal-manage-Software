"""KPI person dashboards vs user_profiles.is_active (Users page Status)."""
from __future__ import annotations

import threading

from cachetools import TTLCache

from app.dashboard_kpi_sections import DASHBOARD_KPI_PERSON_NAMES
from app.supabase_client import supabase

_CACHE: TTLCache = TTLCache(maxsize=1, ttl=60)
_LOCK = threading.Lock()


def _profile_matches_person(full_name: str | None, person_name: str) -> bool:
    return person_name.lower() in (full_name or "").lower()


def clear_kpi_person_active_cache() -> None:
    with _LOCK:
        _CACHE.clear()


def _load_profiles() -> list[dict]:
    with _LOCK:
        cached = _CACHE.get("profiles")
        if cached is not None:
            return list(cached)
    try:
        r = supabase.table("user_profiles").select("full_name, is_active").limit(2000).execute()
        rows = r.data or []
    except Exception:
        rows = []
    with _LOCK:
        _CACHE["profiles"] = rows
    return rows


def is_kpi_person_active(person_name: str) -> bool:
    """False when every matching profile is inactive; True if any match is active or none match."""
    person = (person_name or "").strip()
    if not person:
        return False
    matches = [p for p in _load_profiles() if _profile_matches_person(p.get("full_name"), person)]
    if not matches:
        return True  # ponytail: no linked profile — keep legacy dashboards
    return any(p.get("is_active", True) for p in matches)


def get_active_kpi_person_names() -> tuple[str, ...]:
    return tuple(p for p in DASHBOARD_KPI_PERSON_NAMES if is_kpi_person_active(p))


def _self_check() -> None:
    assert _profile_matches_person("Adrija Biswas", "Adrija")
    assert not _profile_matches_person("Aman Kumar", "Adrija")


if __name__ == "__main__":
    _self_check()
