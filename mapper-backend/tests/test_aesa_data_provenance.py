"""Patch X1 — AESA bundled data provenance guard.

The Carbon Budget Depletion chart consumes two bundled JSON data
files (``ssp_trajectories.json``, ``carbon_budgets.json``). Both
carry structured citation metadata so JOSS / paper / IDA-deck
readers can trace every displayed value to an IPCC / IIASA / GCB
source.

This test guards against future entries shipping without
citations — adding a new SSP scenario or budget option must
populate the same provenance fields, or this test fails.

Audit findings from the 2026-05-12 methodology audit:
  A1 — IIASA SSP database version snapshot
  A2 — IAM model attribution per scenario (AR6 WG1 marker)
  A3 — Global Carbon Budget 2024 citation for the 200 Gt deduction
"""
from __future__ import annotations

import json
from pathlib import Path

DATA_DIR = (
    Path(__file__).resolve().parents[1]
    / "mapper" / "data" / "aesa"
)


def _read(name: str) -> dict:
    return json.loads((DATA_DIR / name).read_text(encoding="utf-8"))


# ── ssp_trajectories.json ────────────────────────────────────────────────────


def test_ssp_trajectories_has_iiasa_version_block():
    """A1 — IIASA SSP database version snapshot must be present.

    Best-estimate attribution to IIASA SSP Database v2.0 (2018,
    AR6 marker convention). Remove the `best_estimate` flag only
    once anchors are verified against a specific dense IIASA
    extract.
    """
    raw = _read("ssp_trajectories.json")
    assert "iiasa_database" in raw, "iiasa_database block missing"
    block = raw["iiasa_database"]
    assert block.get("name") == "IIASA SSP Database"
    assert block.get("version"), "IIASA SSP DB version must be specified"
    assert block.get("release_year"), "IIASA SSP DB release year must be specified"
    assert block.get("url"), "IIASA SSP DB URL must be specified"


def test_every_ssp_scenario_has_iam_model_attribution():
    """A2 — Each scenario must name the IAM that produced the trajectory.

    AR6 WG1 marker convention:
      SSP1-2.6 → IMAGE 3.0.1
      SSP2-4.5 → MESSAGE-GLOBIOM 1.0
      SSP3-7.0 → AIM/CGE 2.0
      SSP5-8.5 → REMIND-MAgPIE 1.5
      SSP1-1.9 → IMAGE 3.0.1 (when added)
    """
    raw = _read("ssp_trajectories.json")
    scenarios = raw.get("scenarios", [])
    # Patch X2 closed audit finding A4 — the canonical AR6 marker
    # quintet must now all be present.
    assert len(scenarios) >= 5, "expected all 5 AR6 marker scenarios (Patch X2 closed A4)"
    for s in scenarios:
        assert s.get("model"), f"scenario {s.get('id')} missing IAM model attribution"
        assert s.get("source"), f"scenario {s.get('id')} missing source"
        # All entries are provisional until verified against dense IIASA extracts.
        assert s.get("provisional") is True, (
            f"scenario {s.get('id')} must keep provisional=true until verified"
        )


# ── carbon_budgets.json ──────────────────────────────────────────────────────


def test_carbon_budgets_has_structured_sources_array():
    """A3 — Top-level sources array carries citation metadata.

    Must include IPCC AR6 WG1 (the budgets themselves) and GCB
    (the 2020-2024 deduction).
    """
    raw = _read("carbon_budgets.json")
    sources = raw.get("sources", [])
    assert len(sources) >= 2, "expected IPCC + GCB citations"
    ids = {s.get("id") for s in sources}
    assert "IPCC_AR6_WG1_SPM" in ids, "IPCC AR6 WG1 citation missing"
    assert "GCB_2024" in ids, "Global Carbon Budget 2024 citation missing"
    for s in sources:
        assert s.get("citation"), f"source {s.get('id')} missing citation string"
        # Every source needs a stable reference handle — DOI for
        # academic citations, URL for blog / web cross-checks. The
        # primary citations (IPCC, GCB, AR6CarbonBudgetCalc) MUST
        # carry DOIs; cross-check / commentary sources (Hausfather
        # Climate Brink) get a URL.
        assert s.get("doi") or s.get("url"), (
            f"source {s.get('id')} needs at least one of: doi, url"
        )


