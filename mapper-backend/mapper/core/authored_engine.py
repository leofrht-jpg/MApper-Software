# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Authored databases: validation, uncertainty, and materialisation into bw2.

An authored activity is defined by BIOSPHERE exchanges only (v1), so every
installed LCIA method characterises it automatically -- the reason authoring is
by flows and never by an impact score. The mechanism is the one
``scripts/build_tailpipe_db.py`` proved end to end: a ``type='process'``
activity, a mandatory production self-exchange, 32-hex codes, and a database
name without the "biosphere" substring.

Biosphere-only is also what keeps prospective runs honest:
``prospective_links.resolve_link_db`` deliberately never translates a link into
a non-base database, so an authored activity with a technosphere input would
keep base-ecoinvent electricity in every premise year without a word. Nothing
here can write a technosphere exchange.

UNCERTAINTY -- an authored activity must never report itself as better
constrained than ecoinvent's own data for the same flow:

* Every exchange is lognormal (``uncertainty type 2``). There is no path that
  writes a fixed exchange; an exchange without uncertainty would be sampled as
  GSD2 = 1.0, the most confident possible statement about the least
  substantiated data.
* The basic variance comes from ecoinvent's own ``scale without pedigree``
  for THAT flow (median), not from a constant. The constant 0.0006 is fossil
  CO2's value; applied to PM2.5 (ecoinvent median 0.30) it would understate the
  spread several-fold. Where ecoinvent has no usable value, the user enters one
  and a reason, and both are stored.
* The composed GSD2 is compared with ecoinvent's median GSD2 for the flow.
  Below it, the write is refused unless the user gives a reason, which is
  stored on the exchange. Where ecoinvent carries fewer than
  ``MIN_FLOOR_SAMPLES`` lognormal exchanges for the flow, there is no floor to
  apply -- and that is recorded as ``floor_status='unfloored'`` with the
  reason, never left to be inferred from a missing field.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import logging
import math
import pickle
import statistics
import uuid
from collections import defaultdict
from dataclasses import dataclass
from typing import Iterable, Protocol

from mapper.core.pedigree import gsd2_from_sigma, total_sigma
from mapper.models.authored_schemas import (
    ActivityInput,
    AuthoredActivity,
    AuthoredDatabase,
    AuthoredDefinitions,
    AuthoredExchange,
    ExchangeInput,
    FlowSnapshot,
    MaterialisationStatus,
)

logger = logging.getLogger(__name__)

#: Below this many lognormal ecoinvent exchanges for a flow, its median is not
#: used -- neither as the basic variance nor as the floor.
#:
#: THIS NUMBER IS ARBITRARY, and the data says so. Measured on ecoinvent 3.10
#: cutoff (see CLAUDE.md, "The 10-exchange floor minimum is a documented
#: choice"): the error of a small-sample median falls smoothly with the count,
#: with no knee to pick. A 10-exchange median still sets the floor >10% too low
#: for 14.5% of subsamples (3 exchanges: 20.8%, 50: 6.4%), and flows with few
#: exchanges are not like common ones (mostly one repeated value), so the
#: subsampling does not transfer cleanly either. 10 is kept as a conventional
#: middle; it excludes 1,095 of 2,545 scored flows (43%). Do not read it as
#: derived, and do not change it without re-running that analysis.
MIN_FLOOR_SAMPLES = 10

#: Biosphere flow types an authored exchange may reference.
ALLOWED_FLOW_TYPES = frozenset({"emission", "natural resource"})

_BIOSPHERE = "biosphere"


class AuthoredError(ValueError):
    """A request that cannot be written.

    ``problems`` names every failure for a person; ``codes`` is the parallel
    machine-readable list (``below_floor``, ``bv_required`` ...). The UI keys its
    behaviour off codes -- e.g. showing the floor-reason box exactly when the
    verdict is ``below_floor`` -- so it never re-derives a rule from wording or
    re-implements it. Preview and save return the same codes.
    """

    def __init__(self, problems: list[str], codes: list[str] | None = None):
        self.problems = list(problems)
        self.codes = list(codes) if codes is not None else ["invalid"] * len(self.problems)
        if len(self.codes) != len(self.problems):
            raise ValueError("AuthoredError: codes and problems must be parallel")
        super().__init__("; ".join(self.problems))


