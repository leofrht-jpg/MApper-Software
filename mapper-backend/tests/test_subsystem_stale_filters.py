# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""A subsystem filter that references something gone, versus one that matches
nothing. They are not the same thing and they do not get the same answer.

`filter_primary_stock` summed to 0.0 for both. One of those is ordinary — a
fuel type with no vehicles yet in 2025 — and must stay silent, or a sparse
fleet becomes unrunnable. The other cannot match in ANY year, and 0.0 reads as
"this subsystem has no stock" when the reference is simply broken.

And separately, an EMPTY value list was dropped, which made the filter mean
"no filter" and handed the rule the WHOLE primary stock. That one OVER-counts,
the opposite direction from every other defect in this family, and it was
saveable — measured 350.0 against an intended 150.0 on a 350-unit fleet.

Neither is a `continue`, which is why the first class guard found nothing here.
"""
from __future__ import annotations

import pytest

from mapper.core.subsystem_engine import (
    StaleDriverFilterError,
    filter_primary_stock,
    validate_dependency_rule,
)
from mapper.models.dsm_schemas import DimensionDef, YearResult
from mapper.models.subsystem_schemas import DependencyRule


def _dims() -> list[DimensionDef]:
    return [
        # "phev" is declared and carries no stock -> the legitimate empty match.
        DimensionDef(name="Fuel", display_name="Fuel", labels=["BEV", "ICEV", "PHEV"]),
        DimensionDef(name="Size", display_name="Size", labels=["Small", "Large"]),
    ]


def _yr() -> YearResult:
    return YearResult(
        year=2030,
        stock={"BEV|Small": 100.0, "BEV|Large": 50.0, "ICEV|Small": 200.0},
        stock_by_age={}, inflow={}, outflow={}, outflow_by_age={},
    )


def _rule(df: dict) -> DependencyRule:
    return DependencyRule(id="r1", dependent_archetype_id="a1",
                          expression="filtered_stock * 0.1", driver_filter=df)


# ── the distinction, which is the whole design ───────────────────────────────


def test_a_legitimately_empty_match_returns_zero_and_does_NOT_raise():
    """THE load-bearing case. A declared label carrying no stock is ordinary."""
    assert filter_primary_stock(_yr(), {"Fuel": ["PHEV"]}, _dims()) == 0.0


def test_an_empty_match_across_two_real_dimensions_also_stays_silent():
    assert filter_primary_stock(
        _yr(), {"Fuel": ["PHEV"], "Size": ["Large"]}, _dims()) == 0.0


def test_a_stale_DIMENSION_raises_and_names_the_rename():
    with pytest.raises(StaleDriverFilterError) as e:
        filter_primary_stock(_yr(), {"Powertrain": ["BEV"]}, _dims())
    msg = str(e.value)
    assert "Powertrain" in msg                      # names the missing dim
    assert "Fuel" in msg and "Size" in msg          # and what IS available
    assert "renamed" in msg                         # and the likely cause


def test_a_stale_LABEL_raises_and_names_the_declared_set():
    with pytest.raises(StaleDriverFilterError) as e:
        filter_primary_stock(_yr(), {"Fuel": ["Hydrogen"]}, _dims())
    msg = str(e.value)
    assert "Hydrogen" in msg
    assert "BEV" in msg and "PHEV" in msg


def test_valid_filters_are_unchanged():
    assert filter_primary_stock(_yr(), {}, _dims()) == 350.0
    assert filter_primary_stock(_yr(), {"Fuel": ["BEV"]}, _dims()) == 150.0
    assert filter_primary_stock(
        _yr(), {"Fuel": ["BEV"], "Size": ["Small"]}, _dims()) == 100.0


# ── A: the empty value list, refused at the WRITE boundary ───────────────────


def test_an_empty_value_list_is_refused_at_save():
    errors = validate_dependency_rule(_rule({"Fuel": []}), _dims())
    assert errors
    joined = " ".join(errors)
    assert "no values" in joined
    assert "whole primary stock" in joined          # says WHAT goes wrong
    assert "remove the key" in joined               # and how to say it properly


def test_a_valid_filter_still_saves():
    assert validate_dependency_rule(_rule({"Fuel": ["BEV"]}), _dims()) == []


def test_the_over_count_is_still_DEFINED_for_rules_stored_before_the_check():
    """Refused at save, so this branch is reachable only for existing data --
    and its behaviour has to stay defined rather than change under them."""
    assert filter_primary_stock(_yr(), {"Fuel": []}, _dims()) == 350.0


def test_the_over_count_is_the_measured_shape():
    """350 where 150 was intended: it OVER-counts, which is the opposite
    direction from every other defect in this family."""
    intended = filter_primary_stock(_yr(), {"Fuel": ["BEV"]}, _dims())
    got = filter_primary_stock(_yr(), {"Fuel": []}, _dims())
    assert got > intended
    assert got == pytest.approx(350.0) and intended == pytest.approx(150.0)


# ── C: the migration, which fixes the cause ──────────────────────────────────


def test_the_migration_translates_a_renamed_label():
    from mapper.api.dsm import _migrate_subsystem_filters
    from mapper.api import subsystems as _subs

    sub = _make_sub({"Fuel": ["BEV", "ICEV"]})
    with _installed(_subs, "sys1", sub):
        w = _migrate_subsystem_filters(
            "p", "sys1", {"Fuel": {"BEV": "Battery-electric", "ICEV": "ICEV"}}, [])
    assert sub.dependency_rules[0].driver_filter == {"Fuel": ["Battery-electric", "ICEV"]}
    assert any("Translated" in m for m in w)


def test_the_migration_drops_a_removed_label_and_warns():
    from mapper.api.dsm import _migrate_subsystem_filters
    from mapper.api import subsystems as _subs

    sub = _make_sub({"Fuel": ["BEV", "ICEV"]})
    with _installed(_subs, "sys1", sub):
        w = _migrate_subsystem_filters("p", "sys1", {"Fuel": {"BEV": None, "ICEV": "ICEV"}}, [])
    assert sub.dependency_rules[0].driver_filter == {"Fuel": ["ICEV"]}
    assert any("removed labels" in m for m in w)


def test_the_migration_drops_a_removed_dimension_and_warns():
    from mapper.api.dsm import _migrate_subsystem_filters
    from mapper.api import subsystems as _subs

    sub = _make_sub({"Fuel": ["BEV"], "Size": ["Small"]})
    with _installed(_subs, "sys1", sub):
        w = _migrate_subsystem_filters("p", "sys1", {"Size": {"Small": "Small"}}, ["Fuel"])
    assert sub.dependency_rules[0].driver_filter == {"Size": ["Small"]}
    assert any("removed dimensions" in m for m in w)


def test_the_migration_leaves_an_untouched_filter_alone_and_warns_nothing():
    from mapper.api.dsm import _migrate_subsystem_filters
    from mapper.api import subsystems as _subs

    sub = _make_sub({"Fuel": ["BEV"]})
    with _installed(_subs, "sys1", sub):
        w = _migrate_subsystem_filters("p", "sys1", {"Fuel": {"BEV": "BEV"}}, [])
    assert sub.dependency_rules[0].driver_filter == {"Fuel": ["BEV"]}
    assert w == []


def test_migration_then_compute_no_longer_raises():
    """End to end: the rename that used to orphan a rule now carries it."""
    from mapper.api.dsm import _migrate_subsystem_filters
    from mapper.api import subsystems as _subs

    sub = _make_sub({"Fuel": ["BEV"]})
    renamed = [DimensionDef(name="Fuel", display_name="Fuel",
                            labels=["Battery-electric", "ICEV", "PHEV"]),
               DimensionDef(name="Size", display_name="Size", labels=["Small", "Large"])]
    yr = YearResult(year=2030, stock={"Battery-electric|Small": 100.0},
                    stock_by_age={}, inflow={}, outflow={}, outflow_by_age={})

    # before the migration the stale label refuses
    with pytest.raises(StaleDriverFilterError):
        filter_primary_stock(yr, sub.dependency_rules[0].driver_filter, renamed)

    with _installed(_subs, "sys1", sub):
        _migrate_subsystem_filters("p", "sys1", {"Fuel": {"BEV": "Battery-electric"}}, [])
    assert filter_primary_stock(
        yr, sub.dependency_rules[0].driver_filter, renamed) == 100.0


# ── helpers ──────────────────────────────────────────────────────────────────

import contextlib  # noqa: E402

from mapper.models.subsystem_schemas import Subsystem  # noqa: E402


def _make_sub(df: dict) -> Subsystem:
    return Subsystem(
        id="sub1", name="Fueling Infrastructure", type="dependent",
        dependency_rules=[_rule(df)],
    )


@contextlib.contextmanager
def _installed(mod, system_id: str, sub: Subsystem):
    """Put one subsystem in the registry and persist to a temp dir."""
    from unittest import mock

    with mock.patch.object(mod, "get_subsystems_for_system",
                           return_value={sub.id: sub}), \
         mock.patch("mapper.core.dsm_storage.save_subsystems"):
        yield
