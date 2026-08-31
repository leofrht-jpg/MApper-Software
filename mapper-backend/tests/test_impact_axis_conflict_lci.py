"""``lci_scenarios`` is an AXIS and counts toward the axisConflict rule.

``post_calculate_scenarios`` computed ``multi_axes`` over three axes and left
multi-LCI out, under a comment saying ``post_calculate`` rejected it alongside
a fan-out parent. It does not, and never did -- grepping every
``lci_scenarios`` reference in ``post_calculate`` finds only

    multi_lci_mode = mode == "projected" and len(lci_scenarios_list) > 1

and no rejection anywhere. So 3 sensitivity cases x 3 LCI scenarios launched
NINE fleet runs while the validator counted one axis. There is no numeric cap
in the codebase to catch it further downstream.

Multi-LCI runs sequentially inside a single task, which is why it looked
"in-task" rather than "fan-out" -- but sequential is not free, and the rule
exists to stop the multiplication, not the parallelism.
"""
from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from mapper.api import impact as impact_api
from mapper.models.bom_schemas import ImpactAssessmentRequest, ProspectiveScenarioRef


def _sc(ssp: str) -> ProspectiveScenarioRef:
    return ProspectiveScenarioRef(
        base_db="ecoinvent-3.10-cutoff", iam="remind", ssp=ssp,
    )


def _req(**kw) -> ImpactAssessmentRequest:
    base = dict(
        mfa_system_id="sys-1",
        methods=[["EF v3.1", "climate change", "GWP100"]],
        mode="projected",
    )
    base.update(kw)
    return ImpactAssessmentRequest(**base)


def _run(body):
    return asyncio.run(impact_api.post_calculate_scenarios(body))


def test_multi_lci_plus_multi_parameter_is_rejected():
    body = _req(
        scenarios=["Base", "Optimistic", "Pessimistic"],
        lci_scenarios=[_sc("SSP1-PkBudg1150"), _sc("SSP2-PkBudg1150"), _sc("SSP5-PkBudg1150")],
    )
    with pytest.raises(HTTPException) as e:
        _run(body)
    assert e.value.status_code == 400
    assert "one axis at a time" in e.value.detail
    assert "LCI" in e.value.detail


def test_multi_lci_plus_multi_dsm_is_rejected():
    body = _req(
        dsm_scenario_ids=["s1", "s2"],
        lci_scenarios=[_sc("SSP1-PkBudg1150"), _sc("SSP2-PkBudg1150")],
    )
    with pytest.raises(HTTPException) as e:
        _run(body)
    assert e.value.status_code == 400
    assert "one axis at a time" in e.value.detail


def test_a_SINGLE_lci_scenario_is_not_an_axis():
    """One LCI scenario is a coordinate, not a fan-out.

    It must not conflict with a parameter sweep -- that is the ordinary
    "compare three cases against one prospective background" run, and
    breaking it would be a worse regression than the one being fixed.
    So the rejection must fire on ``len(...) > 1``, never on presence.
    """
    body = _req(
        scenarios=["Base", "Optimistic"],
        lci_scenarios=[_sc("SSP2-PkBudg1150")],
    )
    try:
        _run(body)
    except HTTPException as e:
        assert "one axis at a time" not in (e.detail if isinstance(e.detail, str) else ""), (
            "a single LCI scenario was miscounted as a fan-out axis"
        )


def test_multi_lci_alone_is_still_allowed():
    """Multi-LCI on its own is one axis and remains a supported run."""
    body = _req(lci_scenarios=[_sc("SSP1-PkBudg1150"), _sc("SSP2-PkBudg1150")])
    try:
        _run(body)
    except HTTPException as e:
        assert "one axis at a time" not in (e.detail if isinstance(e.detail, str) else "")


def test_the_false_claim_is_gone_from_the_source():
    """The comment and the docstring both asserted a guard in
    ``post_calculate`` that does not exist. A comment describing a
    protection nobody implemented is worse than no comment -- it is why
    the omission survived review."""
    import inspect

    src = inspect.getsource(impact_api)
    assert "already rejected by post_calculate" not in src
    assert "rejected by ``post_calculate``" not in src
