"""AESA engine smoke test + hand-calculated SR verification.

Builds a synthetic Impact Assessment result with two methods (climate change
and acidification) and one year, runs AESAEngine.compute(), and asserts the
SR matches a hand-calculated value.
"""
from __future__ import annotations

from mapper.core.aesa_engine import (
    AESAEngine,
    MULTI_D_DEFAULTS,
    build_carbon_budget,
    build_default_multi_d_config,
    load_boundary_sets,
    suggest_method_mapping,
)
from mapper.models.aesa_schemas import (
    AESAConfiguration,
    MethodPBMapping,
)
from mapper.models.bom_schemas import DSMLCAResult, DSMLCASummary, DSMLCAYearResult


def _fixture_impact_results() -> list[DSMLCAResult]:
    """Two methods × one year. Impact values are chosen to make the expected
    SRs easy to verify."""
    climate = DSMLCAResult(
        mfa_system_id="test-system",
        method=["EF v3.1", "climate change", "global warming potential (GWP100)"],
        method_label="EF v3.1 › climate change › GWP100",
        scope="stock",
        unit="kg CO2 eq",
        years=[DSMLCAYearResult(
            year=2025, total_impact=1.0e10, unit="kg CO2 eq",
            impact_by_cohort={"BEV-LFP": 6.0e9, "ICEV": 4.0e9},
            impact_by_material={"steel": 5.0e9},
            count_by_cohort={"BEV-LFP": 1e5, "ICEV": 2e5},
        )],
        summary=DSMLCASummary(total_impact=1.0e10, peak_year=2025, peak_impact=1.0e10),
    )
    acid = DSMLCAResult(
        mfa_system_id="test-system",
        method=["EF v3.1", "acidification", "accumulated exceedance (AE)"],
        method_label="EF v3.1 › acidification › AE",
        scope="stock",
        unit="mol H+ eq",
        years=[DSMLCAYearResult(
            year=2025, total_impact=1.0e8, unit="mol H+ eq",
            impact_by_cohort={"BEV-LFP": 4.0e7, "ICEV": 6.0e7},
            impact_by_material={},
            count_by_cohort={},
        )],
        summary=DSMLCASummary(total_impact=1.0e8, peak_year=2025, peak_impact=1.0e8),
    )
    return [climate, acid]


def _make_config(methods: list[list[str]], *, with_carbon: bool) -> AESAConfiguration:
    bset = load_boundary_sets()["Sala2020_EF"]
    mapping = suggest_method_mapping(methods, bset)
    multi_d = build_default_multi_d_config()
    carbon = build_carbon_budget() if with_carbon else None
    return AESAConfiguration(
        id="cfg-test",
        name="Test AESA",
        mfa_system_id="test-system",
        impact_mode="static",
        boundary_set_id="Sala2020_EF",
        multi_d=multi_d,
        carbon_budget=carbon,
        method_mapping=mapping,
        created_at="2025-01-01T00:00:00Z",
    )


def test_method_mapping_suggestion() -> None:
    results = _fixture_impact_results()
    methods = [list(r.method) for r in results]
    bset = load_boundary_sets()["Sala2020_EF"]
    mapping = suggest_method_mapping(methods, bset)
    by_tuple = {"|".join(m.method_tuple): m.pb_id for m in mapping}
    assert by_tuple["EF v3.1|climate change|global warming potential (GWP100)"] == "climate_change"
    assert by_tuple["EF v3.1|acidification|accumulated exceedance (AE)"] == "acidification"


def test_multi_d_defaults_cover_all_boundaries() -> None:
    bset = load_boundary_sets()["Sala2020_EF"]
    for pb_id in bset.boundaries:
        assert pb_id in MULTI_D_DEFAULTS, f"{pb_id} missing from MULTI_D_DEFAULTS"


def test_compute_flow_boundary_matches_hand_calc() -> None:
    """Hand-calc for acidification (flow boundary, EpC):

    PB = 1.0e12 mol H+ eq/yr   (from boundary_sets.json)
    layer1 = Denmark pop / World pop = 5_960_000 / 8_100_000_000
    layer2 = 0.15 (from sharing_data.json)
    allocated_SOS = PB × layer1 × layer2
    SR = impact / allocated_SOS
    """
    results = _fixture_impact_results()
    config = _make_config([list(r.method) for r in results], with_carbon=True)
    bset = load_boundary_sets()["Sala2020_EF"]
    out = AESAEngine.compute(results, config, bset)

    acid = next(r for r in out.results if r.pb_id == "acidification")
    expected_l1 = 5_960_000 / 8_100_000_000
    expected_allocated = 1.0e12 * expected_l1 * 0.15
    expected_sr = 1.0e8 / expected_allocated
    assert abs(acid.sharing_factor_l1 - expected_l1) / expected_l1 < 1e-9
    assert abs(acid.allocated_sos - expected_allocated) / expected_allocated < 1e-9
    assert abs(acid.sr - expected_sr) / expected_sr < 1e-9
    assert acid.sharing_principle == "EpC"
    assert acid.boundary_type == "flow"
    assert acid.zone in ("safe", "zone_of_uncertainty", "high_risk")