@dataclass(frozen=True)
class FlowInfo:
    database: str
    code: str
    name: str
    categories: tuple[str, ...]
    unit: str
    type: str


@dataclass(frozen=True)
class FlowStats:
    """ecoinvent's own uncertainty for one biosphere flow."""

    n_lognormal: int
    median_gsd2: float
    median_basic_variance: float | None
    n_basic_variance: int
    sources: tuple[str, ...]


class Backend(Protocol):
    def flow(self, database: str, code: str) -> FlowInfo | None: ...
    def flow_stats(self, database: str, code: str) -> FlowStats | None: ...
    def installed(self) -> list[str]: ...
    def fingerprint_of(self, name: str) -> str | None: ...
    def write(self, name: str, data: dict, fingerprint: str) -> None: ...
    def delete(self, name: str) -> None: ...
    #: Method tuples at least one of these flows is characterised by.
    def reached_methods(self, flow_keys: Iterable[tuple[str, str]]) -> set[tuple[str, ...]]: ...


def now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat()


def new_code() -> str:
    """Minted once, stored, never derived from the name.

    ``build_tailpipe_db`` can hash its names because they never change. An
    authored activity can be renamed, and a name-derived code would then change
    and dangle every BOM link into it.
    """
    return uuid.uuid4().hex


# ── Names ──────────────────────────────────────────────────────────────────


def validate_database_name(name: str, installed: Iterable[str], defs: AuthoredDefinitions) -> str:
    from mapper.core.project_storage import _GENERATED_DATABASES, _PREMISE_MARKER

    n = (name or "").strip()
    problems: list[str] = []
    if not n:
        problems.append("a database name is required")
    elif _BIOSPHERE in n.casefold():
        problems.append(
            f"{n!r} contains 'biosphere'. MApper refuses to link to databases whose "
            "name contains that word, so its activities would be unusable."
        )
    if n and _PREMISE_MARKER in n:
        problems.append(f"{n!r} contains {_PREMISE_MARKER!r}, which marks premise databases")
    if n and n in _GENERATED_DATABASES:
        problems.append(f"{n!r} is reserved for a generated database")
    if n and n in set(installed):
        problems.append(f"a database named {n!r} is already installed in this project")
    if n and defs.get(n) is not None:
        problems.append(f"an authored database named {n!r} already exists")
    if len(n) > 100:
        problems.append("database name is longer than 100 characters")
    if problems:
        raise AuthoredError(problems)
    return n


# ── Exchanges ──────────────────────────────────────────────────────────────


def _label(flow: FlowInfo) -> str:
    return f"{flow.name} [{', '.join(flow.categories)}]"


def derived_basic_variance(stats: FlowStats | None) -> float | None:
    """ecoinvent's median basic variance for a flow, or None if it has no usable one.

    The ONE place this rule lives: ``resolve_exchange`` uses it to decide whether
    the user may (must) enter a variance, and the compartment picker uses it to
    tell the editor which, the moment a flow is chosen.
    """
    if (stats is not None and stats.median_basic_variance is not None
            and stats.n_basic_variance >= MIN_FLOOR_SAMPLES):
        return stats.median_basic_variance
    return None


def floor_gsd2_of(stats: FlowStats | None) -> float | None:
    """ecoinvent's median GSD2 for a flow -- the floor -- or None if there is none."""
    if stats is not None and stats.n_lognormal >= MIN_FLOOR_SAMPLES:
        return stats.median_gsd2
    return None


