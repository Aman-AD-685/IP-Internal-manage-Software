"""Self-check: payment ageing company keyword + letter-compact dedupe.

Run: cd backend && python scripts/check_payment_ageing_dedupe.py
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.payment_ageing import (  # noqa: E402
    collapse_near_duplicate_keys,
    compact_company_key,
    normalize_company_name,
)

# Exact normalize merges
assert normalize_company_name("Dadiji Steel Manufacture & Trading Pvt Ltd") == normalize_company_name(
    "Dadiji Steels Manufacture & Trade Pvt Ltd"
)
assert normalize_company_name("Kodarma Chemical Pvt. Ltd.") == normalize_company_name("Kodarma Chemicals Ltd.")
assert normalize_company_name("Kodarma Petrochemicals Pvt. Ltd.") == normalize_company_name(
    "Kodarma Petrohemicals Pvt. Ltd."
)
assert normalize_company_name("Odissa Concrete & Allied Industries Limited") == normalize_company_name(
    "Orissa Concrete & Allied Industries Ltd"
)
assert normalize_company_name("Black Rock Steel & Power Pvt Ltd") == normalize_company_name(
    "BlackRock Steel & Power Pvt. Ltd"
)

# Letter-compact: space shift
assert compact_company_key(normalize_company_name("Black Rock Steel & Power Pvt Ltd")) == compact_company_key(
    normalize_company_name("BlackRock Steel & Power Pvt. Ltd")
)

# Distinct orgs stay distinct
assert normalize_company_name("Kodarma Chemical Pvt. Ltd.") != normalize_company_name(
    "Kodarma Petrochemicals Pvt. Ltd."
)
assert normalize_company_name("Orissa Concrete & Allied Industries Ltd") != normalize_company_name(
    "Orissa Concrete & Allied Industries Ltd. (Raipur)"
)
assert normalize_company_name("Odissa Concrete & Allied Industries Limited") != normalize_company_name(
    "Orissa Concrete & Allied Industries Ltd. (Raipur)"
)

keys = [
    normalize_company_name("Dadiji Steel Manufacture & Trading Pvt Ltd"),
    normalize_company_name("Dadiji Steels Manufacture & Trade Pvt Ltd"),
    normalize_company_name("Kodarma Chemical Pvt. Ltd."),
    normalize_company_name("Kodarma Petrochemicals Pvt. Ltd."),
    normalize_company_name("Orissa Concrete & Allied Industries Ltd"),
    normalize_company_name("Orissa Concrete & Allied Industries Ltd. (Raipur)"),
    normalize_company_name("Black Rock Steel & Power Pvt Ltd"),
    normalize_company_name("BlackRock Steel & Power Pvt. Ltd"),
]
canon = collapse_near_duplicate_keys(keys)
assert canon[keys[0]] == canon[keys[1]]
assert canon[keys[2]] != canon[keys[3]]
assert canon[keys[4]] != canon[keys[5]]
assert canon[keys[6]] == canon[keys[7]]

print("OK: payment ageing dedupe self-check passed")
