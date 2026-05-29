"""
Section permission checks aligned with login `section_permissions` (same rules as frontend helpers).

Use for API authorization — never rely on UI-only gating for KPI / IP / I-1 data.
"""
from __future__ import annotations

from fastapi import HTTPException

from app.dashboard_kpi_sections import PERSON_KEY_BY_DASHBOARD_NAME
from app.supabase_client import supabase

KPI_PERSON_KEY_PREFIX = "dashboard_kpi_person_"


def _fetch_perm_rows(user_id: str) -> list[dict]:
    try:
        r = (
            supabase.table("user_section_permissions")
            .select("section_key, can_view, can_edit")
            .eq("user_id", user_id)
            .execute()
        )
        return r.data or []
    except Exception:
        return []


def get_merged_section_permissions(user_id: str) -> list[dict]:
    """Same shape as login /users/me section_permissions."""
    from app.main import _build_section_permissions_list, _get_role_from_profile

    role = _get_role_from_profile(user_id)
    return _build_section_permissions_list(role, _fetch_perm_rows(user_id))


def can_view_section_from_list(perms: list[dict], section_key: str) -> bool:
    p = next((x for x in perms if x.get("section_key") == section_key), None)
    return bool(p and p.get("can_view"))


def can_edit_section_from_list(perms: list[dict], section_key: str) -> bool:
    p = next((x for x in perms if x.get("section_key") == section_key), None)
    return bool(p and p.get("can_view") and p.get("can_edit"))


def has_explicit_kpi_person_grants(perms: list[dict]) -> bool:
    return any(
        str(p.get("section_key") or "").startswith(KPI_PERSON_KEY_PREFIX)
        and (p.get("can_view") or p.get("can_edit"))
        for p in perms
    )


def can_view_dashboard_kpi_person(user_id: str, person_name: str) -> bool:
    """
    Mirrors fms-frontend/src/utils/dashboardKpiPermissions.ts.
    - Elevated roles (admin / master_admin) always see every person dashboard.
    - Legacy: dashboard_kpi granted with no person rows → all person dashboards allowed.
    """
    from app.main import _get_role_from_profile

    perms = get_merged_section_permissions(user_id)
    if not can_view_section_from_list(perms, "dashboard_kpi"):
        return False
    person_key = PERSON_KEY_BY_DASHBOARD_NAME.get((person_name or "").strip())
    if not person_key:
        return False
    try:
        if _get_role_from_profile(user_id) in ("admin", "master_admin"):
            return True
    except Exception:
        pass
    if not has_explicit_kpi_person_grants(perms):
        return True
    return can_view_section_from_list(perms, person_key)


def require_dashboard_kpi_person(user_id: str, person_name: str) -> None:
    if not can_view_dashboard_kpi_person(user_id, person_name):
        raise HTTPException(
            status_code=403,
            detail=f"No access to Dashboard KPI for {person_name!r}",
        )


def can_view_section(user_id: str, section_key: str, *, need_edit: bool = False) -> bool:
    perms = get_merged_section_permissions(user_id)
    if need_edit:
        return can_edit_section_from_list(perms, section_key)
    return can_view_section_from_list(perms, section_key)


def require_section_view(user_id: str, section_key: str, *, detail: str) -> None:
    if not can_view_section(user_id, section_key):
        raise HTTPException(status_code=403, detail=detail)


def require_section_edit(user_id: str, section_key: str, *, detail: str) -> None:
    if not can_view_section(user_id, section_key, need_edit=True):
        raise HTTPException(status_code=403, detail=detail)
