"""Business rules for automatically classifying CRM cashflow statements."""

from __future__ import annotations

from typing import Optional


# Keep the more-specific ADS rules ahead of the PAY-prefix rule.  A Description
# containing both an ADS identifier and PAY must remain classified as ADS.
CRM_CASHFLOW_DESCRIPTION_NOTE_RULES: tuple[tuple[str, str], ...] = (
    ("kbank x7675", "ADS AMEX"),
    ("scb x2988", "ADS SCB"),
    ("scb x9566", "ADS"),
    ("1892112988", "ADS SCB"),
    ("scb x699", "ค่า ADS Shopee"),
)
CRM_CASHFLOW_PAY_NOTE = "รายการอื่นๆ"


def classify_crm_cashflow_note(description: Optional[str]) -> Optional[str]:
    """Return the automatic note for a Description, if a rule matches.

    ADS matching is case-insensitive substring matching after trimming leading
    and trailing whitespace. PAY is matched only as a prefix, so ``EPAY`` does
    not qualify. Rules are evaluated in declaration order so ADS takes
    precedence when both patterns are present.
    """
    normalized = (description or "").strip().casefold()
    if not normalized:
        return None
    for keyword, note in CRM_CASHFLOW_DESCRIPTION_NOTE_RULES:
        if keyword in normalized:
            return note
    if normalized.startswith("pay"):
        return CRM_CASHFLOW_PAY_NOTE
    return None


def should_auto_verify_crm_cashflow_note(note: Optional[str]) -> bool:
    """Return whether a classified row should receive verified status.

    PAY rows are intentionally hidden from invoice tracking by their note, but
    they are not accounting verification decisions and must remain pending.
    """
    return bool(note) and note != CRM_CASHFLOW_PAY_NOTE
