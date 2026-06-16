"""Tests for Patch 2 — upload-time BOM validator.

Validates the rule matrix, the per-(db,code) cache, and the integration
contract that LCA compute returns 422 + structured pointer when an archetype
has error rows. Uses a stubbed bw2data namespace so the tests don't need a
real Brightway2 project.
"""
from __future__ import annotations

import sys
import types

import pytest


# ── bw2data stub fixture ────────────────────────────────────────────────────


@pytest.fixture
def fake_bw2(monkeypatch):
    """Replace ``bw2data`` with a controllable stub.

    ``activities`` is a dict[(db, code) → {name, location}] of valid lookups;
    anything else raises a synthesised exception (matching real bw2data
    behaviour for ``get_activity`` on a missing key).
    """
    fake = types.SimpleNamespace()
    fake.databases = {"ecoinvent-3.10-cutoff"}  # set works as `__contains__`
    fake.activities = {
        ("ecoinvent-3.10-cutoff", "a" * 32): {
            "name": "aluminium production, primary, ingot",
            "location": "RoW",
        },
        ("ecoinvent-3.10-cutoff", "b" * 32): {
            "name": "steel production, electric, low-alloyed",
            "location": "Europe without Switzerland",
        },
        ("ecoinvent-3.10-cutoff", "c" * 32): {
            "name": "polypropylene production, granulate",
            "location": "RER",
        },
    }
    fake.lookup_calls = []  # for the cache test

    def _get_activity(key):
        fake.lookup_calls.append(key)
        if key in fake.activities:
            spec = fake.activities[key]
            act = types.SimpleNamespace()
            act.get = lambda k, default="": spec.get(k, default)
            return act
        raise KeyError(key)

    fake.get_activity = _get_activity
    monkeypatch.setitem(sys.modules, "bw2data", fake)
    return fake


# ── Rule matrix ─────────────────────────────────────────────────────────────


def test_skips_rows_with_no_db_and_no_code(fake_bw2):
    """Abstract / aggregated rows with neither db nor code are silently ignored
    (they're non-LCA components, e.g. 'battery pack' aggregator)."""
    from mapper.core.bom_validator import BOMValidationRow, validate_bom

    rows = [
        BOMValidationRow(archetype="A", stage="Manufacturing", row_idx=2,
                         name="abstract_aggregator", database=None, code=None),
    ]
    report = validate_bom(rows, project_name="test")
    assert report.total_rows == 0
    assert report.error_rows == 0
    assert report.warning_rows == 0
    assert report.issues == []


def test_truncated_code_yields_error(fake_bw2):
    from mapper.core.bom_validator import BOMValidationRow, validate_bom

    rows = [
        BOMValidationRow(
            archetype="ICEV-Petrol", stage="Manufacturing", row_idx=42,
            name="aluminium sheet", database="ecoinvent-3.10-cutoff",
            code="abcdef0123456789",  # 16 chars — truncated
            ecoinvent_name="aluminium production",
        ),
    ]
    report = validate_bom(rows, project_name="test")
    assert report.error_rows == 1
    assert report.warning_rows == 0
    [issue] = report.issues
    assert issue.severity == "error"
    assert issue.error_type == "code_truncated"
    assert "wrong length" in issue.message
    assert "expected 32 chars, got 16" in issue.message
    # The cheap structural check must fire BEFORE we hit bw2data.
    assert fake_bw2.lookup_calls == []


def test_database_missing_yields_error(fake_bw2):
    from mapper.core.bom_validator import BOMValidationRow, validate_bom

    rows = [
        BOMValidationRow(
            archetype="A", stage="Manufacturing", row_idx=2, name="X",
            database="ecoinvent-99-bogus", code="a" * 32,
        ),
    ]
    report = validate_bom(rows, project_name="test")
    assert report.error_rows == 1
    [issue] = report.issues
    assert issue.error_type == "database_missing"


def test_code_not_found_yields_error(fake_bw2):
    from mapper.core.bom_validator import BOMValidationRow, validate_bom

    rows = [
        BOMValidationRow(
            archetype="A", stage="Manufacturing", row_idx=2, name="X",
            database="ecoinvent-3.10-cutoff",
            code="z" * 32,  # length OK, but not in the fake registry
        ),
    ]
    report = validate_bom(rows, project_name="test")
    assert report.error_rows == 1
    [issue] = report.issues
    assert issue.error_type == "code_not_found"
    assert "not found in database" in issue.message