def test_every_budget_option_references_structured_sources():
    """Each option points at the source registry by ID; no orphan citations."""
    raw = _read("carbon_budgets.json")
    source_ids = {s["id"] for s in raw.get("sources", [])}
    for opt in raw.get("options", []):
        assert opt.get("source_budget") in source_ids, (
            f"option {opt.get('id')} source_budget must reference sources[]"
        )
        assert opt.get("source_deduction") in source_ids, (
            f"option {opt.get('id')} source_deduction must reference sources[]"
        )
        # Round-trip derivation must be machine-traceable.
        assert opt.get("original_gt_from_2020") is not None, (
            f"option {opt.get('id')} missing original_gt_from_2020"
        )
        assert opt.get("remaining_gt_from_2025") is not None
        assert opt.get("provisional") is True, (
            f"option {opt.get('id')} must keep provisional=true until verified"
        )


def test_budget_deduction_is_documented():
    """The 200 Gt 2020-2024 deduction figure must be present at top level
    for citation traceability. AR6 50 Gt rounding convention.
    """
    raw = _read("carbon_budgets.json")
    assert raw.get("consumed_2020_2024_gt") == 200, "GCB 2024 deduction Gt"


# Patch X1++ — canonical AR6 SPM Table SPM.2 published values
# ("from January 2020"). Locked here as the authoritative ground truth
# so a future transcription error (mistakenly using Forster 2023's
# from-Jan-2023 values, mistakenly using Indicators-of-Global-Climate-
# Change updates, hand-typed wrong digits) cannot ship without failing
# this test.
#
# Reference: IPCC AR6 WG1 SPM Table SPM.2, "Estimates of remaining
# carbon budgets from the beginning of 2020" (Climate Change 2021,
# IPCC, p. 29).
# Cross-checked: Hausfather 2023 Climate Brink article, Carbon Brief,
# Climate Analytics, AR6CarbonBudgetCalc reference implementation.
AR6_SPM_2_VALUES_FROM_2020: dict[str, int] = {
    "IPCC_AR6_1p5C_50": 500,
    "IPCC_AR6_1p5C_67": 400,
    "IPCC_AR6_2C_50":   1350,
    "IPCC_AR6_2C_67":   1150,
}


def test_budget_originals_match_ar6_spm_table_2():
    """Patch X1++ — every option's ``original_gt_from_2020`` must match
    AR6 WG1 SPM Table SPM.2's published from-Jan-2020 value.

    Patch X1+'s audit found two options carrying values from a DIFFERENT
    reference date (Forster 2023 from-Jan-2023 = 1150 used where AR6
    from-Jan-2020 = 1350 was claimed) or with no traceable source at all
    (the 800 Gt value for 2°C / 67% had no git history beyond a single
    bulk commit). X1++ corrected both. This invariant locks the
    published-source contract permanently — a future patch swapping in
    Forster 2023, IGCC, or any other reference must update this dict
    AND change the file's _notice citation accordingly, not silently.
    """
    raw = _read("carbon_budgets.json")
    seen_ids: set[str] = set()
    for opt in raw.get("options", []):
        opt_id = opt.get("id")
        if opt_id not in AR6_SPM_2_VALUES_FROM_2020:
            continue
        seen_ids.add(opt_id)
        expected = AR6_SPM_2_VALUES_FROM_2020[opt_id]
        actual = opt.get("original_gt_from_2020")
        assert actual == expected, (
            f"option {opt_id}: original_gt_from_2020 = {actual}, but "
            f"AR6 SPM Table SPM.2 publishes {expected} Gt from 2020. "
            f"If this is intentional (e.g. migrating to Forster 2023), "
            f"update AR6_SPM_2_VALUES_FROM_2020 AND the file's _notice."
        )
    # All four canonical options must be present in the bundled file.
    assert seen_ids == set(AR6_SPM_2_VALUES_FROM_2020.keys()), (
        f"missing options: {set(AR6_SPM_2_VALUES_FROM_2020.keys()) - seen_ids}"
    )