def resolve_exchange(inp: ExchangeInput, backend: Backend) -> AuthoredExchange:
    """Turn a user's exchange into a stored one, or raise naming why not."""
    problems: list[str] = []
    codes: list[str] = []
    where = f"{inp.flow_database}/{inp.flow_code}"

    if inp.amount < 0:
        raise AuthoredError([
            f"{where}: negative amount {inp.amount!r}. Negative biosphere amounts "
            "(for example CO2 uptake) are not supported in this version; model the "
            "flow as positive or leave it out."
        ], ["negative_amount"])
    if not inp.amount > 0 or not math.isfinite(inp.amount):
        raise AuthoredError([f"{where}: amount must be a positive number, got {inp.amount!r}"], ["amount_not_positive"])
    if _BIOSPHERE not in inp.flow_database.casefold():
        raise AuthoredError([
            f"{where}: authored activities take biosphere exchanges only; "
            f"{inp.flow_database!r} is not a biosphere database"
        ], ["not_biosphere"])

    flow = backend.flow(inp.flow_database, inp.flow_code)
    if flow is None:
        raise AuthoredError([f"{where}: no such biosphere flow is installed in this project"], ["unknown_flow"])
    if flow.type not in ALLOWED_FLOW_TYPES:
        raise AuthoredError([
            f"{_label(flow)}: flow type {flow.type!r} cannot be authored "
            f"(allowed: {', '.join(sorted(ALLOWED_FLOW_TYPES))})"
        ], ["flow_type"])

    stats = backend.flow_stats(flow.database, flow.code)
    derived = derived_basic_variance(stats)
    floor = floor_gsd2_of(stats)

    # Basic variance: ecoinvent's, or the user's with a reason. Never both.
    if derived is not None:
        if inp.basic_variance is not None:
            codes.append("bv_not_settable")
            problems.append(
                f"{_label(flow)}: the basic variance comes from ecoinvent for this flow "
                f"(median {stats.median_basic_variance:.4g} over {stats.n_basic_variance} "
                "exchanges) and is not user-settable. Remove basic_variance."
            )
        bv = derived
        bv_source = "ecoinvent_median"
        bv_detail = (
            f"median of ecoinvent's basic variance for this flow over "
            f"{stats.n_basic_variance} exchanges in {', '.join(stats.sources)}"
        )
    else:
        why = (
            "ecoinvent carries no basic variance for this flow"
            if stats is None or stats.n_basic_variance == 0
            else f"ecoinvent carries a basic variance on only {stats.n_basic_variance} "
                 f"exchanges for this flow (fewer than {MIN_FLOOR_SAMPLES})"
        )
        if inp.basic_variance is None:
            codes.append("bv_required")
            problems.append(f"{_label(flow)}: {why}, so basic_variance must be entered")
        elif not (inp.basic_variance >= 0 and math.isfinite(inp.basic_variance)):
            codes.append("bv_invalid")
            problems.append(f"{_label(flow)}: basic_variance must be a finite value >= 0")
        if inp.basic_variance_reason is None or not inp.basic_variance_reason.strip():
            codes.append("bv_reason_required")
            problems.append(f"{_label(flow)}: {why}, so basic_variance_reason is required")
        bv = inp.basic_variance if inp.basic_variance is not None else 0.0
        bv_source = "user_entered"
        bv_detail = (inp.basic_variance_reason or "").strip()

    if problems:
        raise AuthoredError(problems, codes)

    sigma = total_sigma(inp.pedigree, bv)
    gsd2 = gsd2_from_sigma(sigma)

    # The floor.
    floor_reason = None
    if floor is not None:
        floor_detail = (
            f"ecoinvent median GSD2 for this flow: {floor:.4g} over "
            f"{stats.n_lognormal} lognormal exchanges in {', '.join(stats.sources)}"
        )
        if gsd2 < floor:
            reason = (inp.floor_reason or "").strip()
            if not reason:
                raise AuthoredError([
                    f"{_label(flow)}: GSD2 {gsd2:.4g} is below ecoinvent's median "
                    f"{floor:.4g} for this flow. This would report the authored value as "
                    "better constrained than ecoinvent's own data. Raise the pedigree "
                    "scores, or give floor_reason explaining why the tighter spread is "
                    "justified; the reason is stored on the exchange."
                ], ["below_floor"])
            status = "below_floor_with_reason"
            floor_reason = reason
        else:
            status = "floored"
    else:
        status = "unfloored"
        count = 0 if stats is None else stats.n_lognormal
        floor_detail = (
            f"no floor applied: ecoinvent carries {count} lognormal exchange(s) for "
            f"this flow, fewer than the {MIN_FLOOR_SAMPLES} needed for a median"
        )

    return AuthoredExchange(
        flow=FlowSnapshot(
            database=flow.database, code=flow.code, name=flow.name,
            categories=list(flow.categories), unit=flow.unit,
        ),
        amount=inp.amount,
        pedigree=dict(inp.pedigree),
        basic_variance=bv,
        basic_variance_source=bv_source,
        basic_variance_detail=bv_detail,
        sigma=sigma,
        gsd2=gsd2,
        floor_status=status,
        floor_gsd2=floor,
        floor_detail=floor_detail,
        floor_reason=floor_reason,
    )


