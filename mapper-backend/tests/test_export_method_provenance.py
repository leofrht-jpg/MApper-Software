# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Every result workbook names the impact assessment method it came from.

Two things per workbook, the same in all fifteen:

* a metadata row ``Impact assessment method`` in the existing block, directly
  after the row that lists or counts the categories, naming the family or
  families;
* an ``Impact assessment methods`` sheet listing, per category, the full
  Brightway tuple, its unit and its source.

Each builder is driven with a synthetic EF run, a synthetic ReCiPe run and a
mixed run (both families in one result). The two single-method exports
(contribution analysis and multi-year contribution) take exactly one method per
run, so they have no mixed case.

All data is synthetic. The registry and the Method Library are replaced with
in-memory lookups; nothing reads a real project.
"""
from __future__ import annotations

import ast
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from mapper.core import method_provenance as mp

BACKEND = Path(__file__).resolve().parents[1] / "mapper"

EF_GW = ("EF v3.1", "climate change", "global warming potential (GWP100)")
EF_AC = ("EF v3.1", "acidification", "accumulated exceedance (AE)")
RE_GW = ("ReCiPe 2016 v1.03, midpoint (H)", "climate change", "global warming potential (GWP1000)")
RE_AC = ("ReCiPe 2016 v1.03, midpoint (H)", "acidification: terrestrial", "terrestrial acidification potential (TAP)")
UNITS = {EF_GW: "kg CO2-Eq", EF_AC: "mol H+-Eq", RE_GW: "kg CO2-Eq", RE_AC: "kg SO2-Eq"}

EF_SOURCE = ("Brightway default methods: bw2io bundled data from the ecoinvent 3.9 LCIA "
             "implementation (not installed by the MApper Method Library)")
RE_SOURCE = ("MApper Method Library (ReCiPe 2016 midpoint (H, I, E)): bw2io bundled data from the "
             "ecoinvent 3.9 LCIA implementation")

#: The expected sheet row for each tuple, written out by hand rather than
#: derived with the helper, so the assertion is not circular. The ReCiPe
#: climate indicator reads GWP100 (#211) while the tuple keeps GWP1000.
EXPECTED_ROW = {
    EF_GW: ["EF v3.1", "climate change", "global warming potential (GWP100)",
            "('EF v3.1', 'climate change', 'global warming potential (GWP100)')", "kg CO2-Eq", EF_SOURCE],
    EF_AC: ["EF v3.1", "acidification", "accumulated exceedance (AE)",
            "('EF v3.1', 'acidification', 'accumulated exceedance (AE)')", "mol H+-Eq", EF_SOURCE],
    RE_GW: ["ReCiPe 2016 v1.03, midpoint (H)", "climate change", "global warming potential (GWP100)",
            "('ReCiPe 2016 v1.03, midpoint (H)', 'climate change', 'global warming potential (GWP1000)')",
            "kg CO2-Eq", RE_SOURCE],
    RE_AC: ["ReCiPe 2016 v1.03, midpoint (H)", "acidification: terrestrial",
            "terrestrial acidification potential (TAP)",
            "('ReCiPe 2016 v1.03, midpoint (H)', 'acidification: terrestrial', "
            "'terrestrial acidification potential (TAP)')", "kg SO2-Eq", RE_SOURCE],
}

CASES = {
    "EF": ([EF_GW, EF_AC], "EF v3.1"),
    "ReCiPe": ([RE_GW, RE_AC], "ReCiPe 2016 v1.03, midpoint (H)"),
    "mixed": ([EF_GW, RE_GW, RE_AC], "EF v3.1; ReCiPe 2016 v1.03, midpoint (H)"),
}
SINGLE_CASES = {"EF": ([EF_GW], "EF v3.1"), "ReCiPe": ([RE_GW], "ReCiPe 2016 v1.03, midpoint (H)")}


@pytest.fixture(autouse=True)
def _synthetic_registry(monkeypatch):
    """EF as bw2setup leaves it; ReCiPe as the Method Library installs it."""
    registry = {t: {"unit": f"registry {UNITS[t]}", "filename": "LCIA_Implementation_3.9.xlsx"}
                for t in UNITS}
    monkeypatch.setattr(mp, "registered_metadata", lambda m: registry.get(tuple(m)))
    monkeypatch.setattr(mp, "library_sources", lambda: {RE_GW: RE_SOURCE, RE_AC: RE_SOURCE})


# ── Fixtures, one per result shape ──────────────────────────────────────────

def _arc(methods):
    from mapper.models.schemas import ArchetypeLCACalculateResult, ArchetypeLCAMethodResult

    return ArchetypeLCACalculateResult(
        archetype_id="arc-1", archetype_name="Product", scope="all", amount=1.0,
        stage_amounts={"Manufacturing": 1.0}, stages_included=["Manufacturing"],
        results=[ArchetypeLCAMethodResult(method=list(m), method_label=m[-1], score=1.0 + i,
                                          unit=UNITS[m], contributions=[])
                 for i, m in enumerate(methods)],
        elapsed_seconds=0.1, warnings=[],
    )


def _dsmlca(m):
    from mapper.models.bom_schemas import DSMLCAResult, DSMLCASummary, DSMLCAYearResult

    return DSMLCAResult(
        mfa_system_id="sys-1", scope="stock", method=list(m), method_label=" › ".join(m), unit=UNITS[m],
        years=[DSMLCAYearResult(year=2030, total_impact=10.0, impact_by_cohort={"BEV|Small|2028": 10.0},
                                impact_by_material={"battery": 10.0}, count_by_cohort={"BEV|Small|2028": 1.0},
                                unit=UNITS[m])],
        summary=DSMLCASummary(total_impact=10.0, peak_year=2030, peak_impact=10.0),
        stages_included=["Use Phase"],
    )


def _meta(mode="static", **kw):
    from mapper.models.bom_schemas import ImpactAssessmentMeta

    return ImpactAssessmentMeta(mode=mode, mfa_system_id="sys-1", scope="stock", year_start=2030,
                                year_end=2030, base_db="ecoinvent-3.10-cutoff", **kw)


def _inner(methods, mode="static", **kw):
    from mapper.models.bom_schemas import ImpactAssessmentResult

    return ImpactAssessmentResult(task_id="t", meta=_meta(mode, **kw), results=[_dsmlca(m) for m in methods])


def _payload(methods):
    from mapper.models.schemas import SingleProductProspectiveRunPayload

    return SingleProductProspectiveRunPayload(db_name="ei_remind_ssp1_2030", year=2030, iam="remind",
                                              ssp="SSP1", result=_arc(methods))


def _dist(m):
    from mapper.models.schemas import ArchetypeLCAMethodDistribution

    return ArchetypeLCAMethodDistribution(
        method=list(m), method_label=m[-1], unit=UNITS[m], deterministic=1.0, median=1.0, mean=1.0,
        p2_5=0.9, p25=0.95, p75=1.05, p97_5=1.1, gsd2=1.2, n_iterations=10, seed=7, samples=None,
    )


def _contribution(m):
    from mapper.models.schemas import (
        ContributionAnalysisResult, ContributionsResponse, ContributionTreeNode, SankeyData,
    )

    return ContributionAnalysisResult(
        target_type="archetype", target_label="Product", method=list(m), method_unit=UNITS[m], score=1.0,
        top_technosphere=ContributionsResponse(items=[], rest_amount=0.0, rest_percentage=0.0),
        top_biosphere=[], supply_chain_sankey=SankeyData(nodes=[], links=[]),
        supply_chain_tree=ContributionTreeNode(name="root", key="k", amount=1.0, unit="unit", score=1.0,
                                               unit_score=UNITS[m], percentage=100.0),
        cutoff=0.01, max_depth=3,
    )


def _b_sp_static(methods):
    from mapper.api.impact import _build_single_product_static_workbook

    return _build_single_product_static_workbook("Product", "all", [("Base", _arc(methods))]), \
        [("Configuration", "Indicators")]


def _b_sp_prospective(methods):
    from mapper.api.impact import _build_single_product_prospective_workbook

    return _build_single_product_prospective_workbook(archetype_name="Product", scope="all",
                                                      runs=[_payload(methods)]), \
        [("Configuration", "Indicators")]


def _b_sp_comparison(methods):
    from mapper.api.impact import _build_single_product_comparison_workbook

    return _build_single_product_comparison_workbook(archetype_name="Product", scope="all",
                                                     static_result=_arc(methods),
                                                     projected_runs=[_payload(methods)]), \
        [("Configuration", "Indicators (Static)")]


def _b_multi_product(methods):
    from mapper.api.impact import _build_multi_product_workbook
    from mapper.models.schemas import MultiProductExportRequest, MultiProductItemResult, MultiProductLCAResult

    items = [MultiProductItemResult(type="archetype", item_id=f"a{i}", label=f"Item {i}", status="success",
                                    archetype_result=_arc(methods)) for i in range(2)]
    body = MultiProductExportRequest(result=MultiProductLCAResult(items=items, elapsed_seconds=0.1,
                                                                  success_count=2, error_count=0),
                                     scope="all")
    return _build_multi_product_workbook(body), [("Configuration", "Methods")]


def _b_fleet(methods):
    from mapper.api.bom import _build_mfa_lca_workbook

    return _build_mfa_lca_workbook(
        system_name="Fleet", results=[_dsmlca(m) for m in methods], scope="stock", selected_year=None,
        cohort_mapping=None, archetypes={}, sim_counts=None, dims=None,
    ), [("Summary", "Indicators calculated")]


def _b_multi_scenario(methods):
    from mapper.api.impact import _build_multi_scenario_workbook
    from mapper.models.bom_schemas import (
        MultiScenarioProjectedImpactResult, ProspectiveScenarioRef, ScenarioProjectedResult,
    )

    scen = [ScenarioProjectedResult(scenario=ProspectiveScenarioRef(base_db="ecoinvent-3.10-cutoff",
                                                                    iam="remind", ssp=ssp),
                                    result=_inner(methods, "projected"))
            for ssp in ("SSP1", "SSP2")]
    multi = MultiScenarioProjectedImpactResult(task_id="t", meta=_meta("projected"), scenarios=scen)
    return _build_multi_scenario_workbook(
        system_name="Fleet", multi_result=multi, sys_def=SimpleNamespace(name="Fleet", dimensions=[]),
        sim_counts=None, sim_result=None, archetypes={}, cohort_mapping=None, subsystems=None,
    ), [("Summary", "Indicators")]


def _b_multi_param(methods):
    from mapper.api import impact as impact_api
    from mapper.models.bom_schemas import MultiParamImpactResult, ParamScenarioImpactResult

    env = MultiParamImpactResult(meta=_meta(), elapsed_seconds=1.0, scenarios=[
        ParamScenarioImpactResult(scenario=s, result=_inner(methods)) for s in ("Base", "High")])
    with patch.object(impact_api, "_resolve_varying_parameters",
                      return_value=([], {s.scenario: {} for s in env.scenarios})):
        return impact_api._build_multi_param_workbook("Fleet", env), [("Summary", "Indicators")]


def _b_multi_dsm(methods):
    from mapper.api.impact import _build_multi_dsm_workbook
    from mapper.models.bom_schemas import DSMScenarioImpactResult, MultiDSMImpactResult

    env = MultiDSMImpactResult(meta=_meta(), elapsed_seconds=1.0, scenarios=[
        DSMScenarioImpactResult(scenario_id=s, scenario_name=s, result=_inner(methods, dsm_scenario_id=s))
        for s in ("ssp1", "ssp2")])
    return _build_multi_dsm_workbook("Fleet", env), [("Summary", "Indicators")]


def _b_multi_paired(methods):
    from mapper.api.impact import _build_multi_paired_workbook
    from mapper.models.bom_schemas import MultiPairedImpactResult, PairedScenarioImpactResult, ProspectiveScenarioRef

    env = MultiPairedImpactResult(meta=_meta("projected"), scenarios=[
        PairedScenarioImpactResult(dsm_scenario_id=s, dsm_scenario_name=s,
                                   lci_scenario=ProspectiveScenarioRef(base_db="ecoinvent-3.10-cutoff",
                                                                       iam="remind", ssp=s),
                                   lci_scenario_label=f"REMIND/{s}", result=_inner(methods, "projected"))
        for s in ("SSP1", "SSP2")])
    return _build_multi_paired_workbook("Fleet", env), [("Summary", "Indicators")]


def _b_archetype_lca(methods):
    from mapper.api.lca import _build_lca_export_workbook

    return _build_lca_export_workbook([_arc(methods)]), [("Summary", "MApper version")]


def _b_contribution(methods):
    from mapper.api.lca import _build_contribution_workbook

    (m,) = methods
    return _build_contribution_workbook(_contribution(m)), [("Summary", "Method")]


def _b_multi_year(methods):
    from mapper.api.lca import _build_multi_year_workbook
    from mapper.models.schemas import MultiYearContributionResult

    (m,) = methods
    res = MultiYearContributionResult(target_type="archetype", target_label="Product", method=list(m),
                                      method_unit=UNITS[m], years=[2030], results={"2030": _contribution(m)},
                                      cutoff=0.01, max_depth=3)
    return _build_multi_year_workbook(res), [("Summary", "Method")]


def _b_monte_carlo(methods):
    from mapper.api.monte_carlo import _build_monte_carlo_workbook
    from mapper.models.schemas import MonteCarloResult

    res = MonteCarloResult(archetype_id="a", archetype_name="Product", scope="all", n_iterations=10, seed=7,
                           distributions=[_dist(m) for m in methods])
    return _build_monte_carlo_workbook(res, None), [("Summary", "Background database")]


def _b_monte_carlo_multi(methods):
    from mapper.api.monte_carlo import _build_monte_carlo_multi_workbook
    from mapper.models.schemas import ItemDistribution, MonteCarloMultiResult

    res = MonteCarloMultiResult(scope="all", n_iterations=10, seed=7, differences=[], items=[
        ItemDistribution(archetype_id=i, archetype_name=f"Item {i}", distributions=[_dist(m) for m in methods])
        for i in ("a", "b")])
    return _build_monte_carlo_multi_workbook(res), [("Summary", "Background database")]


def _b_aesa(methods):
    from mapper.api.aesa import _build_aesa_workbook
    from mapper.models.aesa_schemas import (
        AESAComputeResult, AESAConfiguration, AESAYearSummary, MethodPBMapping, SustainabilityRatioResult,
    )

    pbs = [f"pb_{i}" for i in range(len(methods))]
    results = [SustainabilityRatioResult(
        year=2030, pb_id=pb, pb_name=f"Boundary {i}", ef_indicator=m[1], method_label=" | ".join(m),
        impact=1.0, allocated_sos=2.0, sr=0.5, zone="safe", sharing_principle="EpC", layer_factors=[1.0],
        total_sharing_factor=1.0, sharing_factor_l1=1.0, sharing_factor_l2=1.0, boundary_type="flow",
        unit=UNITS[m]) for i, (pb, m) in enumerate(zip(pbs, methods))]
    config = AESAConfiguration(
        id="cfg", name="Config", mfa_system_id="sys-1", created_at="2026-01-01T00:00:00Z",
        # An unreported boundary's mapping must NOT be listed.
        method_mapping=[MethodPBMapping(method_tuple=list(m), pb_id=pb) for pb, m in zip(pbs, methods)]
        + [MethodPBMapping(method_tuple=["CML v4.8 2016", "x", "y"], pb_id="not_reported")],
    )
    result = AESAComputeResult(config_id="cfg", results=results, summary_by_year=[
        AESAYearSummary(year=2030, safe=len(methods), zone_of_uncertainty=0, high_risk=0,
                        total_assessed=len(methods))])
    return _build_aesa_workbook(config, result, "Fleet"), [("Summary", "Impact source"),
                                                          ("Methodology", "Impact source")]


MULTI_METHOD_BUILDERS = {
    "single-product static": _b_sp_static,
    "single-product prospective": _b_sp_prospective,
    "single-product comparison": _b_sp_comparison,
    "multi-product comparison": _b_multi_product,
    "fleet impact assessment": _b_fleet,
    "fleet multi-LCI-scenario": _b_multi_scenario,
    "fleet multi-parameter": _b_multi_param,
    "fleet multi-DSM": _b_multi_dsm,
    "fleet paired DSM x LCI": _b_multi_paired,
    "archetype LCA": _b_archetype_lca,
    "Monte Carlo": _b_monte_carlo,
    "Monte Carlo multi-item": _b_monte_carlo_multi,
    "AESA": _b_aesa,
}
SINGLE_METHOD_BUILDERS = {
    "contribution analysis": _b_contribution,
    "multi-year contribution": _b_multi_year,
}


def _assert_workbook(wb, anchors, methods, family_text, *, registry_unit=False):
    for sheet, anchor in anchors:
        rows = [list(r) for r in wb[sheet].iter_rows(values_only=True)]
        hits = [i for i, r in enumerate(rows) if r and r[0] == mp.LABEL]
        assert len(hits) == 1, f"{sheet}: expected one '{mp.LABEL}' row, found {len(hits)}"
        i = hits[0]
        assert rows[i][1] == family_text, (sheet, rows[i])
        assert rows[i - 1][0] == anchor, f"{sheet}: the row sits after {rows[i - 1][0]!r}, not {anchor!r}"

    assert wb.sheetnames[-1] == mp.SHEET
    ws = wb[mp.SHEET]
    assert [ws["A1"].value, ws["B1"].value] == [mp.LABEL, family_text]
    assert [c.value for c in ws[4]] == mp.COLUMNS
    body = [list(r) for r in ws.iter_rows(min_row=5, values_only=True)]
    expected = [list(EXPECTED_ROW[m]) for m in methods]
    if registry_unit:
        for row in expected:
            row[4] = f"registry {row[4]}"
    assert body == expected


@pytest.mark.parametrize("case", list(CASES))
@pytest.mark.parametrize("export", list(MULTI_METHOD_BUILDERS))
def test_every_multi_method_export_names_its_methods(export, case):
    methods, family_text = CASES[case]
    wb, anchors = MULTI_METHOD_BUILDERS[export](methods)
    # An AESA result carries the BOUNDARY unit on each SR, not the impact
    # method's, so the method unit comes from the registry there.
    _assert_workbook(wb, anchors, methods, family_text, registry_unit=export == "AESA")


@pytest.mark.parametrize("case", list(SINGLE_CASES))
@pytest.mark.parametrize("export", list(SINGLE_METHOD_BUILDERS))
def test_every_single_method_export_names_its_method(export, case):
    methods, family_text = SINGLE_CASES[case]
    wb, anchors = SINGLE_METHOD_BUILDERS[export](methods)
    _assert_workbook(wb, anchors, methods, family_text)


def test_the_existing_methods_row_is_kept_beside_the_new_one():
    wb, _ = _b_multi_product(CASES["mixed"][0])
    rows = [list(r)[:2] for r in wb["Configuration"].iter_rows(values_only=True)]
    i = [r[0] for r in rows].index("Methods")
    assert rows[i + 1] == [mp.LABEL, "EF v3.1; ReCiPe 2016 v1.03, midpoint (H)"]
    assert "climate change" in rows[i][1]


# ── The helper on its own ───────────────────────────────────────────────────

def test_the_result_unit_wins_over_the_registry():
    prov = mp.describe_methods([EF_GW], {EF_GW: "kg CO2-Eq (as computed)"})
    assert prov.categories[0].unit == "kg CO2-Eq (as computed)"


def test_the_registry_unit_is_the_fallback_and_not_recorded_the_last_resort(monkeypatch):
    assert mp.describe_methods([EF_GW]).categories[0].unit == "registry kg CO2-Eq"
    monkeypatch.setattr(mp, "registered_metadata", lambda m: None)
    assert mp.describe_methods([EF_GW]).categories[0].unit == "not recorded"


def test_duplicates_are_listed_once_in_first_seen_order():
    prov = mp.describe_methods([RE_GW, EF_GW, RE_GW, EF_AC])
    assert [c.method for c in prov.categories] == [RE_GW, EF_GW, EF_AC]
    assert prov.family_text == "ReCiPe 2016 v1.03, midpoint (H); EF v3.1"


def test_no_methods_says_not_recorded():
    assert mp.describe_methods([]).meta_row() == (mp.LABEL, "not recorded")


@pytest.mark.parametrize("meta, expected", [
    (None, "unknown (the method is not in the project open at export time)"),
    ({"unit": "u"}, "unknown (the method is in the project with no recorded source)"),
    ({"filename": "LCIA_Implementation_3.9.xlsx"}, EF_SOURCE),
    ({"filename": "my_method.xlsx"},
     "Brightway method metadata names the file my_method.xlsx (not installed by the MApper Method Library)"),
])
def test_source_from_the_registry(monkeypatch, meta, expected):
    monkeypatch.setattr(mp, "registered_metadata", lambda m: meta)
    monkeypatch.setattr(mp, "library_sources", lambda: {})
    assert mp.describe_methods([EF_GW]).categories[0].source == expected


def test_a_library_record_is_not_claimed_for_a_method_missing_from_the_project(monkeypatch):
    monkeypatch.setattr(mp, "registered_metadata", lambda m: None)
    assert mp.describe_methods([RE_GW]).categories[0].source.startswith("unknown (the method is not in")


def test_a_failing_lookup_never_fails_the_export(monkeypatch):
    def boom(*_a):
        raise RuntimeError("registry unreadable")

    monkeypatch.setattr(mp, "registered_metadata", boom)
    monkeypatch.setattr(mp, "library_sources", boom)
    cat = mp.describe_methods([EF_GW], {EF_GW: "kg"}).categories[0]
    assert (cat.source, cat.unit) == ("unknown", "kg")


def test_the_real_lookups_read_manifests_and_the_registry(monkeypatch, tmp_path):
    """The two default lookups, against a temp Method Library and a fake
    registry: one manifest per installer kind."""
    import bw2data

    from mapper.core import lcia_method_engine as engine

    project = str(bw2data.projects.current)
    custom = ("Custom", "noise", "dB")
    iw = ("IMPACT World+ Midpoint 2.1", "climate change", "short term")
    lc = ("LC-IMPACT", "land use", "occupation")
    manifests = {
        "recipe_2016_midpoint": {"method_id": "recipe_2016_midpoint", "installer": "bundled_ef",
                                 "projects": {project: {"method_tuples": [list(RE_GW)]}}},
        "custom_abc": {"method_id": "custom_abc", "installer": "excel",
                       "file_path": str(tmp_path / "noise.xlsx"), "method_tuples": [list(custom)]},
        "impact_world_plus_2_2_1": {"method_id": "impact_world_plus_2_2_1", "installer": "bw2package",
                                    "ecoinvent_version": "3.10", "file_path": str(tmp_path / "iw.bw2package"),
                                    "method_tuples": [list(iw)]},
        "lc_impact": {"method_id": "lc_impact", "installer": "pip", "pip_spec": "bw2_lcimpact==0.4.2",
                      "method_tuples": [list(lc)]},
    }
    for mid, body in manifests.items():
        (tmp_path / mid).mkdir()
        (tmp_path / mid / "manifest.json").write_text(json.dumps(body), encoding="utf-8")
    monkeypatch.setattr(engine, "CACHE_ROOT", tmp_path)
    monkeypatch.setattr(engine, "_load_registry", lambda: [
        {"id": "recipe_2016_midpoint", "name": "ReCiPe 2016 midpoint (H, I, E)"},
        {"id": "impact_world_plus_2_2_1", "name": "IMPACT World+ 2.2.1"},
        {"id": "lc_impact", "name": "LC-IMPACT"},
    ])
    monkeypatch.setattr(bw2data, "methods", {t: {"unit": "u", "filename": ""} for t in (RE_GW, custom, iw, lc)})
    monkeypatch.setattr(mp, "registered_metadata", mp._registered_metadata)
    monkeypatch.setattr(mp, "library_sources", mp._library_sources)

    got = {c.method: c.source for c in mp.describe_methods([RE_GW, custom, iw, lc, EF_GW]).categories}
    assert got == {
        RE_GW: RE_SOURCE,
        custom: "MApper Method Library: custom upload (noise.xlsx)",
        iw: "MApper Method Library (IMPACT World+ 2.2.1): Brightway package for ecoinvent 3.10 (iw.bw2package)",
        lc: "MApper Method Library (LC-IMPACT): Python package bw2_lcimpact==0.4.2",
        EF_GW: "unknown (the method is not in the project open at export time)",
    }


def test_another_projects_bundled_install_is_not_claimed(monkeypatch, tmp_path):
    import bw2data

    from mapper.core import lcia_method_engine as engine

    (tmp_path / "ef_v3_1").mkdir()
    (tmp_path / "ef_v3_1" / "manifest.json").write_text(json.dumps({
        "method_id": "ef_v3_1", "installer": "bundled_ef",
        "projects": {"some other project": {"method_tuples": [list(EF_GW)]}}}), encoding="utf-8")
    monkeypatch.setattr(engine, "CACHE_ROOT", tmp_path)
    monkeypatch.setattr(engine, "_load_registry", lambda: [])
    monkeypatch.setattr(bw2data, "methods", {EF_GW: {"unit": "u", "filename": "LCIA_Implementation_3.9.xlsx"}})
    monkeypatch.setattr(mp, "registered_metadata", mp._registered_metadata)
    monkeypatch.setattr(mp, "library_sources", mp._library_sources)
    assert mp.describe_methods([EF_GW]).categories[0].source == EF_SOURCE


def test_no_user_facing_text_carries_a_dash_pair_or_em_dash():
    texts = [mp.LABEL, mp.SHEET, mp.NOTE, *mp.COLUMNS, mp.UNKNOWN_NOT_IN_PROJECT, mp.UNKNOWN_NO_SOURCE,
             mp.BW2IO_BUNDLED, EF_SOURCE]
    assert not [t for t in texts if "—" in t or "--" in t]


# ── Guard: no result workbook ships without the method ──────────────────────

#: Workbooks that report no impact value. Kept identical to the coverage
#: guard's list (tests/test_coverage_export.py), which a test below checks.
EXEMPT = {
    ("aesa.py", "_build_sharing_workbook"),
    ("bom.py", "_build_export_workbook"),
    ("bom.py", "_build_multi_export_workbook"),
    ("dsm.py", "_build_export_workbook"),
    ("parameters.py", "_build_workbook"),
    ("subsystems.py", "_build_subsystem_dsm_workbook"),
}


def _builders():
    for path in sorted((BACKEND / "api").glob("*.py")):
        for node in ast.parse(path.read_text(encoding="utf-8")).body:
            if isinstance(node, ast.FunctionDef) and node.name.startswith("_build") and node.name.endswith("workbook"):
                yield path.name, node


def _called(fn) -> set[str]:
    return {n.func.id if isinstance(n.func, ast.Name) else getattr(n.func, "attr", "")
            for n in ast.walk(fn) if isinstance(n, ast.Call)}


def test_every_result_workbook_names_its_impact_method():
    missing = [f"{f}:{fn.name} ({', '.join(sorted({'add_method_sheet', 'meta_row'} - _called(fn)))})"
               for f, fn in _builders()
               if (f, fn.name) not in EXEMPT and not {"add_method_sheet", "meta_row"} <= _called(fn)]
    assert missing == [], "result workbooks without the impact assessment method: " + "; ".join(missing)


def test_the_exemptions_match_the_coverage_guard():
    tree = ast.parse((Path(__file__).parent / "test_coverage_export.py").read_text(encoding="utf-8"))
    node = next(n for n in tree.body if isinstance(n, ast.Assign) and getattr(n.targets[0], "id", "") == "EXEMPT")
    assert set(ast.literal_eval(node.value)) == EXEMPT


def test_the_guard_sees_every_builder_this_file_drives():
    found = {(f, fn.name) for f, fn in _builders()}
    assert EXEMPT <= found, f"stale exemptions: {EXEMPT - found}"
    assert len(found - EXEMPT) == len(MULTI_METHOD_BUILDERS) + len(SINGLE_METHOD_BUILDERS)