def test_code_no_database_yields_error(fake_bw2):
    from mapper.core.bom_validator import BOMValidationRow, validate_bom

    rows = [
        BOMValidationRow(
            archetype="A", stage="Manufacturing", row_idx=2, name="X",
            database="", code="a" * 32,
        ),
    ]
    report = validate_bom(rows, project_name="test")
    assert report.error_rows == 1
    assert report.issues[0].error_type == "code_no_database"


def test_database_no_code_yields_error(fake_bw2):
    from mapper.core.bom_validator import BOMValidationRow, validate_bom

    rows = [
        BOMValidationRow(
            archetype="A", stage="Manufacturing", row_idx=2, name="X",
            database="ecoinvent-3.10-cutoff", code="",
        ),
    ]
    report = validate_bom(rows, project_name="test")
    assert report.error_rows == 1
    assert report.issues[0].error_type == "database_no_code"


def test_name_mismatch_yields_warning_not_error(fake_bw2):
    """Name divergence is informational — code is correct, BOM annotation is
    stale. Compute should still be allowed."""
    from mapper.core.bom_validator import BOMValidationRow, validate_bom

    rows = [
        BOMValidationRow(
            archetype="A", stage="Manufacturing", row_idx=2,
            name="aluminium sheet", database="ecoinvent-3.10-cutoff",
            code="a" * 32,
            ecoinvent_name="aluminium ingot, secondary",  # doesn't match "primary"
        ),
    ]
    report = validate_bom(rows, project_name="test")
    assert report.error_rows == 0
    assert report.warning_rows == 1
    [issue] = report.issues
    assert issue.severity == "warning"
    assert issue.error_type == "name_mismatch"


def test_location_mismatch_yields_warning(fake_bw2):
    from mapper.core.bom_validator import BOMValidationRow, validate_bom

    rows = [
        BOMValidationRow(
            archetype="A", stage="Manufacturing", row_idx=2,
            name="steel sheet", database="ecoinvent-3.10-cutoff",
            code="b" * 32,
            ecoinvent_name="steel production, electric, low-alloyed",
            ecoinvent_location="GLO",  # actual is "Europe without Switzerland"
        ),
    ]
    report = validate_bom(rows, project_name="test")
    assert report.error_rows == 0
    assert report.warning_rows == 1
    [issue] = report.issues
    assert issue.error_type == "location_mismatch"


def test_valid_row_produces_no_issue(fake_bw2):
    from mapper.core.bom_validator import BOMValidationRow, validate_bom

    rows = [
        BOMValidationRow(
            archetype="A", stage="Manufacturing", row_idx=2,
            name="aluminium sheet", database="ecoinvent-3.10-cutoff",
            code="a" * 32,
            ecoinvent_name="aluminium production, primary, ingot",
            ecoinvent_location="RoW",
        ),
    ]
    report = validate_bom(rows, project_name="test")
    assert report.total_rows == 1
    assert report.valid_rows == 1
    assert report.error_rows == 0
    assert report.warning_rows == 0
    assert report.issues == []


# ── Cache invariant ─────────────────────────────────────────────────────────


def test_cache_collapses_repeated_lookups(fake_bw2):
    """The same (db, code) referenced 16+ times across rows must hit bw2data
    exactly once. This is the headline performance invariant — without it a
    BOM that uses the same upstream activity in many archetypes pays an
    avoidable bw2 query per reference.
    """
    from mapper.core.bom_validator import BOMValidationRow, validate_bom

    rows = [
        BOMValidationRow(
            archetype="A", stage="Manufacturing", row_idx=i,
            name=f"row-{i}", database="ecoinvent-3.10-cutoff",
            code="a" * 32,
            ecoinvent_name="aluminium production, primary, ingot",
            ecoinvent_location="RoW",
        )
        for i in range(20)
    ]
    report = validate_bom(rows, project_name="test")
    assert report.valid_rows == 20
    # Single bw2data.get_activity call regardless of reference count.
    assert fake_bw2.lookup_calls == [("ecoinvent-3.10-cutoff", "a" * 32)]
    # Cache hits = remaining 19 rows + every reuse of the db existence check.
    # The exact split depends on insertion order; what matters is the lookup
    # count above.
    assert report.cache_hits >= 19


