# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Patch 4W — methodological-integrity tests for AESA's auto-mapping
of EF v3.1 LCIA methods to Sala 2020 Planetary Boundaries.

The pre-Patch-4W auto-mapper used substring containment for token
matching, which produced two methodologically invalid outcomes:

  1. EF v3.1 climate change AGGREGATE + 3 sub-components
     (biogenic, fossil, land-use) all mapped to the same
     ``climate_change`` PB — the engine then produced FOUR
     ``SustainabilityRatioResult`` rows per (year, climate_change),
     and the frontend silently displayed whichever sub-component
     happened to be iterated last (NOT the aggregate).
  2. ``"carcinogenic" in "non-carcinogenic"`` substring match made
     the non-cancer method score against the cancer PB; the cancer
     PB (declared first in the boundary set) won the tie via
     strict-greater iteration; non-cancer PB received no method and
     surfaced as "1 method unmapped".

Patch 4W replaced substring matching with exact match against
``method[1]``. The boundary set's ``ef_indicator`` strings are
authored to match BW2's ``method[1]`` directly. This test suite
locks the contract: each EF v3.1 method either exact-matches one PB
or is silently skipped (sub-components are diagnostic decomposition,
not PB characterization sources).

Reference: Sala et al. 2020, J. Environ. Manage. 269: 110686.
"""
from __future__ import annotations

from mapper.core.aesa_engine import load_boundary_sets, suggest_method_mapping


# Realistic EF v3.1 method tuples, mirroring what bw2io.import_method
# produces after registering the EF v3.1 LCIA package.
EF_V31_METHODS: list[list[str]] = [
    # Climate change — aggregate (canonical for AESA characterization)
    ["EF v3.1", "climate change", "global warming potential (GWP100)"],
    # Climate change — sub-components (diagnostic only; must NOT auto-
    # map to the climate_change PB)
    ["EF v3.1", "climate change: biogenic", "global warming potential (GWP100)"],
    ["EF v3.1", "climate change: fossil", "global warming potential (GWP100)"],
    ["EF v3.1", "climate change: land use and land use change",
        "global warming potential (GWP100)"],
    # Acidification, ecotoxicity, water, energy, materials
    ["EF v3.1", "acidification", "accumulated exceedance (AE)"],
    ["EF v3.1", "ecotoxicity: freshwater", "comparative toxic unit for ecosystems (CTUe)"],
    ["EF v3.1", "energy resources: non-renewable", "abiotic depletion potential (ADP)"],
    ["EF v3.1", "material resources: metals/minerals", "abiotic depletion potential (ADP)"],
    ["EF v3.1", "water use", "user deprivation potential (deprivation-weighted water consumption)"],
    # Eutrophication — three sibling PBs in Sala 2020
    ["EF v3.1", "eutrophication: freshwater", "fraction of nutrients reaching freshwater end compartment (P)"],
    ["EF v3.1", "eutrophication: marine", "fraction of nutrients reaching marine end compartment (N)"],
    ["EF v3.1", "eutrophication: terrestrial", "accumulated exceedance (AE)"],
    # Human toxicity — cancer / non-cancer; pre-Patch-4W bug had these
    # cross-mapped due to substring containment
    ["EF v3.1", "human toxicity: carcinogenic", "comparative toxic unit for human (CTUh)"],
    ["EF v3.1", "human toxicity: non-carcinogenic", "comparative toxic unit for human (CTUh)"],
    # Remaining single-PB methods
    ["EF v3.1", "ionising radiation: human health", "human exposure efficiency relative to u235"],
    ["EF v3.1", "land use", "soil quality index"],
    ["EF v3.1", "ozone depletion", "ozone depletion potential (ODP)"],
    ["EF v3.1", "particulate matter formation", "impact on human health"],
    ["EF v3.1", "photochemical oxidant formation", "tropospheric ozone concentration increase"],
]


def test_climate_change_aggregate_only_maps_to_pb() -> None:
    """The AESA climate_change PB must receive ONLY the aggregate
    EF v3.1 climate change method — never the biogenic / fossil /
    LULUC sub-components. Sub-components are diagnostic
    decomposition; characterizing the PB against them produces
    methodologically invalid AESA values."""
    bsets = load_boundary_sets()
    bset = bsets["Sala2020_EF"]
    mapping = suggest_method_mapping(EF_V31_METHODS, bset)

    climate_mappings = [m for m in mapping if m.pb_id == "climate_change"]
    assert len(climate_mappings) == 1, (
        f"climate_change PB must receive exactly ONE method (the aggregate), "
        f"not {len(climate_mappings)}. The pre-Patch-4W bug mapped 4 methods "
        f"(aggregate + 3 sub-components) to the same PB, causing the AESA "
        f"engine to emit 4 SR rows per year and the frontend to render "
        f"whichever sub-component happened to be iterated last."
    )
    assert climate_mappings[0].method_tuple == [
        "EF v3.1", "climate change", "global warming potential (GWP100)"
    ], (
        f"climate_change PB must map to the AGGREGATE method, not a "
        f"sub-component. Got {climate_mappings[0].method_tuple}."
    )


def test_climate_change_subcomponents_are_unmapped() -> None:
    """The sub-component methods must NOT auto-map to any PB.
    They have no exact-match ef_indicator in the Sala 2020 set
    (only the aggregate does). The engine's `missing_categories`
    output reports PBs without methods; the inverse — methods
    without PBs — is the SAFE state for sub-components."""
    bsets = load_boundary_sets()
    bset = bsets["Sala2020_EF"]
    mapping = suggest_method_mapping(EF_V31_METHODS, bset)
    mapped_method_strs = {"|".join(m.method_tuple) for m in mapping}

    for sub in [
        "climate change: biogenic",
        "climate change: fossil",
        "climate change: land use and land use change",
    ]:
        sub_str = f"EF v3.1|{sub}|global warming potential (GWP100)"
        assert sub_str not in mapped_method_strs, (
            f"Sub-component '{sub}' must NOT be auto-mapped to any PB. "
            f"Sub-components are diagnostic decomposition; PB "
            f"characterization must use the aggregate. Pre-Patch-4W bug: "
            f"all four climate methods were mapped to climate_change PB "
            f"due to substring token matching."
        )


def test_human_toxicity_no_cancer_noncancer_cross_match() -> None:
    """Pre-Patch-4W bug: ``"carcinogenic" in "non-carcinogenic"`` is
    Python substring containment True. Non-cancer method
    substring-contained all three cancer-PB tokens → tied scoring;
    strict-greater iteration ordering let cancer PB win → non-cancer
    PB had NO method. Patch 4W exact-match resolves both correctly."""
    bsets = load_boundary_sets()
    bset = bsets["Sala2020_EF"]
    mapping = suggest_method_mapping(EF_V31_METHODS, bset)

    by_pb = {m.pb_id: m.method_tuple for m in mapping}

    # Cancer PB receives ONLY the cancer method.
    assert "human_toxicity_cancer" in by_pb
    assert by_pb["human_toxicity_cancer"][1] == "human toxicity: carcinogenic"

    # Non-cancer PB receives ONLY the non-cancer method.
    assert "human_toxicity_non_cancer" in by_pb, (
        "Pre-Patch-4W: non-cancer PB had no method due to substring "
        "tie-break giving cancer PB the win. Patch 4W exact-match "
        "must produce the correct mapping."
    )
    assert by_pb["human_toxicity_non_cancer"][1] == "human toxicity: non-carcinogenic"


def test_every_pb_in_set_receives_a_method() -> None:
    """With Patch 4W exact-match and a complete EF v3.1 method list,
    every PB in Sala 2020 should receive exactly one method.
    Regression test — the pre-fix mapper produced
    ``missing_categories=["human_toxicity_non_cancer"]`` for any
    project with the standard EF v3.1 method set."""
    bsets = load_boundary_sets()
    bset = bsets["Sala2020_EF"]
    mapping = suggest_method_mapping(EF_V31_METHODS, bset)
    matched_pbs = {m.pb_id for m in mapping}

    for pb in bset.boundaries.values():
        assert pb.id in matched_pbs, (
            f"PB '{pb.id}' (ef_indicator='{pb.ef_indicator}') has no "
            f"matching method in the standard EF v3.1 set. Either the "
            f"boundary set's ef_indicator string differs from BW2's "
            f"method[1], or this PB is genuinely uncovered by EF v3.1."
        )


def test_each_pb_receives_at_most_one_method() -> None:
    """No PB should receive multiple mappings — multi-method-to-
    single-PB collisions cause the engine to emit duplicate SR rows
    per (year, pb_id) and inflate the frontend's zone summary
    tallies. Patch 4W's exact-match ensures one method ↔ one PB."""
    bsets = load_boundary_sets()
    bset = bsets["Sala2020_EF"]
    mapping = suggest_method_mapping(EF_V31_METHODS, bset)

    counts: dict[str, int] = {}
    for m in mapping:
        counts[m.pb_id] = counts.get(m.pb_id, 0) + 1
    duplicates = {k: v for k, v in counts.items() if v > 1}
    assert not duplicates, (
        f"Multiple methods mapped to the same PB: {duplicates}. The "
        f"AESA engine appends one SR row per mapping; multiple methods "
        f"per PB produce duplicate rows that the frontend silently "
        f"overwrites (Map.set keyed by year+pb_id) and inflate zone "
        f"summary tallies."
    )


