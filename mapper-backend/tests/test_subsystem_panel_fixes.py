# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Subsystem panel fixes.

FIX 1 — "Subsystem not found" 404. Root cause is NOT a schema-validation
failure (old records missing mode / manual_inflows / manual_outflows parse fine
via defaults — asserted here as a backward-compat guard). It is a project-state
desync: after a backend restart bw2 resets to ``default`` while the user is on
another project, so ``_current_project()``-scoped subsystem/system lookups miss
and 404. ``_reconcile_project_from_header`` honors the client's declared
``X-Mapper-Project`` (validated against known projects) so the whole subsystem
surface operates on the project the user is actually viewing.

FIX 2 — the initial-stock template must download as ``initial_stock_template.xlsx``
(static, no UUID / system_id / timestamp).
"""
from __future__ import annotations

import asyncio
from unittest.mock import MagicMock, patch

from mapper.api import dsm as dsm_api
from mapper.api import subsystems as sub_api
from mapper.models.dsm_schemas import DimensionDef, SystemDefinition, TimeHorizon
from mapper.models.subsystem_schemas import Subsystem


# ── FIX 1a — backward-compat: old records parse with defaults ───────────────


def test_old_subsystem_record_parses_with_defaults():
    """A record persisted BEFORE the mode / manual_inflows / manual_outflows
    fields existed must still deserialize (defaults kick in) — no crash, no
    silent skip in the loader."""
    old = {
        "id": "sub1", "name": "Chargers", "type": "dependent", "depends_on": "sys1",
        "dimensions": [{"name": "c", "display_name": "C", "labels": ["a", "b"]}],
        "dependency_rules": [],
    }
    sub = Subsystem(**old)
    assert sub.mode == "rules"
    assert sub.manual_inflows == {}
    assert sub.manual_outflows == {}


# ── FIX 1b — the reconciliation dependency (pure) ───────────────────────────


class _FakeProject:
    def __init__(self, name: str) -> None:
        self.name = name


class _FakeProjects:
    """Stand-in for ``bw2data.projects`` — ``.current``, iteration over known
    projects, and a ``.set_current`` spy."""

    def __init__(self, current: str, names: list[str]) -> None:
        self.current = current
        self._names = names
        self.set_current = MagicMock(side_effect=self._set)

    def _set(self, name: str) -> None:
        self.current = name

    def __iter__(self):
        return iter(_FakeProject(n) for n in self._names)


def _run_reconcile(header, current, names):
    fake = _FakeProjects(current, names)
    with patch.object(sub_api.bw2data, "projects", fake):
        sub_api._reconcile_project_from_header(x_mapper_project=header)
    return fake


def test_reconcile_switches_to_client_project_when_different_and_known():
    # The exact desync: bw2 on 'default', client declares 'MAp-test'.
    fake = _run_reconcile("MAp-test", current="default", names=["default", "MAp-test"])
    fake.set_current.assert_called_once_with("MAp-test")
    assert fake.current == "MAp-test"


def test_reconcile_noop_when_header_matches_current():
    fake = _run_reconcile("MAp-test", current="MAp-test", names=["default", "MAp-test"])
    fake.set_current.assert_not_called()


def test_reconcile_noop_when_header_absent_or_empty():
    for header in (None, "", "   "):
        fake = _run_reconcile(header, current="default", names=["default", "MAp-test"])
        fake.set_current.assert_not_called()


def test_reconcile_noop_when_header_project_unknown():
    # A bogus / typo'd project is not honored (would just 404 as before).
    fake = _run_reconcile("Ghost", current="default", names=["default", "MAp-test"])
    fake.set_current.assert_not_called()
    assert fake.current == "default"


def test_reconcile_never_raises_if_projects_iteration_fails():
    class _Broken:
        current = "default"
        set_current = MagicMock()

        def __iter__(self):
            raise RuntimeError("bw2 not ready")

    fake = _Broken()
    with patch.object(sub_api.bw2data, "projects", fake):
        sub_api._reconcile_project_from_header(x_mapper_project="MAp-test")
    fake.set_current.assert_not_called()


# ── FIX 1c — end-to-end lookup resolves under the reconciled project ────────


def test_get_subsystem_resolves_after_header_reconciliation():
    """Store a subsystem under project 'ProjA', put bw2 on 'ProjB', reconcile
    to 'ProjA' via the header, then the handler's ``_current_project()``-scoped
    lookup finds it (no 404)."""
    sys_id, sub_id = "sys-reco", "sub-reco"
    primary = SystemDefinition(
        id=sys_id, name="Fleet",
        time_horizon=TimeHorizon(start_year=2025, end_year=2030),
        dimensions=[DimensionDef(name="c", display_name="C", labels=["a"])],
    )
    sub = Subsystem(id=sub_id, name="Chargers", type="dependent", depends_on=sys_id,
                    dimensions=[DimensionDef(name="c", display_name="C", labels=["a"])],
                    dependency_rules=[])
    # Populate the per-project in-memory stores directly (as hydrate_from_disk does).
    dsm_api._proj_systems("ProjA")[sys_id] = primary
    sub_api._sys_subs(sys_id, "ProjA")[sub_id] = sub
    fake = _FakeProjects(current="ProjB", names=["ProjB", "ProjA"])
    try:
        with patch.object(sub_api.bw2data, "projects", fake):
            # Reconcile (router dependency runs before the handler).
            sub_api._reconcile_project_from_header(x_mapper_project="ProjA")
            assert fake.current == "ProjA"
            # Now the handler's current-project-scoped lookup resolves the sub.
            result = asyncio.run(sub_api.get_subsystem(sys_id, sub_id))
            assert result.id == sub_id
    finally:
        dsm_api._proj_systems("ProjA").pop(sys_id, None)
        sub_api._proj_subs("ProjA").pop(sys_id, None)


# ── FIX 2 — initial-stock template filename ─────────────────────────────────


def test_initial_stock_template_filename_no_uuid():
    sys_id, sub_id = "sys-tmpl", "sub-tmpl"
    primary = SystemDefinition(
        id=sys_id, name="Fleet",
        time_horizon=TimeHorizon(start_year=2025, end_year=2030),
        dimensions=[DimensionDef(name="c", display_name="C", labels=["a"])],
    )
    sub = Subsystem(id=sub_id, name="Fueling Infrastructure", type="dependent", depends_on=sys_id,
                    dimensions=[DimensionDef(name="station", display_name="Station", labels=["Default", "Large"])],
                    dependency_rules=[])
    dsm_api._proj_systems()[sys_id] = primary
    sub_api._sys_subs(sys_id)[sub_id] = sub
    try:
        resp = asyncio.run(sub_api.template_subsystem_stock(sys_id, sub_id))
        cd = resp.headers["content-disposition"]
        assert cd == 'attachment; filename="initial_stock_template.xlsx"'
        assert sub_id not in cd and "670be0bf" not in cd
    finally:
        dsm_api._proj_systems().pop(sys_id, None)
        sub_api._sys_subs(sys_id).pop(sub_id, None)
