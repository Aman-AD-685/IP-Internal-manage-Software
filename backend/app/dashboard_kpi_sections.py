"""

Dashboard KPI person-dashboard keys for user_section_permissions.



Add a new entry to ``DASHBOARD_KPI_DASHBOARDS`` — it appears automatically in Edit User

(via /permissions/section-catalog) and in login section_permissions after deploy.

Parent key ``dashboard_kpi`` gates the KPI route; each person row gates that dashboard.

"""

from __future__ import annotations



from typing import Any



# Canonical registry: append new person KPI dashboards here.

DASHBOARD_KPI_DASHBOARDS: tuple[dict[str, str], ...] = (

    {"name": "Shreyasi", "key": "dashboard_kpi_person_shreyasi", "label": "Shreyasi Dashboard"},

    {"name": "Rimpa", "key": "dashboard_kpi_person_rimpa", "label": "Rimpa Dashboard"},

    {"name": "Akash", "key": "dashboard_kpi_person_akash", "label": "Akash Dashboard"},

    {"name": "Adrija", "key": "dashboard_kpi_person_adrija", "label": "Adrija Dashboard"},
    {"name": "Soumya", "key": "dashboard_kpi_person_soumya", "label": "Soumya Dashboard"},
    {"name": "Souvik", "key": "dashboard_kpi_person_souvik", "label": "Souvik Dashboard"},
)



# Edit User + SECTION_KEYS merge (person dashboards only).

DASHBOARD_KPI_PERMISSION_SECTIONS: tuple[dict[str, str], ...] = tuple(

    {"key": d["key"], "label": d["label"], "group": "person"} for d in DASHBOARD_KPI_DASHBOARDS

)



DASHBOARD_KPI_SUBSECTION_KEYS: tuple[str, ...] = tuple(d["key"] for d in DASHBOARD_KPI_DASHBOARDS)



PERSON_KEY_BY_DASHBOARD_NAME: dict[str, str] = {d["name"]: d["key"] for d in DASHBOARD_KPI_DASHBOARDS}



DASHBOARD_KPI_PERSON_NAMES: tuple[str, ...] = tuple(d["name"] for d in DASHBOARD_KPI_DASHBOARDS)





def dashboard_kpi_section_catalog() -> dict[str, Any]:

    """Catalog for Edit User UI (person dashboards only)."""

    items = [{"key": d["key"], "label": d["label"], "group": "person", "name": d["name"]} for d in DASHBOARD_KPI_DASHBOARDS]

    return {

        "parent_key": "dashboard_kpi",

        "parent_label": "Dashboard - KPI (page access)",

        "dashboards": list(DASHBOARD_KPI_DASHBOARDS),

        "subsections": items,

        "groups": [{"id": "person", "label": "Dashboards", "items": items}],

    }





def merge_section_keys(base_keys: list[str]) -> list[str]:

    """Insert KPI person-dashboard keys immediately after ``dashboard_kpi``."""

    out: list[str] = []

    for key in base_keys:

        out.append(key)

        if key == "dashboard_kpi":

            out.extend(DASHBOARD_KPI_SUBSECTION_KEYS)

    return out