def test_case_insensitive_match() -> None:
    """Exact match is case-insensitive — accommodates BW2 method
    registries that may differ in capitalization across upstream
    sources. ``"Climate Change"`` (titlecase) should still match
    ``"climate change"`` ef_indicator."""
    bsets = load_boundary_sets()
    bset = bsets["Sala2020_EF"]
    methods = [
        ["EF v3.1", "Climate Change", "GWP100"],
        ["EF v3.1", "ACIDIFICATION", "AE"],
    ]
    mapping = suggest_method_mapping(methods, bset)
    pb_ids = {m.pb_id for m in mapping}
    assert pb_ids == {"climate_change", "acidification"}


def test_climate_aggregate_value_used_in_compute_not_subcomponent() -> None:
    """End-to-end arithmetic verification: feed AESAEngine.compute() a
    DSMLCAResult set containing the climate change AGGREGATE plus
    all three sub-components, with deliberately-different impact
    values. Assert the resulting SR for ``climate_change`` PB is
    derived from the AGGREGATE's impact value, NOT from any
    sub-component.

    Before Patch 4W this test would FAIL in two ways:
    (1) The auto-mapper would emit 4 mappings for climate_change,
        producing 4 SR rows for the same (year, climate_change).
    (2) Whichever sub-component was iterated last would set the
        last row — frontend Map.set retains it; users see a
        sub-component value where they should see the aggregate.

    After Patch 4W: only the aggregate maps; exactly one SR row;
    its impact = aggregate's total_impact.
    """
    from mapper.core.aesa_engine import AESAEngine
    from mapper.models.aesa_schemas import (
        AESAConfiguration, DownscalingChain, DownscalingLayer, SharingPreset,
    )
    from mapper.models.bom_schemas import DSMLCAResult, DSMLCASummary, DSMLCAYearResult

    # Distinct impact values per source method — the aggregate is
    # the SUM of the sub-components by EF v3.1's construction, but
    # in this fixture we deliberately don't enforce that so the
    # test can detect WHICH source the engine pulled from.
    AGGREGATE_IMPACT = 1.0e10        # the value AESA SHOULD use
    BIOGENIC_IMPACT = 2.0e9
    FOSSIL_IMPACT = 7.5e9
    LULUC_IMPACT = 5.0e8

    def _make_method(label: str, impact: float) -> DSMLCAResult:
        return DSMLCAResult(
            mfa_system_id="test",
            method=["EF v3.1", label, "global warming potential (GWP100)"],
            method_label=f"EF v3.1 › {label} › GWP100",
            scope="stock",
            unit="kg CO2 eq",
            years=[DSMLCAYearResult(
                year=2025, total_impact=impact, unit="kg CO2 eq",
                impact_by_cohort={}, impact_by_material={}, count_by_cohort={},
            )],
            summary=DSMLCASummary(total_impact=impact, peak_year=2025, peak_impact=impact),
        )

    impact_results = [
        _make_method("climate change", AGGREGATE_IMPACT),
        _make_method("climate change: biogenic", BIOGENIC_IMPACT),
        _make_method("climate change: fossil", FOSSIL_IMPACT),
        _make_method("climate change: land use and land use change", LULUC_IMPACT),
    ]
    methods = [list(r.method) for r in impact_results]

    bsets = load_boundary_sets()
    bset = bsets["Sala2020_EF"]
    mapping = suggest_method_mapping(methods, bset)

    # Trivial 1-layer chain so allocated_sos = pb_value × 1.0 — keeps
    # the arithmetic check unambiguous.
    layer = DownscalingLayer(
        layer_number=1, name="L1", principle_mode="fixed", fixed_principle="EpC",
        data={"EpC": {2025: (1.0, 1.0)}},
    )
    sharing = SharingPreset(
        id="test", name="Test", description="",
        principles=[],
        category_assignments=[],
        chain=DownscalingChain(layers=[layer]),
    )
    config = AESAConfiguration(
        id="test-config", name="test", mfa_system_id="test",
        impact_mode="static", boundary_set_id="Sala2020_EF",
        sharing=sharing, sharing_preset_id=None,
        carbon_budget=None,  # forces fallback path: allocated = pb_value × factor
        method_mapping=mapping,
        created_at="2026-05-09T00:00:00Z",
    )

    out = AESAEngine.compute(impact_results, config, bset)
    climate_rows = [r for r in out.results if r.pb_id == "climate_change"]

    # Patch 4W contract: exactly ONE SR row per (year, climate_change).
    assert len(climate_rows) == 1, (
        f"Expected exactly one SR row for climate_change with the aggregate "
        f"as the source; got {len(climate_rows)}. Pre-Patch-4W bug: 4 rows "
        f"(one per source method)."
    )
    row = climate_rows[0]

    # Arithmetic verification — the impact SR is derived from MUST be
    # the aggregate, not any sub-component.
    assert row.impact == AGGREGATE_IMPACT, (
        f"climate_change SR row impact={row.impact}, expected "
        f"AGGREGATE_IMPACT={AGGREGATE_IMPACT}. If this is BIOGENIC_IMPACT "
        f"({BIOGENIC_IMPACT}), FOSSIL_IMPACT ({FOSSIL_IMPACT}), or "
        f"LULUC_IMPACT ({LULUC_IMPACT}), the engine is silently pulling "
        f"from a sub-component — the methodological bug Patch 4W fixes."
    )

    # And SR = impact / allocated; allocated = pb_value × layer factor (1.0).
    pb = bset.boundaries["climate_change"]
    expected_sr = AGGREGATE_IMPACT / pb.pb_value
    assert row.sr is not None and abs(row.sr - expected_sr) < 1e-9, (
        f"SR={row.sr}, expected {expected_sr} = "
        f"AGGREGATE_IMPACT / pb_value = {AGGREGATE_IMPACT} / {pb.pb_value}."
    )