# ── Grouping ────────────────────────────────────────────────────────────────


def test_grouping_collapses_repeated_bad_codes(fake_bw2):
    """Six unique truncated codes spread over many rows produce six groups,
    not one group per row. This is what the frontend renders as "6 unique
    truncated codes affecting N rows"."""
    from mapper.core.bom_validator import BOMValidationRow, validate_bom

    bad_codes = [f"trunc{i:02d}" for i in range(6)]  # 7 chars each
    rows: list[BOMValidationRow] = []
    # 41 rows, each picking one of the 6 bad codes round-robin.
    for i in range(41):
        rows.append(BOMValidationRow(
            archetype="A", stage="Manufacturing", row_idx=i + 2,
            name=f"row-{i}", database="ecoinvent-3.10-cutoff",
            code=bad_codes[i % len(bad_codes)],
        ))
    report = validate_bom(rows, project_name="test")
    assert report.error_rows == 41
    error_groups = [g for g in report.groups if g.severity == "error"]
    # All groups are code_truncated, one per unique bad_value.
    truncated_groups = [g for g in error_groups if g.error_type == "code_truncated"]
    assert len(truncated_groups) == 6
    assert sum(g.count for g in truncated_groups) == 41
    # Larger groups sort first.
    counts = [g.count for g in truncated_groups]
    assert counts == sorted(counts, reverse=True)


# ── Issue index helper ──────────────────────────────────────────────────────


def test_issues_by_node_key_re_keys_for_apply_helper(fake_bw2):
    from mapper.core.bom_validator import (
        BOMValidationRow,
        issues_by_node_key,
        validate_bom,
    )

    rows = [
        BOMValidationRow(
            archetype="ICEV-Petrol", stage="Manufacturing", row_idx=2,
            name="aluminium sheet", database="ecoinvent-3.10-cutoff",
            code="bad",  # truncated
        ),
        BOMValidationRow(
            archetype="ICEV-Petrol", stage="Manufacturing", row_idx=3,
            name="steel sheet", database="ecoinvent-3.10-cutoff",
            code="b" * 32,
            ecoinvent_name="steel ingot, secondary",  # warning: stale
        ),
    ]
    report = validate_bom(rows, project_name="test")
    by_node = issues_by_node_key(report)
    assert ("ICEV-Petrol", "Manufacturing", "aluminium sheet") in by_node
    assert ("ICEV-Petrol", "Manufacturing", "steel sheet") in by_node


# ── End-to-end: 41 broken rows / 6 unique bad codes ─────────────────────────


def test_broken_v1_workbook_shape_yields_41_errors_6_groups(fake_bw2):
    """Synthesises the failure mode the WP5_archetypes_all_v1.xlsx workbook
    exhibited (the spec calls this out as the acceptance criterion): 41 rows
    using one of 6 truncated codes. Validation should still complete, all
    other rows still flagged valid, and the report grouped into 6 entries.
    """
    from mapper.core.bom_validator import BOMValidationRow, validate_bom

    bad_codes = [f"truncated_{i}" for i in range(6)]  # < 32 chars
    rows: list[BOMValidationRow] = []
    # 943 valid rows referencing the three good codes evenly.
    good_codes = ["a" * 32, "b" * 32, "c" * 32]
    for i in range(943):
        rows.append(BOMValidationRow(
            archetype=f"ARC-{i % 4}", stage="Manufacturing",
            row_idx=i + 2, name=f"good-{i}",
            database="ecoinvent-3.10-cutoff",
            code=good_codes[i % len(good_codes)],
        ))
    # 41 broken rows with one of the 6 bad codes.
    for i in range(41):
        rows.append(BOMValidationRow(
            archetype=f"ARC-{i % 4}", stage="Manufacturing",
            row_idx=2000 + i, name=f"bad-{i}",
            database="ecoinvent-3.10-cutoff",
            code=bad_codes[i % len(bad_codes)],
        ))
    report = validate_bom(rows, project_name="test")
    assert report.total_rows == 943 + 41
    assert report.error_rows == 41
    assert report.valid_rows == 943
    error_groups = [g for g in report.groups if g.severity == "error"]
    assert len(error_groups) == 6
    assert sum(g.count for g in error_groups) == 41


