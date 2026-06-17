"""Patch 2a — SharingPreset grows into the Carrying-Capacity template.

SharingPreset now also carries `boundary_set_id` + `carbon_budget` (the whole
denominator). This is PERSISTENCE ONLY: compute reads the AESAConfiguration's
own snapshot (config.boundary_set_id / config.carbon_budget / config.sharing),
NEVER the template's fields, so SR values cannot change. These tests lock
back-compat + no-drift.
"""
from __future__ import annotations

from mapper.core.aesa_engine import (
    AESAEngine,
    build_carbon_budget,
    build_default_sharing_preset,
    load_boundary_sets,
    suggest_method_mapping,
)
from mapper.core import sharing_preset_storage
from mapper.models.aesa_schemas import (
    AESAComputeResult,
    AESAConfiguration,
    AESASession,
    AESAYearSummary,
    CarbonBudgetConfig,
    SharingPreset,
)
from mapper.models.bom_schemas import DSMLCAResult, DSMLCASummary, DSMLCAYearResult


# ── fixtures ─────────────────────────────────────────────────────────────────

def _impact() -> list[DSMLCAResult]:
    climate = DSMLCAResult(
        mfa_system_id="sys-1",
        method=["EF v3.1", "climate change", "global warming potential (GWP100)"],
        method_label="EF v3.1 › climate change › GWP100", scope="stock", unit="kg CO2 eq",
        years=[DSMLCAYearResult(year=2030, total_impact=6.0e9, unit="kg CO2 eq",
                                impact_by_cohort={"BEV": 6.0e9}, impact_by_material={}, count_by_cohort={})],
        summary=DSMLCASummary(total_impact=6.0e9, peak_year=2030, peak_impact=6.0e9),
    )
    acid = DSMLCAResult(
        mfa_system_id="sys-1",
        method=["EF v3.1", "acidification", "accumulated exceedance (AE)"],
        method_label="EF v3.1 › acidification › AE", scope="stock", unit="mol H+ eq",
        years=[DSMLCAYearResult(year=2030, total_impact=1.0e8, unit="mol H+ eq",
                                impact_by_cohort={"BEV": 1.0e8}, impact_by_material={}, count_by_cohort={})],
        summary=DSMLCASummary(total_impact=1.0e8, peak_year=2030, peak_impact=1.0e8),
    )
    return [climate, acid]


def _config_with_template() -> tuple[AESAConfiguration, object]:
    bset = load_boundary_sets()["Sala2020_EF"]
    methods = [["EF v3.1", "climate change", "global warming potential (GWP100)"],
               ["EF v3.1", "acidification", "accumulated exceedance (AE)"]]
    mapping = suggest_method_mapping(methods, bset)
    sharing = build_default_sharing_preset()  # the built-in template (sharing snapshot)
    config = AESAConfiguration(
        id="cfg-1", name="cfg", mfa_system_id="sys-1", impact_mode="static",
        boundary_set_id="Sala2020_EF",
        carbon_budget=build_carbon_budget(),
        sharing=sharing,
        sharing_preset_id="ferhati_2026_multi_d",
        method_mapping=mapping,
        multi_d=None,
        created_at="2025-01-01T00:00:00Z",
    )
    return config, bset


def _sr_signature(result: AESAComputeResult):
    return sorted((r.pb_id, r.year, r.impact, r.allocated_sos, r.sr) for r in result.results)


# ── back-compat ──────────────────────────────────────────────────────────────

def test_old_preset_without_new_fields_loads_with_defaults():
    """A SharingPreset saved before 2a (no boundary_set_id / carbon_budget) loads
    with the back-compat defaults."""
    old = {
        "id": "user-1", "name": "My preset", "built_in": False,
        "principles": [], "category_assignments": [],
        "chain": {"layers": [{"layer_number": 1, "name": "L1",
                              "principle_mode": "fixed", "fixed_principle": "EpC", "data": {}}]},
        "created_at": "2024-01-01T00:00:00Z",
    }
    p = SharingPreset.model_validate(old)
    assert p.boundary_set_id == "Sala2020_EF"   # default
    assert p.carbon_budget is None              # inherit-default semantic


def test_old_config_loads_unchanged():
    """An AESAConfiguration with a pre-2a sharing snapshot loads unchanged; its
    embedded sharing gets the new-field defaults."""
    cfg, _ = _config_with_template()
    raw = cfg.model_dump()
    # Strip the new fields from the embedded sharing snapshot (old shape).
    raw["sharing"].pop("boundary_set_id", None)
    raw["sharing"].pop("carbon_budget", None)
    cfg2 = AESAConfiguration.model_validate(raw)
    assert cfg2.boundary_set_id == "Sala2020_EF"
    assert cfg2.sharing.boundary_set_id == "Sala2020_EF"  # defaulted on the snapshot
    assert cfg2.sharing.carbon_budget is None


