"""Patch 5AS — AESA Excel export of the underlying SR values.

The "Impacts vs SOS" sheet must carry, per year/indicator: system impact
(numerator), assigned SOS share (denominator), SR, total system share, and —
for climate (cumulative) — the allocation chain (remaining budget → per-year
global allocation). Every value must EQUAL the authoritative result row (no
recompute drift in the export).
"""
from mapper.api.aesa import _build_aesa_workbook
from mapper.models.aesa_schemas import (
    AESAComputeResult,
    AESAConfiguration,
    AESAYearSummary,
    CarbonBudgetConfig,
    MultiDConfig,
    SustainabilityRatioResult,
)


def _fixture():
    # Chain-consistent fixture: allocated = global(Gt)·1e12·share
    # = 12·1e12·0.001 = 1.2e10; sr = impact/allocated = 6e9/1.2e10 = 0.5.
    climate = SustainabilityRatioResult(
        year=2030, pb_id="climate_change", pb_name="Climate change",
        ef_indicator="climate change", method_label="EF v3.1 | climate change",
        impact=6.0e9, allocated_sos=1.2e10, sr=0.5,
        remaining_budget_gt=900.0, global_allocation_gt=12.0,
        zone="safe", sharing_principle="EpC",
        layer_factors=[0.002, 0.5], total_sharing_factor=0.001,
        sharing_factor_l1=0.002, sharing_factor_l2=0.5,
        boundary_type="cumulative", unit="kg CO2-eq",
    )
    flow = SustainabilityRatioResult(
        year=2030, pb_id="acidification", pb_name="Acidification",
        ef_indicator="acidification", method_label="EF v3.1 | acidification",
        impact=1.0e8, allocated_sos=2.0e8, sr=0.5,
        # remaining/global default to None for non-cumulative boundaries.
        zone="safe", sharing_principle="EpC",
        layer_factors=[0.15], total_sharing_factor=0.15,
        sharing_factor_l1=0.15, sharing_factor_l2=1.0,
        boundary_type="flow", unit="mol H+ eq",
    )
    result = AESAComputeResult(
        config_id="cfg-1",
        results=[climate, flow],
        summary_by_year=[AESAYearSummary(year=2030, safe=1, zone_of_uncertainty=1, high_risk=0, total_assessed=2)],
    )
    config = AESAConfiguration(
        id="cfg-1", name="Test", mfa_system_id="sys-1", dsm_scenario_id="SSP2",
        multi_d=MultiDConfig(layer1={}, layer2_sector_share=0.12, layer2_source="grandfathering"),
        carbon_budget=CarbonBudgetConfig(
            initial_budget_gt=1150.0, budget_source="IPCC AR6 WG1 Table SPM.2",
            start_year=2025, end_year=2100, projected_emissions={2025: 40.0, 2030: 38.0},
            ssp_scenario="SSP2-4.5", provisional=True,
        ),
        created_at="2025-01-01T00:00:00Z",
    )
    return config, result


def _impacts_vs_sos_rows(wb):
    ws = wb["Impacts vs SOS"]
    header = [c.value for c in ws[1]]
    rows = []
    for r in ws.iter_rows(min_row=2, values_only=True):
        rows.append(dict(zip(header, r)))
    return header, rows


def test_impacts_vs_sos_has_sr_chain_columns():
    config, result = _fixture()
    wb = _build_aesa_workbook(config, result, "Test System")
    header, rows = _impacts_vs_sos_rows(wb)
    for col in ("Impact", "Allocated SOS", "SR", "System Share",
                "Remaining Budget (Gt)", "Global Allocation (Gt/yr)"):
        assert col in header, f"missing column {col}"
    assert len(rows) == 2


def test_climate_row_values_equal_result_no_recompute():
    """The climate row carries the full allocation chain, each value equal to
    the result row (no recompute in the export)."""
    config, result = _fixture()
    climate = next(r for r in result.results if r.pb_id == "climate_change")
    wb = _build_aesa_workbook(config, result, "Test System")
    _, rows = _impacts_vs_sos_rows(wb)
    row = next(r for r in rows if r["PB ID"] == "climate_change")

    assert row["Year"] == climate.year
    assert row["Impact"] == climate.impact
    assert row["Allocated SOS"] == climate.allocated_sos
    assert row["SR"] == climate.sr
    assert row["System Share"] == climate.total_sharing_factor
    assert row["Remaining Budget (Gt)"] == climate.remaining_budget_gt   # 900.0
    assert row["Global Allocation (Gt/yr)"] == climate.global_allocation_gt  # 12.0
    # Internal consistency of the surfaced chain: global_alloc(Gt)·1e12·share == allocated_sos.
    assert abs(climate.global_allocation_gt * 1e12 * climate.total_sharing_factor
               - climate.allocated_sos) < 1.0


def test_non_climate_row_omits_budget_chain():
    """Flow boundaries have no carbon-budget chain — those cells are blank."""
    config, result = _fixture()
    wb = _build_aesa_workbook(config, result, "Test System")
    _, rows = _impacts_vs_sos_rows(wb)
    flow = next(r for r in rows if r["PB ID"] == "acidification")
    assert flow["Impact"] == 1.0e8
    assert flow["Allocated SOS"] == 2.0e8
    assert flow["SR"] == 0.5
    assert flow["System Share"] == 0.15
    assert flow["Remaining Budget (Gt)"] is None
    assert flow["Global Allocation (Gt/yr)"] is None


def test_summary_metadata_header():
    config, result = _fixture()
    wb = _build_aesa_workbook(config, result, "Test System")
    cells = {row[0]: row[1] for row in wb["Summary"].iter_rows(min_row=1, max_col=2, values_only=True) if row[0]}
    assert cells["DSM scenario"] == "SSP2"
    assert "1150" in str(cells["Carbon budget"])
    assert cells["SSP scenario"] == "SSP2-4.5"
    assert cells["Budget horizon"] == "2025–2100"
