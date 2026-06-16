"""Upload-time BOM validation against bw2data (Patch 2).

The validator runs once per workbook import. It distinguishes errors (block
LCA computation) from warnings (allow but surface). It is intentionally NOT
re-run on every compute — see ``CLAUDE.md`` "Archetype validation lifecycle"
for the rationale.

Key invariants:
  * Each ``(database, code)`` is looked up in bw2data at most once per pass,
    even if the code is referenced by 16+ BOM rows. The cache is a dict
    scoped to a single ``validate_bom()`` call.
  * Rows without an ``ecoinvent_code`` are silently skipped — they're abstract
    or aggregated nodes that don't contribute to LCA.
  * Validation order is cheapest-first: structural checks → database existence
    → code resolution → name/location consistency. We only hit bw2data once
    we know the inputs are well-formed.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, field

from mapper.models.bom_schemas import (
    ValidationGroup,
    ValidationGroupAffected,
    ValidationIssue,
    ValidationReport,
)


logger = logging.getLogger(__name__)


@dataclass
class BOMValidationRow:
    """A single material row to validate. Constructed by the upload endpoint
    after parsing the workbook — keeps the validator decoupled from openpyxl
    and the BOM tree shape.
    """
    archetype: str
    stage: str
    row_idx: int                        # 1-indexed Excel row (or synthetic)
    name: str                           # BOM material name
    database: str | None                # raw value from "Ecoinvent Database"
    code: str | None                    # raw value from "Ecoinvent Code"
    ecoinvent_name: str = ""            # raw "Ecoinvent Name", for warning compare
    ecoinvent_location: str = ""        # raw "Ecoinvent Location", ditto


@dataclass
class _ValidationContext:
    """Mutable state accumulated as we walk rows."""
    issues: list[ValidationIssue] = field(default_factory=list)
    # (db, code) → activity dict (name, location) | None  (None = lookup failed)
    code_cache: dict[tuple[str, str], dict | None] = field(default_factory=dict)
    # db → bool   (cached database existence)
    db_cache: dict[str, bool] = field(default_factory=dict)
    bw2_lookups: int = 0
    cache_hits: int = 0


_EXPECTED_CODE_LENGTH = 32  # ecoinvent activity codes are 32-char hex strings


# ── Public API ───────────────────────────────────────────────────────────────


def validate_bom(
    rows: list[BOMValidationRow],
    project_name: str,
) -> ValidationReport:
    """Validate BOM rows against the bw2 project. Returns a structured report.

    The report is the source of truth for blocking LCA compute — see
    ``ArchetypeValidationLifecycle`` in CLAUDE.md.
    """
    ctx = _ValidationContext()
    seen_rows = 0
    error_row_keys: set[tuple[str, str, int]] = set()
    warning_row_keys: set[tuple[str, str, int]] = set()
    valid_row_keys: set[tuple[str, str, int]] = set()

    for row in rows:
        db_raw = (row.database or "").strip()
        code_raw = (row.code or "").strip()

        # Skip non-LCA rows: no code, no db. These are abstract/aggregated
        # nodes (e.g. a "battery pack" component). Not an error.
        if not db_raw and not code_raw:
            continue

        seen_rows += 1
        key = (row.archetype, row.stage, row.row_idx)

        # ── Structural: code XOR database mismatch ──────────────────────
        if code_raw and not db_raw:
            ctx.issues.append(_issue(
                row, "error", "code_no_database", code_raw,
                f"Row {row.row_idx} ({row.archetype}, {row.stage}, {row.name}): "
                f"code '{code_raw}' set but Ecoinvent Database is empty.",
            ))
            error_row_keys.add(key)
            continue
        if db_raw and not code_raw:
            ctx.issues.append(_issue(
                row, "error", "database_no_code", db_raw,
                f"Row {row.row_idx} ({row.archetype}, {row.stage}, {row.name}): "
                f"Ecoinvent Database '{db_raw}' set but code is empty.",
            ))
            error_row_keys.add(key)
            continue

        # ── Structural: code length ─────────────────────────────────────
        if len(code_raw) != _EXPECTED_CODE_LENGTH:
            ctx.issues.append(_issue(
                row, "error", "code_truncated", code_raw,
                f"Row {row.row_idx} ({row.archetype}, {row.stage}, {row.name}): "
                f"code '{code_raw}' has wrong length "
                f"(expected {_EXPECTED_CODE_LENGTH} chars, got {len(code_raw)}). "
                f"Likely truncated during data entry.",
            ))
            error_row_keys.add(key)
            continue

        # ── Database existence ──────────────────────────────────────────
        if not _database_exists(db_raw, ctx):
            ctx.issues.append(_issue(
                row, "error", "database_missing", db_raw,
                f"Row {row.row_idx} ({row.archetype}, {row.stage}, {row.name}): "
                f"database '{db_raw}' not found in project '{project_name}'.",
            ))
            error_row_keys.add(key)
            continue

        # ── Code resolution ─────────────────────────────────────────────
        activity = _resolve_code(db_raw, code_raw, ctx)
        if activity is None:
            ctx.issues.append(_issue(
                row, "error", "code_not_found", code_raw,
                f"Row {row.row_idx} ({row.archetype}, {row.stage}, {row.name}): "
                f"code '{code_raw}' not found in database '{db_raw}'.",
            ))
            error_row_keys.add(key)
            continue

        # ── Name / location consistency (warnings, not errors) ──────────
        actual_name = (activity.get("name") or "").strip()
        actual_location = (activity.get("location") or "").strip()
        bom_name = row.ecoinvent_name.strip()
        bom_location = row.ecoinvent_location.strip()

        row_had_warning = False
        if bom_name and actual_name and bom_name != actual_name:
            ctx.issues.append(_issue(
                row, "warning", "name_mismatch", bom_name,
                f"Row {row.row_idx}: BOM name '{bom_name}' differs from "
                f"ecoinvent name '{actual_name}' for code '{code_raw}'. "
                f"Code is correct, but BOM annotation may be stale.",
            ))
            row_had_warning = True
        if bom_location and actual_location and bom_location != actual_location:
            ctx.issues.append(_issue(
                row, "warning", "location_mismatch", bom_location,
                f"Row {row.row_idx}: BOM location '{bom_location}' differs from "
                f"ecoinvent location '{actual_location}' for code '{code_raw}'. "
                f"Code is correct, but BOM annotation may be stale.",
            ))
            row_had_warning = True

        if row_had_warning:
            warning_row_keys.add(key)
        else:
            valid_row_keys.add(key)

    groups = _group_issues(ctx.issues)

    error_rows = len(error_row_keys)
    warning_rows = len(warning_row_keys)
    valid_rows = len(valid_row_keys)

    logger.info(
        "[bom-validator] project=%r rows=%d valid=%d errors=%d warnings=%d "
        "bw2_lookups=%d cache_hits=%d",
        project_name, seen_rows, valid_rows, error_rows, warning_rows,
        ctx.bw2_lookups, ctx.cache_hits,
    )

    return ValidationReport(
        total_rows=seen_rows,
        valid_rows=valid_rows,
        error_rows=error_rows,
        warning_rows=warning_rows,
        issues=ctx.issues,
        groups=groups,
        project_name=project_name,
        bw2_lookups=ctx.bw2_lookups,
        cache_hits=ctx.cache_hits,
    )


# ── Private helpers ──────────────────────────────────────────────────────────


def _issue(
    row: BOMValidationRow,
    severity: str,
    error_type: str,
    bad_value: str,
    message: str,
) -> ValidationIssue:
    return ValidationIssue(
        severity=severity,  # type: ignore[arg-type]
        error_type=error_type,  # type: ignore[arg-type]
        archetype=row.archetype,
        stage=row.stage,
        row_idx=row.row_idx,
        name=row.name,
        bad_value=bad_value,
        message=message,
        bom_ecoinvent_name=(row.ecoinvent_name or "").strip(),
    )


def _database_exists(db_name: str, ctx: _ValidationContext) -> bool:
    if db_name in ctx.db_cache:
        ctx.cache_hits += 1
        return ctx.db_cache[db_name]
    try:
        import bw2data  # imported lazily so the validator module is testable
        exists = db_name in bw2data.databases
    except Exception:  # pragma: no cover — bw2 unavailable in test env
        exists = False
    ctx.db_cache[db_name] = exists
    ctx.bw2_lookups += 1
    return exists


def _resolve_code(
    db_name: str,
    code: str,
    ctx: _ValidationContext,
) -> dict | None:
    key = (db_name, code)
    if key in ctx.code_cache:
        ctx.cache_hits += 1
        return ctx.code_cache[key]
    try:
        import bw2data
        act = bw2data.get_activity((db_name, code))
        result = {
            "name": act.get("name", "") or "",
            "location": act.get("location", "") or "",
        }
    except Exception:
        result = None
    ctx.code_cache[key] = result
    ctx.bw2_lookups += 1
    return result


def _group_issues(issues: list[ValidationIssue]) -> list[ValidationGroup]:
    """Collapse the issue list into (severity, error_type, bad_value) groups
    so the frontend can render "6 truncated codes affecting 41 rows" instead
    of 41 lines."""
    buckets: dict[tuple[str, str, str], list[ValidationIssue]] = defaultdict(list)
    for issue in issues:
        buckets[(issue.severity, issue.error_type, issue.bad_value)].append(issue)

    groups: list[ValidationGroup] = []
    for (severity, error_type, bad_value), bucket in buckets.items():
        # First non-empty BOM name in the bucket — useful for code-related
        # issues so the user sees "the row your BOM called 'aluminum sheet'
        # has a bad code". Often blank for warnings (where bad_value already
        # IS the BOM name).
        bom_name = ""
        for it in bucket:
            cand = (it.bom_ecoinvent_name or "").strip()
            if cand:
                bom_name = cand
                break
        affected = [
            ValidationGroupAffected(
                archetype=it.archetype, stage=it.stage,
                row_idx=it.row_idx, name=it.name,
            )
            for it in bucket
        ]
        groups.append(ValidationGroup(
            severity=severity,  # type: ignore[arg-type]
            error_type=error_type,  # type: ignore[arg-type]
            bad_value=bad_value,
            bom_name=bom_name,
            count=len(affected),
            affected=affected,
        ))
    # Errors first, then warnings; within each, larger groups first.
    groups.sort(key=lambda g: (0 if g.severity == "error" else 1, -g.count))
    return groups


# ── Helpers for callers ──────────────────────────────────────────────────────


def issues_by_row(report: ValidationReport) -> dict[tuple[str, str, int], list[ValidationIssue]]:
    """Re-key the report's issue list by ``(archetype, stage, row_idx)`` so the
    upload endpoint can stamp ``validation_status`` / ``validation_message``
    onto the parsed BOMNode tree."""
    out: dict[tuple[str, str, int], list[ValidationIssue]] = defaultdict(list)
    for issue in report.issues:
        out[(issue.archetype, issue.stage, issue.row_idx)].append(issue)
    return out


def issues_by_node_key(
    report: ValidationReport,
) -> dict[tuple[str, str, str], list[ValidationIssue]]:
    """Re-key by ``(archetype, stage, name)`` — used when ``row_idx`` was lost
    (e.g. when round-tripping through the persisted Archetype). Names are
    unique within a stage by parser invariant; collisions are reported as
    parse warnings, not validation issues."""
    out: dict[tuple[str, str, str], list[ValidationIssue]] = defaultdict(list)
    for issue in report.issues:
        out[(issue.archetype, issue.stage, issue.name)].append(issue)
    return out