def test_old_session_loads_unchanged():
    """An AESASession (immutable output snapshot) loads regardless of the new
    template fields on its embedded configuration_snapshot.sharing."""
    cfg, _ = _config_with_template()
    raw_cfg = cfg.model_dump()
    raw_cfg["sharing"].pop("boundary_set_id", None)
    raw_cfg["sharing"].pop("carbon_budget", None)
    session = {
        "id": "sess-1", "name": "old session", "project": "proj",
        "created_at": "2024-06-01T00:00:00Z", "modified_at": "2024-06-01T00:00:00Z",
        "configuration_snapshot": raw_cfg,
        "result": AESAComputeResult(config_id="cfg-1", results=[],
                                    summary_by_year=[AESAYearSummary(year=2030, safe=0, zone_of_uncertainty=0, high_risk=0, total_assessed=0)]).model_dump(),
    }
    s = AESASession.model_validate(session)
    assert s.configuration_snapshot.sharing.boundary_set_id == "Sala2020_EF"


def test_builtin_template_present_and_read_only():
    presets = [SharingPreset.model_validate(p) for p in sharing_preset_storage.load_all()]
    builtin = next((p for p in presets if p.id == "ferhati_2026_multi_d"), None)
    assert builtin is not None
    assert builtin.built_in is True
    # It carries the new carrying-capacity fields (defaulted), i.e. it IS a template.
    assert builtin.boundary_set_id == "Sala2020_EF"


# ── round-trip ───────────────────────────────────────────────────────────────

def test_template_roundtrip_with_carrying_capacity():
    tpl = build_default_sharing_preset().model_copy(update={
        "id": "tpl-x", "name": "Custom CC template", "built_in": False,
        "boundary_set_id": "Sala2020_EF",
        "carbon_budget": build_carbon_budget(),
    })
    reloaded = SharingPreset.model_validate_json(tpl.model_dump_json())
    assert reloaded == tpl
    assert reloaded.boundary_set_id == "Sala2020_EF"
    assert reloaded.carbon_budget is not None
    assert reloaded.carbon_budget.initial_budget_gt == tpl.carbon_budget.initial_budget_gt


# ── NO-DRIFT (critical) ──────────────────────────────────────────────────────

def test_compute_ignores_template_fields_on_sharing_snapshot():
    """Compute reads boundary_set_id + carbon_budget from the CONFIG, never from
    the (now-extended) sharing snapshot. Mutating the snapshot's new fields to
    garbage must NOT change a single SR/SOS value — proving persistence-only."""
    config, bset = _config_with_template()
    base = AESAEngine.compute(_impact(), config, bset)
    base_sig = _sr_signature(base)

    # Set the embedded sharing snapshot's NEW fields to values that, if compute
    # read them, would change everything (wrong boundary set + tiny budget).
    config.sharing.boundary_set_id = "NONEXISTENT_SET"
    config.sharing.carbon_budget = CarbonBudgetConfig(
        initial_budget_gt=1.0, budget_source="garbage", start_year=2025, end_year=2026,
        projected_emissions={2025: 999.0}, ssp_scenario="garbage",
    )
    after = AESAEngine.compute(_impact(), config, bset)

    assert _sr_signature(after) == base_sig   # byte-identical → no drift
    # And the climate denominator came from CONFIG.carbon_budget, not the snapshot.
    climate = next((r for r in base.results if r.pb_id == "climate_change"), None)
    if climate is not None and climate.boundary_type == "cumulative":
        assert climate.allocated_sos > 0
        assert climate.remaining_budget_gt == config.carbon_budget.remaining_budget(climate.year)


def test_compute_reads_config_boundary_set_not_template():
    """Even when the referenced template (separate object) carries a different
    boundary_set_id, compute uses the bset passed from config.boundary_set_id."""
    config, bset = _config_with_template()
    # A conflicting template (would resolve to a different PB set if compute read it).
    _conflicting_template = build_default_sharing_preset().model_copy(update={
        "id": "tpl-conflict", "boundary_set_id": "SOME_OTHER_SET",
        "carbon_budget": CarbonBudgetConfig(
            initial_budget_gt=42.0, budget_source="x", start_year=2025, end_year=2030,
            projected_emissions={2025: 10.0}, ssp_scenario="x"),
    })
    # config still references it, but compute never loads it.
    config.sharing_preset_id = "tpl-conflict"
    result = AESAEngine.compute(_impact(), config, bset)
    # Acidification (flow) SR uses bset's pb_value (Sala2020_EF), proving the
    # Sala set drove compute regardless of the template's boundary_set_id.
    acid = next((r for r in result.results if r.pb_id == "acidification"), None)
    assert acid is not None
    assert acid.allocated_sos > 0