def test_budget_arithmetic_is_internally_consistent():
    """Patch X1+ — every option must satisfy
    ``original_gt_from_2020 - consumed_2020_2024_gt == remaining_gt_from_2025``.

    Patch X1's audit surfaced 3 of 4 options off by 50 Gt in the
    same direction (transcription error). The X1+ correction
    re-derived all four. This invariant test locks the contract
    permanently — future data-entry bugs cannot ship without
    failing this test.

    The 200 Gt deduction is itself at AR6's 50 Gt rounding
    granularity, so the equality must hold exactly (no extra
    rounding step). If a future patch wants to use a finer
    deduction (e.g. 225 Gt from GCB 2024 exact), the same
    arithmetic must still hold against the new deduction value.
    """
    raw = _read("carbon_budgets.json")
    deduction = raw.get("consumed_2020_2024_gt")
    assert deduction is not None, "consumed_2020_2024_gt required"
    for opt in raw.get("options", []):
        original = opt.get("original_gt_from_2020")
        remaining = opt.get("remaining_gt_from_2025")
        assert original is not None, f"{opt.get('id')} missing original_gt_from_2020"
        assert remaining is not None, f"{opt.get('id')} missing remaining_gt_from_2025"
        assert original - deduction == remaining, (
            f"option {opt.get('id')}: arithmetic gap — "
            f"{original} - {deduction} = {original - deduction}, "
            f"but remaining_gt_from_2025 = {remaining}"
        )


# ── Engine loaders still work after metadata expansion ───────────────────────


def test_load_ssp_trajectories_parses_with_new_metadata():
    """Loader is metadata-tolerant: extra keys don't break parsing."""
    from mapper.core.aesa_engine import load_ssp_trajectories
    ss = load_ssp_trajectories()
    assert len(ss) >= 4
    # Existing contract: each scenario has projected_emissions expanded
    # from anchors_gt_co2 (the interpolated dict).
    for s in ss:
        assert "projected_emissions" in s
        assert isinstance(s["projected_emissions"], dict)
        assert 2025 in s["projected_emissions"]
        assert 2100 in s["projected_emissions"]


def test_load_carbon_budget_options_parses_with_new_metadata():
    """Loader is metadata-tolerant: extra keys don't break parsing."""
    from mapper.core.aesa_engine import load_carbon_budget_options
    opts = load_carbon_budget_options()
    assert len(opts) >= 4
    for opt in opts:
        assert opt.get("remaining_gt_from_2025") is not None
        assert opt.get("source")


def test_build_carbon_budget_smoke():
    """End-to-end smoke: building a CarbonBudgetConfig still works.

    Patch X1+ — corrected value: 1.5°C / 50th = 300 Gt (was 250 Gt
    pre-X1+, off by 50 from the stated derivation 500 - 200).
    """
    from mapper.core.aesa_engine import build_carbon_budget
    cfg = build_carbon_budget(
        budget_option_id="IPCC_AR6_1p5C_50",
        ssp_id="SSP2-4.5",
    )
    assert cfg.initial_budget_gt == 300.0
    assert cfg.ssp_scenario == "SSP2-4.5"
    assert cfg.provisional is True
    # The depletion arithmetic is unchanged.
    assert cfg.remaining_budget(2025) == 300.0
    assert cfg.remaining_budget(2100) < cfg.initial_budget_gt
    # SSP2-4.5 cumulative emissions cross 300 Gt around 2032; pre-X1+
    # they crossed 250 Gt around 2031.
    assert cfg.remaining_budget(2031) > 0
    assert cfg.remaining_budget(2033) == 0


def test_fresh_config_carbon_budget_defaults():
    """Patch 5AO/5AR — a fresh AESA config defaults to IPCC AR6 2.0°C / 50th pct
    (1150 Gt from 2025) × SSP2-4.5, allocated over the full century (end_year
    2100). ``build_carbon_budget()`` (no args) is exactly what
    ``GET /aesa/defaults`` serves as ``default_carbon_budget``, so this locks
    the fresh-start defaults.

    Patch 5AR — end_year is the BUDGET ALLOCATION horizon (remaining /
    (end_year - t)), NOT the study/SR-timeline window (that's DSM-driven). It
    must stay 2100; 5AO's 2050 compressed the budget and collapsed the
    climate-change SR."""
    from mapper.core.aesa_engine import build_carbon_budget

    cfg = build_carbon_budget()
    assert cfg.initial_budget_gt == 1150.0
    assert cfg.ssp_scenario == "SSP2-4.5"
    assert cfg.start_year == 2025
    assert cfg.end_year == 2100
    assert "AR6" in cfg.budget_source


def test_get_defaults_surfaces_fresh_carbon_budget():
    """The /aesa/defaults bundle's default_carbon_budget reflects the 5AO
    fresh-config defaults (the only no-arg build_carbon_budget caller)."""
    import asyncio
    from mapper.api.aesa import get_defaults

    bundle = asyncio.run(get_defaults())
    cb = bundle["default_carbon_budget"]
    assert cb["initial_budget_gt"] == 1150.0
    assert cb["ssp_scenario"] == "SSP2-4.5"
    assert cb["start_year"] == 2025
    assert cb["end_year"] == 2100
