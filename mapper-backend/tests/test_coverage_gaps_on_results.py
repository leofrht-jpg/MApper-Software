# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""The 'not specified' annotation reaches every result, and moves no number.

Driven through the real handlers with the LCA solve stubbed: a product whose
Use Phase links a CO2-only boiler declared PARTIAL. Climate change is covered;
acidification is not, so it carries a gap naming the boiler -- unless the run's
scope excludes the Use Phase, in which case the boiler was never used.
"""
from __future__ import annotations

import ast
import asyncio
from pathlib import Path

import pytest

from mapper.core import authored_storage
from mapper.core import flow_characterisation as fc
from mapper.models.bom_schemas import Archetype, BOMNode, EcoinventLink

from tests.test_authored_coverage import AC, CF_INDEX, GW, _activity, _defs
from tests.test_authored_databases import CO2

BACKEND = Path(__file__).resolve().parents[1] / "mapper"
EI = "a" * 32


def _product(boiler_code: str) -> Archetype:
    def mat(name, db, code, unit="kilogram"):
        return BOMNode(id=f"n-{name}", name=name, node_type="material", quantity=2.0, unit=unit,
                       ecoinvent_activity=EcoinventLink(database=db, code=code, name=name, unit=unit))

    return Archetype(id="arc-cov", name="Heated product", bom=[
        BOMNode(id="s-mfg", name="Manufacturing", node_type="component", scope="inflows",
                children=[mat("Steel", "ecoinvent-3.10-cutoff", EI)]),
        BOMNode(id="s-use", name="Use Phase", node_type="component", scope="stock",
                children=[mat("Heat", "mine", boiler_code, "megajoule")]),
    ])


class _StubRunner:
    def __call__(self, demand, methods):
        return {tuple(mt): (sum(demand.values()), "kg") for mt in methods}


@pytest.fixture()
def boiler(monkeypatch):
    """A PARTIAL CO2-only boiler, saved under the current project."""
    import bw2data

    monkeypatch.setattr(fc, "characterisation_index", lambda bd: CF_INDEX)
    # CO2-only boiler: its author declares climate change complete (true for a
    # CO2-only stack) and nothing else.
    act = _activity([CO2], "partial", ticks=[GW])
    authored_storage.save_definitions(bw2data.projects.current, _defs(act))
    return act


def _single(monkeypatch, arc, scope="all"):
    from mapper.api import lca as lca_mod
    from mapper.models.schemas import ArchetypeLCACalculateRequest

    monkeypatch.setattr("mapper.api.bom._get_archetype", lambda _i: arc, raising=False)
    monkeypatch.setattr(lca_mod, "PersistentLCARunner", _StubRunner)
    return asyncio.run(lca_mod.calculate_archetype_lca(ArchetypeLCACalculateRequest(
        archetype_id=arc.id, methods=[list(GW), list(AC)], scope=scope)))


def test_single_product_marks_the_uncovered_indicator(monkeypatch, boiler):
    res = _single(monkeypatch, _product(boiler.code))
    assert [(tuple(g.method), g.activity_name) for g in res.coverage_gaps] == [(AC, "boiler")]
    assert res.coverage_gaps[0].scope_note.startswith("CO2 only")


def test_a_scope_that_excludes_the_activity_is_not_marked(monkeypatch, boiler):
    assert _single(monkeypatch, _product(boiler.code), scope="inflows").coverage_gaps == []


def test_the_annotation_moves_no_number(monkeypatch, boiler):
    """Same product, boiler declared partial vs complete: identical scores."""
    import bw2data

    partial = _single(monkeypatch, _product(boiler.code))
    complete = boiler.model_copy(update={"scope": "complete", "scope_note": None, "complete_indicators": []})
    authored_storage.save_definitions(bw2data.projects.current, _defs(complete))
    whole = _single(monkeypatch, _product(boiler.code))
    assert whole.coverage_gaps == [] and partial.coverage_gaps
    assert [r.score for r in partial.results] == [r.score for r in whole.results]
    assert partial.stage_breakdown == whole.stage_breakdown


# ── Fleet (the Static tab's dsm-lca route) ──────────────────────────────────

def _fleet(monkeypatch, arc, scope):
    import bw2data

    from mapper.api import bom, dsm
    from mapper.models.bom_schemas import CohortMapping, CohortMappingEntry, DSMLCARequest

    project = bw2data.projects.current
    monkeypatch.setattr(bom, "_get_system", lambda _i: object())
    monkeypatch.setitem(dsm._results, project, {"sys": object()})
    monkeypatch.setitem(bom._archetypes, project, {arc.id: arc})
    monkeypatch.setitem(bom._cohort_mappings, project, {"sys": CohortMapping(
        mfa_system_id="sys", mappings=[CohortMappingEntry(cohort_key="c", archetype_id=arc.id)])})
    monkeypatch.setitem(bom._dsm_lca_results, project, {})

    class _Pipeline:
        def __init__(self, **kw):
            pass

        def calculate(self, scope):
            return []

    monkeypatch.setattr(bom, "DSMLCAPipeline", _Pipeline)
    return asyncio.run(bom.run_dsm_lca("sys", DSMLCARequest(methods=[list(GW), list(AC)], scope=scope)))


def test_the_fleet_route_marks_the_uncovered_indicator(monkeypatch, boiler):
    res = _fleet(monkeypatch, _product(boiler.code), "all")
    assert [tuple(g.method) for g in res.coverage_gaps] == [AC]


def test_the_fleet_route_filters_by_scope_as_the_fleet_counts_it(monkeypatch, boiler):
    """Use Phase is counted in stock; an inflows run never used the boiler."""
    assert _fleet(monkeypatch, _product(boiler.code), "inflows").coverage_gaps == []
    assert [tuple(g.method) for g in _fleet(monkeypatch, _product(boiler.code), "stock").coverage_gaps] == [AC]


# ── AESA: mapped onto the PB axes with the SAME mapping compute uses ─────────

def test_aesa_gaps_carry_the_pb_the_method_feeds():
    from mapper.core.aesa_engine import aesa_coverage_gaps
    from mapper.models.aesa_schemas import MethodPBMapping
    from mapper.models.authored_schemas import CoverageGap

    gap = CoverageGap(method=list(AC), database="mine", code="x", activity_name="boiler")
    mapping = [MethodPBMapping(method_tuple=list(GW), pb_id="climate_change"),
               MethodPBMapping(method_tuple=list(AC), pb_id="acidification")]
    (out,) = aesa_coverage_gaps([gap], mapping)
    assert out.pb_id == "acidification" and out.activity_name == "boiler"
    assert aesa_coverage_gaps([gap], mapping[:1]) == [], "an unmapped method marks no axis"


def test_the_static_single_product_adapter_carries_the_gaps(monkeypatch, boiler):
    from mapper.core.aesa_engine import single_product_to_impact_result

    res = _single(monkeypatch, _product(boiler.code))
    adapted = single_product_to_impact_result(res, reference_year=2025)
    assert adapted.coverage_gaps == res.coverage_gaps


def test_compute_and_the_annotation_resolve_the_mapping_in_one_place():
    src = (BACKEND / "core" / "aesa_engine.py").read_text(encoding="utf-8")
    assert src.count("suggest_method_mapping(methods, boundary_set)") == 1
    assert "resolve_method_mapping(config, impact.results, bset)" in (BACKEND / "api" / "aesa.py").read_text(encoding="utf-8")


# ── Every result constructor passes the annotation ──────────────────────────

CARRIERS = {"ArchetypeLCACalculateResult", "ActivityLCAResult", "ContributionAnalysisResult", "MonteCarloResult", "ItemDistribution",
            "DSMLCABatchResult", "ImpactAssessmentResult"}


def test_every_result_constructor_passes_coverage_gaps():
    """A result built without the field reads as 'nothing unspecified'."""
    missing = []
    for path in sorted((BACKEND / "api").glob("*.py")) + sorted((BACKEND / "core").glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                    and node.func.id in CARRIERS
                    and not any(k.arg == "coverage_gaps" for k in node.keywords)):
                missing.append(f"{path.relative_to(BACKEND)}:{node.lineno} {node.func.id}")
    assert missing == [], "results built without coverage_gaps:\n" + "\n".join(missing)


def test_an_authored_activity_picked_directly_is_marked(monkeypatch, boiler):
    """Multi-item Activities mode: the partial inventory IS the result."""
    import bw2data

    from mapper.api import lca as lca_mod
    from mapper.models.schemas import ActivityLCARequest

    monkeypatch.setattr(lca_mod, "PersistentLCARunner", _StubRunner)
    monkeypatch.setattr(bw2data, "get_activity", lambda key: {"name": "boiler", "unit": "megajoule"})
    res = asyncio.run(lca_mod.calculate_activity_lca(ActivityLCARequest(
        activities=[{"database": "mine", "code": boiler.code, "amount": 1.0}],
        methods=[list(GW), list(AC)])))
    assert [tuple(g.method) for g in res.coverage_gaps] == [AC]


def _classes_declaring(field: str) -> set[str]:
    """Result classes that DECLARE ``field``, read from the models.

    Derived rather than hand-listed: adding the field to a seventh result must
    bring that result's call sites under the guard, not quietly skip them.
    """
    out = set()
    for path in sorted((BACKEND / "models").glob("*.py")):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.ClassDef) and any(
                    isinstance(b, ast.AnnAssign) and getattr(b.target, "id", "") == field
                    for b in node.body):
                out.add(node.name)
    return out


def _constructors_missing(classes: set[str], field: str) -> list[str]:
    missing = []
    for path in sorted((BACKEND / "api").glob("*.py")) + sorted((BACKEND / "core").glob("*.py")):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                    and node.func.id in classes
                    and not any(k.arg == field for k in node.keywords)):
                missing.append(f"{path.relative_to(BACKEND)}:{node.lineno} {node.func.id}")
    return missing


def test_every_result_constructor_passes_authored_uncertainty():
    """An empty list reads as 'no authored exchange was used', so a result that
    used one and omits the field says something false about its own numbers."""
    classes = _classes_declaring("authored_uncertainty")
    assert len(classes) == 6 and classes <= CARRIERS, classes
    # ContributionAnalysisResult is the carrier without the field: it reports no
    # uncertainty at all, so there is no GSD2 for a reader to compare.
    assert CARRIERS - classes == {"ContributionAnalysisResult"}
    missing = _constructors_missing(classes, "authored_uncertainty")
    assert missing == [], "results built without authored_uncertainty:\n" + "\n".join(missing)
