# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""A system-level prospective run with a mapper-tailpipe row.

Reported: two WARNING lines per year, "_rewrite_db(year=...): Activity
mapper-tailpipe/<id> not found in ...premise_remind_ssp1-base_<year>; fell back
to source database for this key."

Keeping the tailpipe row on its own database is CORRECT -- premise generates
no variant of mapper-tailpipe, whose activities hold only biosphere exchanges
(core/prospective_links.py, rule 2: pinned silently). The warning appeared
because the pipeline never learned its base database:

  * the UI sends the base inside each LCI scenario, never as body.base_db, so
    ``fallback_base_db`` was None; and
  * the registry fallback read ``prospective_dbs[0].get("name")`` while
    ``prospective_dbs`` is a list of ``(name, year)`` TUPLES -- always None.

With no base the shared rule degrades to the existence probe, and a tailpipe
code is (correctly) absent from every premise database -> "fell back" warning.
These tests drive ``ProjectedDSMLCAPipeline.calculate`` with the real tuple
shape and the real registry lookup (``plca_storage``), and pin: no warning, one
INFO line per run with the count, and a genuine base-db gap still warns.
"""
from __future__ import annotations

import logging

import pytest

from mapper.core import plca_storage
from mapper.core.dsm_lca_engine import ProjectedDSMLCAPipeline
from mapper.models.bom_schemas import Archetype, BOMNode, EcoinventLink
from mapper.models.dsm_schemas import SimulationResult, SimulationSummary, YearResult

METHOD = ("EF v3.1", "climate change", "GWP100")
BASE = "ecoinvent-3.10-cutoff"
YEARS = (2025, 2030, 2035, 2040, 2045, 2050)
PROSPECTIVE = [(f"{BASE}_premise_remind_ssp1-base_{y}", y) for y in YEARS]
TAILPIPE = [("mapper-tailpipe", "6475855161f625ab7df55cdeb918d9d1"),
            ("mapper-tailpipe", "64553920f5dca3689839839354eae084")]


def _archetype(missing_base_code: bool = False) -> Archetype:
    mats = [BOMNode(id="steel", name="steel", node_type="material", quantity=1.0, unit="kg",
                    ecoinvent_activity=EcoinventLink(database=BASE, code="steel", name="steel"))]
    if missing_base_code:
        mats.append(BOMNode(id="gone", name="gone", node_type="material", quantity=1.0, unit="kg",
                            ecoinvent_activity=EcoinventLink(database=BASE, code="gone", name="gone")))
    use = [BOMNode(id=f"tp{i}", name=f"combustion {i}", node_type="material", quantity=1.0,
                   unit="kg", ecoinvent_activity=EcoinventLink(database=db, code=code, name="tp"))
           for i, (db, code) in enumerate(TAILPIPE)]
    return Archetype(id="ev", name="Car", bom=[
        BOMNode(id="m", name="Manufacturing", node_type="component", quantity=1.0,
                unit="piece", scope="inflows", children=mats),
        BOMNode(id="u", name="Use Phase", node_type="component", quantity=1.0,
                unit="piece", scope="stock", children=use),
    ])


def _sim() -> SimulationResult:
    return SimulationResult(
        system_id="sys", years=[YearResult(year=y, stock={"ev": 1.0}, stock_by_age={},
                                           inflow={"ev": 1.0}, outflow={}, outflow_by_age={})
                                for y in range(2025, 2051)],
        summary=SimulationSummary(total_stock_start=1.0, total_stock_end=1.0,
                                  total_inflows=26.0, total_outflows=0.0),
    )


def _runner(demand, methods):
    return {tuple(m): (sum(demand.values()), "kg CO2-eq") for m in methods}


def _pipeline(monkeypatch, *, temporal_mode="interpolate", missing_base_code=False, fallback=None):
    # The real registry lookup, fed the real registry shape.
    monkeypatch.setattr(plca_storage, "load_registry", lambda project: [
        {"name": name, "year": y, "base_db": BASE, "iam": "remind", "ssp": "SSP1-Base"}
        for name, y in PROSPECTIVE
    ])
    pipe = ProjectedDSMLCAPipeline(
        simulation_result=_sim(), archetypes={"ev": _archetype(missing_base_code)},
        cohort_mappings={"ev": ("ev", 1.0)}, methods=[METHOD], lca_runner=_runner,
        prospective_dbs=PROSPECTIVE, fallback_base_db=fallback, temporal_mode=temporal_mode,
    )
    # What the real premise databases hold: every ecoinvent code carries over
    # (premise preserves codes), no mapper-tailpipe code does, "gone" was dropped.
    pipe._activity_exists = lambda db, code: not (code == "gone" or any(code == c for _, c in TAILPIPE))
    return pipe


@pytest.mark.parametrize("temporal_mode", ["interpolate", "block"])
def test_tailpipe_links_are_pinned_without_a_warning(monkeypatch, caplog, temporal_mode):
    pipe = _pipeline(monkeypatch, temporal_mode=temporal_mode)
    with caplog.at_level(logging.INFO, logger="mapper.core.dsm_lca_engine"):
        pipe.calculate("all")
    warnings = [r for r in caplog.records if r.levelno >= logging.WARNING and "mapper-tailpipe" in r.getMessage()]
    assert warnings == [], [r.getMessage() for r in warnings]
    assert pipe._link_warnings == []


def test_one_info_line_per_run_with_the_count(monkeypatch, caplog):
    pipe = _pipeline(monkeypatch)
    with caplog.at_level(logging.INFO, logger="mapper.core.dsm_lca_engine"):
        pipe.calculate("all")
        pipe.calculate("stock")          # a second scope in the same run
    infos = [r.getMessage() for r in caplog.records
             if r.levelno == logging.INFO and "kept their own database" in r.getMessage()]
    assert infos == [
        "Prospective run: 2 link(s) from non-base databases kept their own database "
        "in every year (mapper-tailpipe: 2); premise generates no variant of them."
    ]


def test_the_base_is_read_from_the_tuple_shaped_list(monkeypatch):
    pipe = _pipeline(monkeypatch)
    assert pipe._prospective_base_db() == BASE


def test_a_real_base_db_gap_still_warns(monkeypatch, caplog):
    # A base-db code premise did NOT carry over is a real gap -- not hidden.
    pipe = _pipeline(monkeypatch, missing_base_code=True)
    with caplog.at_level(logging.WARNING, logger="mapper.core.dsm_lca_engine"):
        pipe.calculate("inflows")
    msgs = [r.getMessage() for r in caplog.records if r.levelno >= logging.WARNING]
    assert any(f"{BASE}/gone not found in" in m for m in msgs)
    assert not any("mapper-tailpipe" in m for m in msgs)


def test_the_route_hands_each_scenario_its_own_base(monkeypatch):
    # The UI never sets body.base_db; the base travels in lci_scenarios.
    import inspect

    from mapper.api import impact

    src = inspect.getsource(impact)
    assert "fallback_base_db=body.base_db or (scenario.base_db if scenario else None)" in src


def test_premise_does_not_silence_mappers_own_loggers():
    # premise's dictConfig at import disables every pre-existing logger; the
    # app must undo that for its own, or the summary above (and every
    # mapper.* warning) never reaches mapper.log.
    import mapper.main  # noqa: F401  -- imports premise via the routers
    from mapper.core import dsm_lca_engine

    assert not dsm_lca_engine._log.disabled
    import logging
    disabled = [n for n, lg in logging.root.manager.loggerDict.items()
                if n.startswith("mapper") and isinstance(lg, logging.Logger) and lg.disabled]
    assert disabled == []
