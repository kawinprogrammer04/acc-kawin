"""Business rules for automatically classifying CRM cashflow statements."""

from __future__ import annotations

from typing import Optional


# Keep the more-specific ADS rules ahead of the broad PAY rule.  A Description
# containing both an ADS identifier and PAY must remain classified as ADS.
CRM_CASHFLOW_DESCRIPTION_NOTE_RULES: tuple[tuple[str, str], ...] = (
    ("kbank x7675", "ADS AMEX"),
    ("scb x2988", "ADS SCB"),
    ("scb x9566", "ADS"),
    ("1892112988", "ADS SCB"),
    ("scb x699", "ค่า ADS Shopee"),
    ("pay", "รายการอื่นๆ"),
)


def classify_crm_cashflow_note(description: Optional[str]) -> Optional[str]:
    """Return the automatic note for a Description, if a rule matches.

    Matching is case-insensitive substring matching after trimming leading and
    trailing whitespace.  Rules are evaluated in declaration order so the
    specific ADS rules take precedence over the generic PAY rule.
    """
    normalized = (description or "").strip().casefold()
    if not normalized:
        return None
    for keyword, note in CRM_CASHFLOW_DESCRIPTION_NOTE_RULES:
        if keyword in normalized:
            return note
    return None
