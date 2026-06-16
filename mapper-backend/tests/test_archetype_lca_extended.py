"""Tests for the extended /lca/calculate-archetype endpoint (Patch 3.1).

Covers schema-level acceptance of the new optional fields
(`compute_database`, `parameter_scenario`) and the response-side echo + warning
list. The full end-to-end run requires a brightway2 project with linked
materials and is exercised by hand against the dev backend.

The schema-only style mirrors test_contribution_prospective.py.
"""
from __future__ import annotations


# ── Request schema ─────────────────────────────────────────────────────────


def test_request_accepts_compute_database():
    from mapper.models.schemas import ArchetypeLCACalculateRequest

    req = ArchetypeLCACalculateRequest(
        archetype_id="arc-1",
        scope="all",
        methods=[["IPCC", "GWP100a"]],
        compute_database="ecoinvent-3.10-cutoff_premise_remind_ssp2-pkbudg1150_2030",
    )
    assert req.compute_database == (
        "ecoinvent-3.10-cutoff_premise_remind_ssp2-pkbudg1150_2030"
    )
    assert req.parameter_scenario is None


def test_request_accepts_parameter_scenario():
    from mapper.models.schemas import ArchetypeLCACalculateRequest

    req = ArchetypeLCACalculateRequest(
        archetype_id="arc-1",
        scope="all",
        methods=[["IPCC", "GWP100a"]],
        parameter_scenario="HighElec",
    )
    assert req.parameter_scenario == "HighElec"
    assert req.compute_database is None


def test_request_both_fields_set():
    """Multi-axis: single-product mode runs against a prospective DB AND a
    named parameter scenario in the same call. Patch 2A's axisConflict rule
    only blocks N>1 on multiple axes; N=1 on multiple axes is allowed and
    routinely happens in single-product Projected mode with a non-Base
    parameter set."""
    from mapper.models.schemas import ArchetypeLCACalculateRequest

    req = ArchetypeLCACalculateRequest(
        archetype_id="arc-1",
        scope="inflows",
        methods=[["IPCC", "GWP100a"]],
        compute_database="ecoinvent-3.10-cutoff_premise_remind_ssp1-pkbudg1150_2050",
        parameter_scenario="LowDemand",
    )
    assert req.compute_database is not None
    assert req.parameter_scenario == "LowDemand"


def test_request_backward_compat_no_new_fields():
    """Pre-Patch callers omit both new fields and continue to work."""
    from mapper.models.schemas import ArchetypeLCACalculateRequest

    req = ArchetypeLCACalculateRequest(
        archetype_id="arc-1",
        scope="all",
        methods=[["IPCC", "GWP100a"]],
    )
    assert req.compute_database is None
    assert req.parameter_scenario is None


# ── Response schema ────────────────────────────────────────────────────────


def test_result_echoes_compute_database_and_parameter_scenario():
    from mapper.models.schemas import ArchetypeLCACalculateResult

    r = ArchetypeLCACalculateResult(
        archetype_id="arc-1",
        archetype_name="Test product",
        scope="all",
        amount=1.0,
        stages_included=["Manufacturing"],
        results=[],
        compute_database="ecoinvent-3.10-cutoff_premise_remind_ssp2-pkbudg1150_2030",
        parameter_scenario="HighElec",
    )
    assert r.compute_database == (
        "ecoinvent-3.10-cutoff_premise_remind_ssp2-pkbudg1150_2030"
    )
    assert r.parameter_scenario == "HighElec"
    assert r.warnings == []


def test_result_warnings_default_empty():
    """Warnings default to an empty list when no compute_database is set or
    every key resolves cleanly."""
    from mapper.models.schemas import ArchetypeLCACalculateResult

    r = ArchetypeLCACalculateResult(
        archetype_id="arc-1",
        archetype_name="Test",
        scope="all",
        amount=1.0,
        stages_included=[],
        results=[],
    )
    assert r.warnings == []
    assert r.compute_database is None
    assert r.parameter_scenario is None


def test_result_warnings_carry_translation_messages():
    from mapper.models.schemas import ArchetypeLCACalculateResult

    r = ArchetypeLCACalculateResult(
        archetype_id="arc-1",
        archetype_name="Test",
        scope="all",
        amount=1.0,
        stages_included=[],
        results=[],
        compute_database="x_premise_y_z_2050",
        warnings=[
            "Activity ecoinvent-3.10-cutoff/abc not found in x_premise_y_z_2050; "
            "fell back to source database for this key.",
        ],
    )
    assert len(r.warnings) == 1
    assert "fell back to source database" in r.warnings[0]