def test_zone_summary_not_inflated_by_duplicate_climate_rows() -> None:
    """Pre-Patch-4W bug: 4 SR rows per (year, climate_change) caused
    AESAYearSummary's per-zone counts to over-count by 3 per year.
    Patch 4W's exact-match auto-mapper produces one row → counts are
    correct."""
    from mapper.core.aesa_engine import AESAEngine
    from mapper.models.aesa_schemas import (
        AESAConfiguration, DownscalingChain, DownscalingLayer, SharingPreset,
    )
    from mapper.models.bom_schemas import DSMLCAResult, DSMLCASummary, DSMLCAYearResult

    def _make_method(label: str, impact: float) -> DSMLCAResult:
        return DSMLCAResult(
            mfa_system_id="test",
            method=["EF v3.1", label, "GWP100"],
            method_label=f"EF v3.1 › {label}",
            scope="stock", unit="kg CO2 eq",
            years=[DSMLCAYearResult(
                year=2025, total_impact=impact, unit="kg CO2 eq",
                impact_by_cohort={}, impact_by_material={}, count_by_cohort={},
            )],
            summary=DSMLCASummary(total_impact=impact, peak_year=2025, peak_impact=impact),
        )

    impact_results = [
        _make_method("climate change", 1.0e9),
        _make_method("climate change: biogenic", 2.0e8),
        _make_method("climate change: fossil", 7.0e8),
        _make_method("climate change: land use and land use change", 1.0e8),
        _make_method("acidification", 1.0e8),  # different PB, single row
    ]

    bsets = load_boundary_sets()
    bset = bsets["Sala2020_EF"]
    mapping = suggest_method_mapping(
        [list(r.method) for r in impact_results], bset,
    )
    layer = DownscalingLayer(
        layer_number=1, name="L1", principle_mode="fixed", fixed_principle="EpC",
        data={"EpC": {2025: (1.0, 1.0)}},
    )
    sharing = SharingPreset(
        id="test", name="Test", description="",
        principles=[], category_assignments=[],
        chain=DownscalingChain(layers=[layer]),
    )
    config = AESAConfiguration(
        id="x", name="x", mfa_system_id="test",
        impact_mode="static", boundary_set_id="Sala2020_EF",
        sharing=sharing, sharing_preset_id=None,
        carbon_budget=None, method_mapping=mapping,
        created_at="2026-05-09T00:00:00Z",
    )

    out = AESAEngine.compute(impact_results, config, bset)

    # Two PBs covered (climate + acidification), one SR row each.
    assert len(out.results) == 2

    summary_2025 = next(s for s in out.summary_by_year if s.year == 2025)
    # Sum of the per-zone counts = total_assessed; must equal the
    # number of UNIQUE PBs that received an SR row (2), not 5
    # (number of source methods). Pre-Patch-4W bug: 5.
    assert summary_2025.total_assessed == 2, (
        f"total_assessed={summary_2025.total_assessed}, expected 2 "
        f"(one per unique PB receiving an SR row). The pre-Patch-4W "
        f"bug counted each duplicate climate_change row toward the "
        f"zone tallies, inflating the count by ~3 per year."
    )


def test_unrelated_method_stays_unmapped() -> None:
    """A method that doesn't exact-match any PB ef_indicator stays
    unmapped — no token-substring fallback. This is the
    methodologically conservative behaviour: better to have a PB
    surface as 'missing' (user investigates and either provides a
    manual mapping or confirms the PB is uncovered) than silently
    characterize a PB against a wrong method."""
    bsets = load_boundary_sets()
    bset = bsets["Sala2020_EF"]
    methods = [
        ["EF v3.1", "some weird method that does not match anything", "x"],
    ]
    mapping = suggest_method_mapping(methods, bset)
    assert mapping == []