def test_compute_cumulative_uses_carbon_budget() -> None:
    """Climate change is cumulative: allocated SOS = carbon budget fleet slice,
    NOT pb_value × factors."""
    results = _fixture_impact_results()
    config = _make_config([list(r.method) for r in results], with_carbon=True)
    bset = load_boundary_sets()["Sala2020_EF"]
    out = AESAEngine.compute(results, config, bset)

    climate = next(r for r in out.results if r.pb_id == "climate_change")
    # Cumulative path: allocated = carbon_budget.annual_fleet_allocation(2025, multi_d)
    expected = config.carbon_budget.annual_fleet_allocation(2025, config.multi_d)
    assert abs(climate.allocated_sos - expected) / expected < 1e-9
    assert climate.boundary_type == "cumulative"


def test_compute_without_carbon_uses_pb_value_for_climate() -> None:
    """If no carbon budget is supplied, climate_change falls back to the
    standard PB × Multi-D path (same as any flow boundary)."""
    results = _fixture_impact_results()
    config = _make_config([list(r.method) for r in results], with_carbon=False)
    bset = load_boundary_sets()["Sala2020_EF"]
    out = AESAEngine.compute(results, config, bset)

    climate = next(r for r in out.results if r.pb_id == "climate_change")
    pb = bset.boundaries["climate_change"]
    expected_l1 = 5_960_000 / 8_100_000_000
    expected = pb.pb_value * expected_l1 * 0.15
    assert abs(climate.allocated_sos - expected) / expected < 1e-9


def test_zone_thresholds() -> None:
    """Synthetic cases to verify zone boundaries (SR ≤ 1 safe, ≤ 2 uncertainty, > 2 high_risk)."""
    results = _fixture_impact_results()
    bset = load_boundary_sets()["Sala2020_EF"]
    # Build a method mapping manually for full control
    mapping = [MethodPBMapping(
        method_tuple=list(results[1].method), pb_id="acidification",
    )]
    config = AESAConfiguration(
        id="cfg-zone", name="zone-test", mfa_system_id="test-system",
        boundary_set_id="Sala2020_EF",
        multi_d=build_default_multi_d_config(),
        carbon_budget=None, method_mapping=mapping,
        created_at="2025-01-01T00:00:00Z",
    )
    l1 = 5_960_000 / 8_100_000_000
    allocated = 1.0e12 * l1 * 0.15  # ~110e3

    # Impact for SR=0.5 (safe)
    results[1].years[0].total_impact = allocated * 0.5
    out = AESAEngine.compute([results[1]], config, bset)
    assert out.results[0].zone == "safe"

    # SR=1.5 (uncertainty)
    results[1].years[0].total_impact = allocated * 1.5
    out = AESAEngine.compute([results[1]], config, bset)
    assert out.results[0].zone == "zone_of_uncertainty"

    # SR=3.0 (high_risk)
    results[1].years[0].total_impact = allocated * 3.0
    out = AESAEngine.compute([results[1]], config, bset)
    assert out.results[0].zone == "high_risk"


def test_summary_by_year_counts() -> None:
    results = _fixture_impact_results()
    config = _make_config([list(r.method) for r in results], with_carbon=True)
    bset = load_boundary_sets()["Sala2020_EF"]
    out = AESAEngine.compute(results, config, bset)
    assert len(out.summary_by_year) == 1
    s = out.summary_by_year[0]
    assert s.year == 2025
    assert s.total_assessed == s.safe + s.zone_of_uncertainty + s.high_risk
    assert s.total_assessed == 2  # two mapped methods


def test_sensitivity_runs_all_principles() -> None:
    results = _fixture_impact_results()
    config = _make_config([list(r.method) for r in results], with_carbon=True)
    bset = load_boundary_sets()["Sala2020_EF"]
    out = AESAEngine.compute_with_sensitivity(results, config, bset)
    assert out.sensitivity is not None
    assert set(out.sensitivity.keys()) == {"EpC", "IN", "AGR", "LA", "AR"}
    for principle, rs in out.sensitivity.items():
        assert all(r.sharing_principle == principle for r in rs)


if __name__ == "__main__":
    # Lightweight runner — pytest-style assertions, but works as a script too.
    import traceback
    tests = [
        test_method_mapping_suggestion,
        test_multi_d_defaults_cover_all_boundaries,
        test_compute_flow_boundary_matches_hand_calc,
        test_compute_cumulative_uses_carbon_budget,
        test_compute_without_carbon_uses_pb_value_for_climate,
        test_zone_thresholds,
        test_summary_by_year_counts,
        test_sensitivity_runs_all_principles,
    ]
    n_pass = 0
    for t in tests:
        try:
            t()
            print(f"PASS  {t.__name__}")
            n_pass += 1
        except Exception:
            print(f"FAIL  {t.__name__}")
            traceback.print_exc()
    print(f"\n{n_pass}/{len(tests)} passed")