# ── Compute-time gate ───────────────────────────────────────────────────────


def test_standalone_lca_returns_422_when_archetype_has_validation_errors():
    """The LCA compute endpoint must NOT re-run validation. It reads the
    persisted ``validation_status`` and refuses on errors with 422 + a
    structured pointer back to the upload report. No bw2data fixture needed —
    the gate fires before any ecoinvent call."""
    import asyncio
    from fastapi import HTTPException

    from mapper.api.bom import _proj_archetypes, standalone_lca
    from mapper.models.bom_schemas import (
        Archetype,
        ArchetypeLCARequest,
        BOMNode,
        EcoinventLink,
    )

    arc = Archetype(
        id="test-arc-validation",
        name="Test Archetype",
        bom=[BOMNode(
            id="stage-1",
            name="Manufacturing",
            node_type="component",
            children=[BOMNode(
                id="mat-1",
                name="aluminium sheet",
                node_type="material",
                quantity=1.0,
                unit="kg",
                ecoinvent_activity=EcoinventLink(
                    database="ecoinvent-3.10-cutoff",
                    code="truncated",
                    name="aluminium",
                ),
                validation_status="error",
                validation_message="code 'truncated' has wrong length",
            )],
        )],
    )
    _proj_archetypes()[arc.id] = arc
    try:
        with pytest.raises(HTTPException) as exc:
            asyncio.run(standalone_lca(arc.id, ArchetypeLCARequest(method=["x"])))
        assert exc.value.status_code == 422
        detail = exc.value.detail
        assert isinstance(detail, dict)
        assert detail["error"] == "validation_failed"
        assert detail["error_rows"] == 1
        assert detail["archetype_id"] == arc.id
        assert detail["report_url"].endswith(f"/{arc.id}/validation-report")
    finally:
        _proj_archetypes().pop(arc.id, None)


# ── Persisted report endpoint ───────────────────────────────────────────────


def test_get_validation_report_endpoint_returns_persisted_report():
    """GET /bom/archetypes/{id}/validation-report returns the report stored
    on the archetype at upload time. Returns an empty (zero-row) report —
    NOT 404 — for archetypes that pre-date Patch 2."""
    import asyncio

    from mapper.api.bom import _proj_archetypes, get_archetype_validation_report
    from mapper.models.bom_schemas import (
        Archetype,
        ValidationIssue,
        ValidationReport,
    )

    arc = Archetype(
        id="test-arc-report",
        name="With Report",
        bom=[],
        validation_report=ValidationReport(
            total_rows=10, valid_rows=9, error_rows=1, warning_rows=0,
            issues=[ValidationIssue(
                severity="error", error_type="code_truncated",
                archetype="With Report", stage="Manufacturing",
                row_idx=2, name="aluminium",
                bad_value="bad", message="bad code",
            )],
        ),
    )
    _proj_archetypes()[arc.id] = arc
    try:
        report = asyncio.run(get_archetype_validation_report(arc.id))
        assert report.total_rows == 10
        assert report.error_rows == 1
        assert report.issues[0].error_type == "code_truncated"
    finally:
        _proj_archetypes().pop(arc.id, None)


def test_corrected_workbook_yields_zero_errors(fake_bw2):
    """The acceptance criterion's other side: re-uploading the v2 file with
    all codes corrected yields a clean report."""
    from mapper.core.bom_validator import BOMValidationRow, validate_bom

    good_codes = ["a" * 32, "b" * 32, "c" * 32]
    rows = [
        BOMValidationRow(
            archetype="ARC-0", stage="Manufacturing", row_idx=i + 2,
            name=f"row-{i}", database="ecoinvent-3.10-cutoff",
            code=good_codes[i % len(good_codes)],
        )
        for i in range(984)
    ]
    report = validate_bom(rows, project_name="test")
    assert report.error_rows == 0
    assert report.valid_rows == 984
    assert report.groups == []
