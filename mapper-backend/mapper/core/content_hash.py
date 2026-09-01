"""Two content hashes: the authored BOM, and the parameter table.

**Two, not one.** They change for different reasons and at different rates, so
separating them makes a change ATTRIBUTABLE rather than merely detectable: an
export can say *which* of the two moved, and "someone edited a parameter" is a
different investigation from "someone edited the BOM".

**Hash the AUTHORED content, never the resolved.** A BOM whose quantities are
expressions hashes the EXPRESSIONS. Hashing resolved values would make the BOM
hash move every time a parameter moved -- double-counting the parameter hash
and destroying exactly the attribution the split exists to provide.

**A hash that changes on a cosmetic round trip is worse than no hash**, because
it cries wolf until someone stops reading the warning. Everything below is in
service of that.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

#: Bump when the ALLOWLIST or the canonical form changes. A v1-vs-v2
#: comparison then reports "hash scheme changed in a newer MApper -- cannot
#: compare", which is honest, rather than "content changed", which is a lie.
BOM_HASH_VERSION = "1"
PARAM_HASH_VERSION = "1"

# ── What is hashed ──────────────────────────────────────────────────────────
#
# An explicit ALLOWLIST, never ``model_dump()``. ``BOMNode`` has gained fields
# repeatedly (description, uncertainty, basis, evolution); with a wholesale
# dump the NEXT field added with a default would silently move every stored
# hash and every old result would start warning on export -- discrediting the
# warning within one release. Adding a field is now a no-op unless someone
# deliberately adds it here.

BOM_NODE_FIELDS = (
    "name",
    "node_type",
    "quantity",
    "quantity_expression",
    "unit",
    "scope",
    "basis",
)

#: Fields deliberately NOT hashed, with the reason. A field in neither this
#: nor the allowlist fails ``test_every_field_is_decided``.
BOM_NODE_EXCLUDED = {
    "id": (
        "Re-minted on every import -- ``assign_node_ids`` only fills MISSING "
        "ids and the workbook parser builds nodes without them, so a merge "
        "re-import mints a fresh uuid for every node. Hashing it would "
        "invalidate every hash on the routine operation on these projects. "
        "This is the single most important exclusion."
    ),
    "description": (
        "Nothing computes from it -- there is a test asserting every quantity "
        "is unmoved when every description is mutated to garbage. The "
        "warning's claim is 'this no longer reproduces', and a comment edit "
        "still reproduces."
    ),
    "is_annual": (
        "Demoted to a UI hint; only ``basis`` decides the multiplier. Hashing "
        "it would let a scope rename move the hash without moving the number."
    ),
    "children": (
        "Recursed into separately, bottom-up, with the child DIGESTS sorted."
    ),
    "ecoinvent_activity": (
        "Hashed as (database, code) only: resolution is by that pair, and the "
        "validator treats a mismatched display name as a WARNING because the "
        "code is the source of truth."
    ),
    "evolution": "Hashed via its own allowlist (EVOLUTION_FIELDS).",
    "uncertainty": (
        "Affects Monte Carlo only, and the MC result already records its "
        "``scored_inputs`` verbatim at run time -- a second, coarser signal "
        "here would fire on a scoring edit that changed no deterministic "
        "number."
    ),
    "validation_status": (
        "Derived at upload from bw2 state, not authored -- it changes when a "
        "database is installed, which moves no number."
    ),
    "validation_message": (
        "The human text beside ``validation_status``, derived the same way."
    ),
    "global_levers": (
        "Hashed, sorted, as part of the node payload rather than raw."
    ),
}

#: The link's display fields (name, location) are annotation: resolution is by
#: ``(database, code)`` and the validator treats a mismatched name as a WARNING
#: precisely because the code is the source of truth.
BOM_LINK_FIELDS = ("database", "code")

EVOLUTION_FIELDS = (
    "method", "learning_rate", "rebound_rate", "base_year",
    "milestone_years", "milestone_values", "rebound_applies_to_stages",
)

PARAM_FIELDS = (
    "name",
    "base_value",
    "scenario_overrides",
    "keyframes",
    "uncertainty",
)

PARAM_EXCLUDED = {
    "unit": "Annotation on the parameter; resolution never reads it.",
    "description": "A comment, exactly like the BOM row's.",
    "category": "UI grouping in the parameter editor; affects no number.",
    "is_time_varying": "Derived from ``keyframes``, which IS hashed.",
}


# ── Canonicalisation ────────────────────────────────────────────────────────

def _num(x: Any) -> Any:
    """A float in its shortest round-tripping form, with ``-0.0`` normalised.

    ``repr`` round-trips stably through JSON for every value tested (including
    ``89514.00808`` and ``1e-9``). The one trap is ``-0.0``: it survives a JSON
    round trip, its ``repr`` differs from ``0.0``, and ``-0.0 == 0.0`` is True
    -- so a sign-flipped zero would move the hash without moving the number.
    """
    if isinstance(x, bool):
        return x
    if isinstance(x, (int, float)):
        f = float(x)
        if f == 0.0:
            f = 0.0                       # collapse -0.0
        return repr(f)
    return x


def _canon(obj: Any) -> Any:
    """Recursively canonicalise. Dict keys sorted at serialisation time."""
    if isinstance(obj, dict):
        return {str(k): _canon(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_canon(v) for v in obj]
    return _num(obj)


def _digest(payload: Any) -> str:
    """SHA-256 over a canonical JSON form.

    ``sort_keys`` is mandatory: ``model_dump()`` follows FIELD-DECLARATION
    order, so reordering fields in the schema would otherwise move every hash.
    """
    blob = json.dumps(
        _canon(payload), sort_keys=True, separators=(",", ":"), ensure_ascii=False,
    )
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _pick(obj: Any, fields: tuple[str, ...]) -> dict:
    """Allowlisted fields off a model, absent == null (both give ``None``)."""
    return {f: getattr(obj, f, None) for f in fields}


# ── BOM ─────────────────────────────────────────────────────────────────────

def _node_digest(node: Any) -> str:
    """Bottom-up: hash the children first, SORT THE DIGESTS, then combine.

    Sorting the child DIGESTS rather than sorting children by a key is what
    makes this fully deterministic. A key-based sort leaves ties -- two
    siblings can share a name, a link and an expression while differing in
    their SUBTREES -- and Python's stable sort would then fall back to authored
    order, so a reorder would move the hash. Reordering children changes no
    result (``flatten`` sums), so it must not warn.

    A digest is a total order and identical subtrees produce identical digests,
    so there is no tie to break. It also SUBSUMES the obvious sort key: the
    digest is derived from name + link + expression + quantity + subtree, so it
    is strictly more discriminating than any of them.
    """
    own = _pick(node, BOM_NODE_FIELDS)
    link = getattr(node, "ecoinvent_activity", None)
    own["link"] = _pick(link, BOM_LINK_FIELDS) if link is not None else None
    ev = getattr(node, "evolution", None)
    own["evolution"] = _pick(ev, EVOLUTION_FIELDS) if ev is not None else None
    own["global_levers"] = sorted(getattr(node, "global_levers", None) or [])
    own["children"] = sorted(_node_digest(c) for c in (node.children or []))
    return _digest(own)


def bom_hash(archetype: Any) -> str:
    """Content hash of ONE archetype's authored BOM.

    Per-archetype, not per-project: a result names one or a few archetypes, and
    a project-wide hash would warn when an UNRELATED archetype changed. This is
    the attribution the split is for.

    ``includes`` (archetype composition) is hashed by referenced id + quantity
    expression, NOT by recursing into the child -- the child is itself a
    registered archetype with its own hash, and recursing would report a child
    edit as a change to every parent.
    """
    roots = sorted(_node_digest(r) for r in (archetype.bom or []))
    includes = sorted(
        _digest({
            "archetype_id": getattr(i, "archetype_id", None),
            "quantity_expression": getattr(i, "quantity_expression", None),
            "quantity": getattr(i, "quantity", None),
        })
        for i in (getattr(archetype, "includes", None) or [])
    )
    return f"bom:v{BOM_HASH_VERSION}:{_digest({'roots': roots, 'includes': includes})}"


# ── Parameter table ─────────────────────────────────────────────────────────

def _param_digest(p: Any) -> str:
    own = _pick(p, PARAM_FIELDS)
    # Keyframes are SORTED: ``_interpolate_keyframes`` sorts internally (there
    # is a test for unsorted input), so an unsorted-vs-sorted round trip must
    # not move the hash.
    kf = own.get("keyframes") or []
    own["keyframes"] = sorted(
        ({"year": k.year, "value": k.value} for k in kf),
        key=lambda d: (d["year"], d["value"]),
    )
    unc = own.get("uncertainty")
    own["uncertainty"] = (
        {"pedigree": dict(unc.pedigree or {}), "basic_variance": unc.basic_variance}
        if unc is not None else None
    )
    return _digest(own)


def parameter_table_hash(table: Any) -> str:
    """Content hash of the WHOLE parameter table.

    Whole-table, not scenario-scoped. A result computed under ``Optimistic``
    depends only on Base plus the Optimistic overrides, so scoping would warn
    less -- but a scoped hash cannot be compared across results computed under
    different cases, and "the parameter table changed" is a true and useful
    statement. The scenario itself is already recorded separately on the
    result, so nothing is lost.
    """
    params = sorted(_param_digest(p) for p in (table.parameters or {}).values())
    return f"param:v{PARAM_HASH_VERSION}:{_digest({'parameters': params, 'scenarios': sorted(table.scenarios or [])})}"


# ── Comparison ──────────────────────────────────────────────────────────────

def compare(stored: str | None, current: str | None) -> str | None:
    """``None`` when they agree or cannot be compared; else a reason.

    A scheme-version difference is reported as such, never as a content
    change -- the latter would be a lie.
    """
    if not stored or not current:
        return None
    if stored == current:
        return None
    sv, cv = stored.split(":")[:2], current.split(":")[:2]
    if sv != cv:
        return (
            "hash scheme changed in a newer MApper — cannot compare "
            f"({stored.rsplit(':', 1)[0]} vs {current.rsplit(':', 1)[0]})"
        )
    return "content changed since this result was computed"


# ── Stamping helper ─────────────────────────────────────────────────────────

def hashes_for_ids(archetype_ids) -> dict:
    """``hashes_for`` with the project state resolved here.

    The call sites are compute paths in three modules; resolving the registry
    and the table HERE keeps them to one argument and avoids each importing a
    different pair of private helpers.
    """
    try:
        from mapper.api.bom import _proj_archetypes
        from mapper.api.parameters import _table_for

        return hashes_for(archetype_ids, _proj_archetypes(), _table_for())
    except Exception:
        return {"bom_hashes": {}, "parameter_table_hash": None}


def hashes_for(archetype_ids, archetypes, table) -> dict:
    """``{"bom_hashes": {...}, "parameter_table_hash": ...}`` for a result.

    Never raises: provenance must not be the thing that fails a compute. A
    hash that could not be computed is absent, and an absent hash compares as
    "nothing to say" rather than as a mismatch.
    """
    out: dict = {"bom_hashes": {}, "parameter_table_hash": None}
    try:
        for aid in archetype_ids or []:
            arc = (archetypes or {}).get(aid)
            if arc is not None:
                out["bom_hashes"][aid] = bom_hash(arc)
    except Exception:
        out["bom_hashes"] = {}
    try:
        if table is not None:
            out["parameter_table_hash"] = parameter_table_hash(table)
    except Exception:
        out["parameter_table_hash"] = None
    return out


def mismatch_rows(
    stored_bom: dict[str, str] | None,
    stored_param: str | None,
    archetypes,
    table,
) -> list[tuple[str, str]]:
    """Workbook rows naming WHICH of the two moved. WARN, never refuse.

    The result is a true record of what was computed -- it just no longer
    reproduces from current state, which is exactly what a reader needs told.
    """
    rows: list[tuple[str, str]] = []
    for aid, stored in (stored_bom or {}).items():
        arc = (archetypes or {}).get(aid)
        if arc is None:
            rows.append(("BOM changed", f"{aid}: archetype no longer in the project"))
            continue
        why = compare(stored, bom_hash(arc))
        if why:
            rows.append((f"BOM changed — {arc.name}", why))
    if stored_param is not None and table is not None:
        why = compare(stored_param, parameter_table_hash(table))
        if why:
            rows.append(("Parameter table changed", why))
    return rows


def mismatch_rows_for_ids(stored_bom, stored_param) -> list[tuple[str, str]]:
    """``mismatch_rows`` with the project state resolved here."""
    try:
        from mapper.api.bom import _proj_archetypes
        from mapper.api.parameters import _table_for

        return mismatch_rows(stored_bom, stored_param, _proj_archetypes(), _table_for())
    except Exception:
        return []