def build_activity(inp: ActivityInput, backend: Backend, code: str) -> AuthoredActivity:
    """Resolve every exchange, collecting ALL problems before refusing."""
    problems: list[str] = []
    codes: list[str] = []
    resolved: list[AuthoredExchange] = []
    for ex in inp.exchanges:
        try:
            resolved.append(resolve_exchange(ex, backend))
        except AuthoredError as err:
            problems.extend(err.problems)
            codes.extend(err.codes)
    if problems:
        raise AuthoredError(problems, codes)
    # The floor: a tick may only NARROW what counts as specified. An indicator
    # no listed flow reaches cannot be declared complete. Activity-level, so it
    # lives here rather than in the exchange loop (which stays resolve-only).
    if inp.scope == "partial" and inp.complete_indicators:
        reached = backend.reached_methods((ex.flow.database, ex.flow.code) for ex in resolved)
        for m in inp.complete_indicators:
            if tuple(m) not in reached:
                problems.append(
                    f"{' › '.join(m)}: no listed flow is characterised by this indicator, so "
                    "the activity cannot be declared complete for it"
                )
                codes.append("indicator_not_reached")
        if problems:
            raise AuthoredError(problems, codes)
    try:
        return AuthoredActivity(
            code=code,
            name=inp.name.strip(),
            reference_product=(inp.reference_product or inp.name).strip(),
            unit=inp.unit,
            location=inp.location,
            comment=inp.comment,
            scope=inp.scope,
            scope_note=inp.scope_note,
            exchanges=resolved,
            complete_indicators=inp.complete_indicators,
        )
    except ValueError as err:
        raise AuthoredError([str(err)]) from err


# ── Brightway materialisation ──────────────────────────────────────────────


def fingerprint(db: AuthoredDatabase) -> str:
    """Content hash of what gets written. Timestamps excluded.

    ``complete_indicators`` is excluded too: it is an annotation that never
    reaches Brightway, and hashing it would have made adding the field mark
    every existing authored database stale ("rebuild") on upgrade.
    """
    payload = db.model_dump(mode="json", exclude={
        "created_at": True, "updated_at": True,
        "activities": {"__all__": {"complete_indicators"}},
    })
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _activity_comment(act: AuthoredActivity) -> str:
    lines = [act.comment.strip()] if act.comment.strip() else []
    lines.append("Authored in MApper from biosphere exchanges.")
    if act.scope == "complete":
        lines.append("Inventory scope: complete for the flows listed.")
    else:
        lines.append(f"Inventory scope: PARTIAL. {act.scope_note}")
    if act.has_unfloored_exchange:
        lines.append(
            "Carries at least one exchange whose uncertainty could not be checked "
            "against ecoinvent (see each exchange's floor_status)."
        )
    return "\n".join(lines)


def to_bw2(db: AuthoredDatabase) -> dict:
    data: dict[tuple[str, str], dict] = {}
    for act in db.activities:
        key = (db.name, act.code)
        exchanges = [{
            "input": key, "output": key, "amount": 1.0, "type": "production",
            "unit": act.unit, "uncertainty type": 0,
        }]
        for ex in act.exchanges:
            exchanges.append({
                "input": (ex.flow.database, ex.flow.code),
                "output": key,
                "amount": ex.amount,
                "type": "biosphere",
                "unit": ex.flow.unit,
                "uncertainty type": 2,
                "loc": math.log(ex.amount),
                "scale": ex.sigma,
                "scale without pedigree": math.sqrt(ex.basic_variance),
                "pedigree": dict(ex.pedigree),
                "mapper_floor_status": ex.floor_status,
            })
        data[key] = {
            "name": act.name,
            "code": act.code,
            "database": db.name,
            "unit": act.unit,
            "type": "process",
            "reference product": act.reference_product,
            "location": act.location,
            "production amount": 1.0,
            "comment": _activity_comment(act),
            "mapper_authored": True,
            "mapper_scope": act.scope,
            "exchanges": exchanges,
        }
    return data


