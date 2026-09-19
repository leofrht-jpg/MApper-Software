# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Which methods characterise a biosphere flow, and the compartment picker.

Biosphere flows that share a name differ only by compartment (Nitrogen oxides
has five), and the compartment can change a characterisation factor while
leaving every other factor identical: EF v3.1's particulate-matter factor for
NOx is 1.6e-6 in urban air and 2.1e-7 from high stacks. A compartment is also
not always characterised by the same methods -- NOx to "low population
density, long-term" is characterised by 88 method entries against 145-147 for
the other four. So the question a user choosing between five identical names is
really asking is "what do the methods do with each of these?", and this module
answers it.

The index maps a flow to every (method, factor) pair that characterises it,
over ALL installed methods: measured at 0.23 s to build for 819 methods and
~12 us per lookup. It is rebuilt when the installed method set changes (the
Method Library installs and uninstalls at runtime); each method's CF count and
registration id are the fingerprint.

``search_groups`` is pure -- flows, index, statistics in; groups out -- so it
is tested without Brightway.
"""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass

from mapper.models.flow_schemas import FlowCandidate, MethodRef, SubstanceGroup

DEFAULT_FAMILY = "EF v3.1"
BIOSPHERE = "biosphere"


@dataclass(frozen=True)
class Flow:
    database: str
    code: str
    name: str
    categories: tuple[str, ...]
    unit: str
    type: str


# ── Brightway wiring (cached) ──────────────────────────────────────────────

_index_cache: dict = {}
_flow_cache: dict = {}


def _methods_fingerprint(bd) -> tuple:
    out = []
    for m in bd.methods:
        meta = bd.methods[m]
        out.append((tuple(m), str(meta.get("num_cfs")), str(meta.get("abbreviation"))))
    return (bd.projects.current, tuple(sorted(out)))


def characterisation_index(bd) -> dict[tuple[str, str], list[tuple[tuple[str, ...], float]]]:
    """``(database, code) -> [(method, cf), ...]`` over all installed methods."""
    key = _methods_fingerprint(bd)
    hit = _index_cache.get(key)
    if hit is not None:
        return hit
    idx: dict = defaultdict(list)
    for m in bd.methods:
        for row in bd.Method(m).load():
            flow_key, cf = row[0], row[1]
            if isinstance(cf, dict):  # uncertain CF: the amount is the factor
                cf = cf.get("amount")
            if cf is None:
                continue
            idx[tuple(flow_key)].append((tuple(m), float(cf)))
    _index_cache.clear()
    _index_cache[key] = dict(idx)
    return _index_cache[key]


def biosphere_databases(bd) -> list[str]:
    return sorted(d for d in bd.databases if BIOSPHERE in d.casefold())


def biosphere_flows(bd, database: str) -> list[Flow]:
    key = (bd.projects.current, database, str(bd.databases[database].get("modified")))
    hit = _flow_cache.get(key)
    if hit is not None:
        return hit
    flows = [
        Flow(database=database, code=f["code"], name=f.get("name", ""),
             categories=tuple(f.get("categories") or ()), unit=f.get("unit", ""),
             type=f.get("type", ""))
        for f in bd.Database(database)
    ]
    _flow_cache[key] = flows
    return flows


def families(bd) -> list[str]:
    """Method families, alphabetical -- the same order as ``GET /methods``."""
    return sorted({m[0] for m in bd.methods if len(m) >= 3})


def pick_family(requested: str | None, available: list[str]) -> str:
    """The requested family, else EF v3.1, else the first installed one.

    The same fallback the Impact Assessment method picker uses.
    """
    if requested and requested in available:
        return requested
    if DEFAULT_FAMILY in available:
        return DEFAULT_FAMILY
    return available[0] if available else ""


# ── The search (pure) ──────────────────────────────────────────────────────


def _labels(methods: list[tuple[str, ...]]) -> dict[tuple[str, ...], str]:
    """Short label per method: the category, extended where it is ambiguous."""
    by_cat: dict[str, int] = defaultdict(int)
    for m in methods:
        by_cat[m[1]] += 1
    return {m: (m[1] if by_cat[m[1]] == 1 else " / ".join(m[1:])) for m in methods}


def _same(values: list[float | None]) -> bool:
    first = values[0]
    for v in values[1:]:
        if (first is None) != (v is None):
            return False
        if first is not None and not math.isclose(first, v, rel_tol=1e-9, abs_tol=0.0):
            return False
    return True


def search_groups(
    flows: list[Flow],
    index: dict,
    family: str,
    family_methods: list[tuple[str, ...]],
    query: str,
    *,
    usage: dict | None = None,
    floors: dict | None = None,
    limit: int = 30,
) -> tuple[list[SubstanceGroup], bool]:
    """Substance groups whose name contains ``query`` (case-insensitive).

    ``usage``: flow key -> number of ecoinvent exchanges.
    ``floors``: flow key -> (n_lognormal, median_gsd2) where a floor applies.
    Returns ``(groups, truncated)``.
    """
    q = query.strip().casefold()
    if len(q) < 2:
        return [], False
    usage = usage or {}
    floors = floors or {}
    fam = set(family_methods)
    labels = _labels(sorted(fam))

    by_name: dict[tuple[str, str], list[Flow]] = defaultdict(list)
    for f in flows:
        if q in f.name.casefold():
            by_name[(f.database, f.name)].append(f)

    names = sorted(by_name, key=lambda k: (k[0], k[1].casefold()))
    truncated = len(names) > limit
    groups: list[SubstanceGroup] = []
    for db, name in names[:limit]:
        members = sorted(by_name[(db, name)], key=lambda f: f.categories)
        per_flow: list[dict[tuple[str, ...], float]] = []
        for f in members:
            per_flow.append({m: cf for m, cf in index.get((f.database, f.code), ()) if m in fam})
        touched = sorted({m for d in per_flow for m in d})
        varying = [m for m in touched if not _same([d.get(m) for d in per_flow])]
        uniform = [m for m in touched if m not in varying]
        candidates = []
        for f, d in zip(members, per_flow):
            fl = floors.get((f.database, f.code))
            candidates.append(FlowCandidate(
                database=f.database, code=f.code, name=f.name,
                categories=list(f.categories), unit=f.unit, type=f.type,
                ecoinvent_exchanges=int(usage.get((f.database, f.code), 0)),
                floor_available=fl is not None,
                floor_gsd2=None if fl is None else fl[1],
                floor_n=0 if fl is None else fl[0],
                characterised=len(d),
                factors={labels[m]: cf for m, cf in sorted(d.items())},
            ))
        groups.append(SubstanceGroup(
            name=name, database=db,
            units=sorted({f.unit for f in members}),
            candidates=candidates,
            varying_methods=[MethodRef(label=labels[m], method=list(m)) for m in varying],
            uniform_methods=[MethodRef(label=labels[m], method=list(m)) for m in uniform],
            family_indicator_count=len(fam),
        ))
    return groups, truncated
