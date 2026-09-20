# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Which indicators a result cannot speak for, because an input was partial.

An authored activity declares its inventory scope. "Partial" means only the
listed flows were specified: a CO2-only boiler says nothing about its NOx, and
its acidification score is not small, it is UNKNOWN. A result that links such
an activity therefore carries, per indicator the activity does not
characterise, a "not specified" gap naming the activity.

This is an ANNOTATION. It is computed from the links a run used and the
characterisation index, never from a solve, so it cannot change a number --
and a "complete" activity never produces a gap, because there a missing flow
really is zero.

An indicator is SPECIFIED when (a) a listed flow has a factor under the method
(0 included: the method has spoken) AND (b) the author declared the partial
inventory complete for it (``complete_indicators``). A factor means a flow
contributes, not that the listed flows suffice; only the author knows that, so
(b) is required and defaults to "not declared". (a) is the floor: the
declaration can narrow what counts as specified, never widen it.
"""
from __future__ import annotations

import logging
from typing import Iterable

from mapper.models.authored_schemas import AuthoredActivity, CoverageGap

log = logging.getLogger(__name__)

Key = tuple[str, str]


def _root_keys(roots: Iterable) -> set[Key]:
    keys: set[Key] = set()

    def walk(node):
        link = getattr(node, "ecoinvent_activity", None)
        if link is not None:
            keys.add((link.database, link.code))
        for child in getattr(node, "children", None) or []:
            walk(child)

    for root in roots:
        walk(root)
    return keys


def link_keys(archetypes: Iterable) -> set[Key]:
    """Every ``(database, code)`` a BOM row links, over already-spliced trees."""
    return _root_keys(r for arc in archetypes for r in (getattr(arc, "bom", None) or []))


def fleet_link_keys(archetypes: dict, archetype_ids: Iterable[str], scope: str) -> set[Key]:
    """Keys a FLEET run over ``archetype_ids`` uses at ``scope``.

    Spliced, and filtered by ``stage_to_scope`` -- the same classification the
    fleet uses to decide when a stage is counted -- so a partial activity in a
    stage outside the scope does not mark the result. A composition error is
    left to the pipeline, which reports it loudly; here the archetype's own rows
    are still walked.
    """
    from mapper.core.bom_engine import splice_includes, stage_to_scope

    roots = []
    for aid in sorted(set(archetype_ids)):
        arc = archetypes.get(aid)
        if arc is None:
            continue
        try:
            arc = splice_includes(arc, archetypes)
        except Exception:  # noqa: BLE001 - the pipeline raises this itself
            pass
        roots.extend(r for r in arc.bom
                     if scope == "all" or stage_to_scope(r.name, getattr(r, "scope", None)) == scope)
    return _root_keys(roots)


def partial_activities(defs) -> dict[Key, AuthoredActivity]:
    return {(db.name, a.code): a for db in defs.databases for a in db.activities if a.scope == "partial"}


def reached(flow_keys: Iterable[Key], cf_index: dict) -> set[tuple[str, ...]]:
    """Method tuples at least one of these flows has a factor under (0 included)."""
    out: set[tuple[str, ...]] = set()
    for key in flow_keys:
        for m, _cf in cf_index.get(tuple(key), ()):
            out.add(tuple(m))
    return out


def gaps(keys: Iterable[Key], methods: Iterable[Iterable[str]],
         partial: dict[Key, AuthoredActivity], cf_index: dict) -> list[CoverageGap]:
    """Pure: one gap per (method, partial activity) not SPECIFIED.

    Specified = reached by a listed flow AND declared complete by the author.
    The reach test is re-applied here, not trusted from save time: a tick whose
    reach was lost since (a method reinstalled with other factors) is a
    ``not_reached`` gap, never "specified". Ordered by the methods as given,
    then by activity key.
    """
    linked = sorted(k for k in set(keys) if k in partial)
    reach = {k: reached(((ex.flow.database, ex.flow.code) for ex in partial[k].exchanges), cf_index)
             for k in linked}
    ticked = {k: {tuple(m) for m in partial[k].complete_indicators} for k in linked}
    out: list[CoverageGap] = []
    for m in methods:
        mt = tuple(m)
        for k in linked:
            if mt in reach[k] and mt in ticked[k]:
                continue
            act = partial[k]
            out.append(CoverageGap(
                method=list(mt), database=k[0], code=k[1],
                activity_name=act.name, scope_note=act.scope_note or "",
                kind="not_declared" if mt in reach[k] else "not_reached",
            ))
    return out


def uncertainty_notes(keys: Iterable[Key], project: str) -> list:
    """Every authored exchange the run used, with the basis of its uncertainty.

    Both bases are listed, not just ``supplied``: a sheet that only names the
    exceptions leaves the reader to assume the rest are ecoinvent-referenced,
    which is the same silence the coverage statement exists to avoid. Never
    raises -- an annotation must not fail a run.
    """
    from mapper.models.authored_schemas import AuthoredUncertainty

    try:
        from mapper.core import authored_storage

        defs = authored_storage.load_definitions(project)
        by_key = {(db.name, a.code): a for db in defs.databases for a in db.activities}
        out = []
        for k in sorted({tuple(x) for x in keys} & by_key.keys()):
            act = by_key[k]
            for ex in act.exchanges:
                out.append(AuthoredUncertainty(
                    database=k[0], code=k[1], activity_name=act.name,
                    flow_name=ex.flow.name, flow_categories=list(ex.flow.categories),
                    basic_variance=ex.basic_variance, gsd2=ex.gsd2,
                    basis=ex.uncertainty_basis,
                    detail=(ex.floor_detail if ex.uncertainty_basis == "supplied"
                            else f"{ex.floor_status}: {ex.floor_detail}"),
                ))
        return out
    except Exception as exc:  # noqa: BLE001
        log.warning("Authored-exchange uncertainty notes unavailable: %s", exc)
        return []


def coverage_gaps(keys: Iterable[Key], methods: Iterable[Iterable[str]],
                  project: str) -> tuple[list[CoverageGap], str | None]:
    """Gaps for a run that computed demand on ``keys`` under ``methods``.

    ``keys`` are the ``(database, code)`` pairs the run ACTUALLY used, so a
    partial activity that sits only in a stage outside the run's scope does not
    mark it. Returns ``(gaps, warning)``. Never raises: a failure is reported as
    a warning for the result to carry, because an ABSENT caveat reads exactly
    like "no gaps" -- it must not disappear in silence.
    """
    try:
        from mapper.core import authored_storage

        defs = authored_storage.load_definitions(project)
        partial = partial_activities(defs)
        if not partial:
            return [], None
        keys = {tuple(k) for k in keys} & partial.keys()
        if not keys:
            return [], None  # fast path: the index is never built
        import bw2data as bd

        from mapper.core.flow_characterisation import characterisation_index

        methods = [tuple(m) for m in methods]
        return gaps(keys, methods, partial, characterisation_index(bd)), None
    except Exception as exc:  # noqa: BLE001 - an annotation must never fail a run
        log.warning("Authored-activity coverage could not be checked: %s", exc)
        return [], ("Coverage of partial authored activities could not be checked "
                    f"({exc}); indicators they do not characterise are NOT marked.")