def _snapshot_problems(db: AuthoredDatabase, backend: Backend) -> list[str]:
    """Flows that do not resolve, or resolve to something else, here."""
    out: list[str] = []
    for act in db.activities:
        for ex in act.exchanges:
            s = ex.flow
            got = backend.flow(s.database, s.code)
            if got is None:
                out.append(f"{act.name}: {s.name} [{', '.join(s.categories)}] "
                           f"({s.database}/{s.code}) is not installed")
            elif (got.name, list(got.categories), got.unit) != (s.name, s.categories, s.unit):
                out.append(
                    f"{act.name}: {s.database}/{s.code} was authored as {s.name} "
                    f"[{', '.join(s.categories)}] in {s.unit} but here it is {got.name} "
                    f"[{', '.join(got.categories)}] in {got.unit}"
                )
    return out


def materialize(db: AuthoredDatabase, backend: Backend) -> None:
    """Write ``db`` to Brightway. Raises AuthoredError if any flow is unresolvable."""
    problems = _snapshot_problems(db, backend)
    if problems:
        raise AuthoredError(problems)
    backend.write(db.name, to_bw2(db), fingerprint(db))


def reconcile(defs: AuthoredDefinitions, backend: Backend) -> list[MaterialisationStatus]:
    """Bring Brightway in line with the definition file. Never raises.

    Run after a project import and after an ecoinvent import. A modelling-only
    import usually has no biosphere yet: that is ``pending``, not a failure,
    and BOM links into the database report ``database_missing`` until it runs
    again.
    """
    out: list[MaterialisationStatus] = []
    for db in defs.databases:
        fp = fingerprint(db)
        try:
            if backend.fingerprint_of(db.name) == fp:
                out.append(MaterialisationStatus(database=db.name, state="in_sync"))
                continue
            problems = _snapshot_problems(db, backend)
            if problems:
                out.append(MaterialisationStatus(
                    database=db.name, state="pending",
                    detail="not rebuilt: " + "; ".join(problems),
                ))
                continue
            backend.write(db.name, to_bw2(db), fp)
            out.append(MaterialisationStatus(database=db.name, state="rebuilt"))
        except Exception as exc:  # reported per database, never raised
            logger.exception("authored database %r failed to materialise", db.name)
            out.append(MaterialisationStatus(database=db.name, state="failed", detail=str(exc)))
    return out


def status_of(db: AuthoredDatabase, backend: Backend) -> MaterialisationStatus:
    if backend.fingerprint_of(db.name) == fingerprint(db):
        return MaterialisationStatus(database=db.name, state="in_sync")
    return MaterialisationStatus(
        database=db.name, state="pending",
        detail="the Brightway database does not match the definition; run reconcile",
    )


# ── BOM links ──────────────────────────────────────────────────────────────


def links_into(archetypes: dict, database: str, codes: set[str] | None = None) -> list[str]:
    """``"<archetype> > <row>"`` for every BOM row linking into ``database``.

    ``codes`` narrows to specific activities; None means any activity in it.
    """
    hits: list[str] = []

    def walk(arc_name, node):
        link = getattr(node, "ecoinvent_activity", None)
        if (link is not None and link.database == database
                and (codes is None or link.code in codes)):
            hits.append(f"{arc_name} > {node.name}")
        for child in getattr(node, "children", None) or []:
            walk(arc_name, child)

    for arc in (archetypes or {}).values():
        for root in getattr(arc, "bom", None) or []:
            walk(arc.name, root)
    return hits


# ── The real backend ───────────────────────────────────────────────────────


