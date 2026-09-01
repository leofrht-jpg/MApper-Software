"""A weak, honest fingerprint of the databases and LCIA methods a run used.

`compute_database` is a mutable string, premise regenerates databases IN
PLACE, and the Method Library installs and uninstalls LCIA methods at runtime.
So a result names things that can point at different content than they did at
compute time, and nothing detected it.

**A full checksum is not viable, and the number is why**: the MAp-test project
directory is 40.85 GB. Hashing that per compute is out of the question, and
even one database means materialising every exchange -- the ``Database.load()``
cost the multi-year performance notes already warn about.

**A weak fingerprint that detects the common case beats a strong one nobody
can compute.** Brightway already tracks everything needed, and reading it is
free -- measured at 0.02 ms for all 38 databases in MAp-test and 0.010 ms for
16 EF v3.1 methods. Both are dict reads on metadata bw2 holds anyway; nothing
is loaded.

WHAT THIS DETECTS, AND WHAT IT DOES NOT
=======================================

Stated plainly, because a fingerprint that overstates itself is worse than
none -- it converts "we do not know" into a false assurance.

``modified``
    The ISO timestamp bw2 writes when a database is saved. It detects
    REGENERATION, NOT TAMPERING: it moves when premise rewrites a database in
    place, which is the case this exists for, and it says nothing about
    whether the content is what it was.

``number``
    The activity count. It catches a database replaced by a DIFFERENT one
    under the same name. It misses any edit that preserves the count.

``num_cfs``
    An LCIA method's characterisation-factor count. It misses a
    COUNT-PRESERVING CF EDIT -- a factor changed in place is invisible here.

``abbreviation``
    Brightway's own persisted identifier for a registered method, e.g.
    ``ef-v31aa.3561cd671a473310747f754fe860108c``. It identifies a
    REGISTRATION, NOT CONTENT: it changes when a method is uninstalled and
    reinstalled -- the Method Library case -- and not when factors are edited
    in place. The trailing hex is NOT a hash of the method name (checked
    against ``md5(str(name))`` and ``md5(" ".join(name))``; neither matches)
    and it is NOT documented as content-derived, so it must not be described
    as a content hash.

Together: this catches the ordinary ways a database or method moves under a
stored result. It is not evidence of integrity, and no part of it should be
quoted as such.
"""
from __future__ import annotations

#: Bump when the fields change, so a comparison can say "scheme changed"
#: rather than "content changed", which would be a lie.
FINGERPRINT_VERSION = "1"

#: The caveat, verbatim, for any surface that prints a fingerprint.
LIMITS_NOTE = (
    "Weak fingerprint: 'modified' detects regeneration, not tampering; "
    "'number' and 'num_cfs' miss any edit that preserves the count; the method "
    "abbreviation identifies a registration, not content. Absence of a warning "
    "is not evidence the data is unchanged."
)


def _db_entry(meta: dict) -> dict:
    return {"number": meta.get("number"), "modified": meta.get("modified")}


def fingerprint(database_names, method_tuples) -> dict:
    """``{"version", "databases", "methods"}`` for a result.

    Never raises: provenance must never be the thing that fails a compute. A
    name that cannot be read is simply absent, and an absent entry compares as
    "nothing to say" rather than as a mismatch.
    """
    out: dict = {"version": FINGERPRINT_VERSION, "databases": {}, "methods": {}}
    try:
        import bw2data
    except Exception:
        return out

    try:
        registry = bw2data.databases
        for name in {n for n in (database_names or []) if n}:
            try:
                out["databases"][name] = _db_entry(registry[name])
            except Exception:
                continue          # not installed here: absent, not a mismatch
    except Exception:
        pass

    try:
        methods = bw2data.methods
        for mt in method_tuples or []:
            key = " | ".join(mt)
            try:
                meta = methods[tuple(mt)]
            except Exception:
                continue
            out["methods"][key] = {
                "num_cfs": meta.get("num_cfs"),
                "abbreviation": meta.get("abbreviation"),
            }
    except Exception:
        pass
    return out


def _diff(label: str, stored: dict, current: dict | None) -> list[tuple[str, str]]:
    if current is None:
        return [(f"{label} missing", "not installed in this project any more")]
    rows = []
    for field, human in (("number", "activity count"),
                         ("modified", "last modified"),
                         ("num_cfs", "characterisation factors"),
                         ("abbreviation", "registration id")):
        if field not in stored:
            continue
        was, now = stored.get(field), current.get(field)
        if was is not None and now is not None and was != now:
            rows.append((label, f"{human}: {was} → {now}"))
    return rows


def mismatch_rows(stored: dict | None, current: dict | None) -> list[tuple[str, str]]:
    """Workbook rows naming what moved. WARN, never refuse.

    The result is a true record of what was computed; it just no longer
    reproduces from what is installed now.
    """
    if not stored or not current:
        return []                 # absent is not "changed"
    if stored.get("version") != current.get("version"):
        return [(
            "Fingerprint scheme changed",
            "recorded by a different MApper version — cannot compare",
        )]
    rows: list[tuple[str, str]] = []
    for name, entry in (stored.get("databases") or {}).items():
        rows += _diff(f"Database changed — {name}", entry,
                      (current.get("databases") or {}).get(name))
    for name, entry in (stored.get("methods") or {}).items():
        rows += _diff(f"LCIA method changed — {name}", entry,
                      (current.get("methods") or {}).get(name))
    return rows