class Bw2Backend:
    """Brightway access for the CURRENT project."""

    #: (project, ((db, modified), ...)) -> {(database, code): FlowStats}
    _stats_cache: dict = {}

    def __init__(self, authored: Iterable[str] = ()):
        import bw2data

        self._bd = bw2data
        self._authored = set(authored)

    def reached_methods(self, flow_keys) -> set[tuple[str, ...]]:
        from mapper.core.authored_coverage import reached
        from mapper.core.flow_characterisation import characterisation_index

        return reached(flow_keys, characterisation_index(self._bd))

    def flow(self, database: str, code: str) -> FlowInfo | None:
        if database not in self._bd.databases:
            return None
        try:
            f = self._bd.get_activity((database, code))
        except Exception:
            return None
        return FlowInfo(
            database=database, code=code, name=f.get("name", ""),
            categories=tuple(f.get("categories") or ()), unit=f.get("unit", ""),
            type=f.get("type", ""),
        )

    def _base_databases(self) -> list[str]:
        from mapper.core.project_storage import _GENERATED_DATABASES, _PREMISE_MARKER

        out = []
        for name in self._bd.databases:
            meta = self._bd.databases[name]
            if (_BIOSPHERE in name.casefold() or _PREMISE_MARKER in name
                    or name in _GENERATED_DATABASES or name in self._authored
                    or meta.get("mapper_authored")):
                continue
            out.append(name)
        return sorted(out)

    def _all_stats(self) -> tuple[dict, dict]:
        """``(stats, usage)`` from ONE pass over base ecoinvent.

        ``stats``: flow key -> FlowStats, for flows with lognormal exchanges.
        ``usage``: flow key -> number of biosphere exchanges using the flow,
        whatever their uncertainty type (the compartment picker shows it).
        """
        base = self._base_databases()
        key = (
            self._bd.projects.current,
            tuple((b, str(self._bd.databases[b].get("modified"))) for b in base),
        )
        cached = self._stats_cache.get(key)
        if cached is not None:
            return cached
        from bw2data.backends.peewee.schema import ExchangeDataset

        sql = ExchangeDataset._meta.database
        gsd2: dict = defaultdict(list)
        bvar: dict = defaultdict(list)
        where: dict = defaultdict(set)
        usage: dict = defaultdict(int)
        # One pass per base database via the output index: ~2.5 s for
        # ecoinvent 3.10's 445,588 biosphere exchanges. A per-flow query is
        # 4-11 s EACH on a project carrying premise copies, because the input
        # index then walks every copy of the flow's exchanges.
        for b in base:
            rows = sql.execute_sql(
                "select input_database, input_code, data from exchangedataset "
                "indexed by exchangedataset_output where output_database=? and type='biosphere'",
                (b,),
            ).fetchall()
            for idb, icode, blob in rows:
                usage[(idb, icode)] += 1
                d = pickle.loads(blob)
                if d.get("uncertainty type") != 2:
                    continue
                s = d.get("scale")
                w = d.get("scale without pedigree")
                k = (idb, icode)
                if s is not None and s > 0 and not math.isnan(s):
                    gsd2[k].append(gsd2_from_sigma(s))
                    where[k].add(b)
                if w is not None and w > 0 and not math.isnan(w):
                    bvar[k].append(w * w)
        stats = {
            k: FlowStats(
                n_lognormal=len(v),
                median_gsd2=statistics.median(v),
                median_basic_variance=statistics.median(bvar[k]) if bvar.get(k) else None,
                n_basic_variance=len(bvar.get(k, ())),
                sources=tuple(sorted(where[k])),
            )
            for k, v in gsd2.items()
        }
        self._stats_cache[key] = (stats, dict(usage))
        return self._stats_cache[key]

    def flow_stats(self, database: str, code: str) -> FlowStats | None:
        return self._all_stats()[0].get((database, code))

    def all_stats(self) -> dict:
        return self._all_stats()[0]

    def usage(self) -> dict:
        return self._all_stats()[1]

    def installed(self) -> list[str]:
        return list(self._bd.databases)

    def fingerprint_of(self, name: str) -> str | None:
        if name not in self._bd.databases:
            return None
        return self._bd.databases[name].get("mapper_authored_fingerprint")

    def write(self, name: str, data: dict, fp: str) -> None:
        self._bd.Database(name).write(data)
        meta = self._bd.databases[name]
        meta["mapper_authored"] = True
        meta["mapper_authored_fingerprint"] = fp
        self._bd.databases.flush()

    def delete(self, name: str) -> None:
        if name in self._bd.databases:
            del self._bd.databases[name]
