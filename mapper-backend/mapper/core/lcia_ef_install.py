# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Install one LCIA method family from the characterisation factors that ship
inside the installed bw2io, linking them to the project's existing biosphere3.

``bw2io.bw2setup()`` installs about 760 methods and creates its own biosphere3;
MApper runs it only for the demo project, so a project imported from ecoinvent
has no methods. bw2io 0.8.12 keeps those factors in
``data/lcia/lcia_39_ecoinvent.zip`` (the ecoinvent 3.9 LCIA implementation). This
module takes ONE family out of that file ("EF v3.1": 25 methods, 11,414 factors,
3,226 flows) and writes it with the exact tuples ``bw2setup`` would have, so
every name MApper expects (indicator mapping, AESA, impact assessment) is the
same as in the demo project.

Linking, per factor: by flow code when the project's biosphere3 has it, else by
name and categories when exactly one biosphere3 flow has them, else the factor is
skipped and counted. biosphere3 is only READ: no flow is added, changed or
removed. A factor on a flow the project lacks is therefore never silently
attached to a missing key; it is reported.
"""
from __future__ import annotations

import json
import zipfile
from collections import Counter
from pathlib import Path
from typing import Any, Callable

import bw2data

BIOSPHERE = "biosphere3"
_ZIP = ("data", "lcia", "lcia_39_ecoinvent.zip")
_UNSPECIFIED = {"unspecified", "(unspecified)", "", None}
#: How many skipped flows the warning lists.
TOP_SKIPPED = 10

ProgressCallback = Callable[[str, float], None]


class EFInstallError(RuntimeError):
    """The family cannot be installed; the message is shown to the user."""


def _norm_cats(categories: Any) -> tuple:
    cats = list(categories or ())
    while cats and cats[-1] in _UNSPECIFIED:
        cats.pop()
    return tuple(cats)


def load_family(family: str) -> list[dict]:
    """The methods of ``family`` (exact first tuple element) in bw2io's data."""
    import bw2io

    path = Path(bw2io.__file__).parent.joinpath(*_ZIP)
    if not path.is_file():
        raise EFInstallError(
            f"The installed bw2io ({getattr(bw2io, '__version__', '?')}) has no bundled LCIA data "
            f"({'/'.join(_ZIP)}), so '{family}' cannot be installed offline."
        )
    with zipfile.ZipFile(path) as archive:
        data = json.load(archive.open("data.json"))
    methods = [m for m in data if m["name"][0] == family]
    if not methods:
        raise EFInstallError(f"The installed bw2io has no '{family}' methods in its bundled LCIA data.")
    return methods


def family_tuples(family: str) -> list[tuple]:
    """The exact method tuples the family consists of (cached per process)."""
    return list(_family_tuples_cached(family))


_CACHE: dict[str, tuple] = {}


def _family_tuples_cached(family: str) -> tuple:
    if family not in _CACHE:
        _CACHE[family] = tuple(tuple(m["name"]) for m in load_family(family))
    return _CACHE[family]


def installed_tuples(family: str) -> list[tuple]:
    """The family's tuples that are registered in the current project."""
    try:
        wanted = family_tuples(family)
    except EFInstallError:
        return []
    return [t for t in wanted if t in bw2data.methods]


def is_complete(family: str) -> bool:
    """True when every method of the family is registered in the current project."""
    try:
        wanted = family_tuples(family)
    except EFInstallError:
        return False
    return bool(wanted) and all(t in bw2data.methods for t in wanted)


def _biosphere_index() -> tuple[set[str], dict[tuple, list[str]]]:
    if BIOSPHERE not in bw2data.databases:
        raise EFInstallError(
            f"This project has no '{BIOSPHERE}', so there is nothing to link the factors to. "
            "Import an ecoinvent database into the project first (Database Explorer → Import)."
        )
    codes: set[str] = set()
    by_key: dict[tuple, list[str]] = {}
    for flow in bw2data.Database(BIOSPHERE):
        codes.add(flow["code"])
        by_key.setdefault((flow["name"], _norm_cats(flow.get("categories"))), []).append(flow["code"])
    if not codes:
        raise EFInstallError(f"'{BIOSPHERE}' in this project is empty, so there is nothing to link the factors to.")
    return codes, by_key


def install_family(
    family: str,
    on_progress: ProgressCallback | None = None,
) -> tuple[list[tuple], list[str], dict]:
    """Register the family's methods in the current project.

    Returns ``(new method tuples, warnings, report)``. Methods already
    registered under the same tuple are left exactly as they are. A cancel
    (an exception from ``on_progress``) or any failure unregisters what this
    call registered before it propagates.
    """

    def emit(stage: str, pct: float) -> None:
        if on_progress is not None:
            on_progress(stage, pct)

    emit("reading characterisation factors", 0.05)
    methods = load_family(family)
    emit("reading biosphere3", 0.20)
    codes, by_key = _biosphere_index()

    found = linked_code = linked_name = 0
    skipped_by_flow: Counter = Counter()
    prepared: list[tuple[tuple, dict, list]] = []
    for method in methods:
        cfs: list[tuple] = []
        for exc in method["exchanges"]:
            found += 1
            code = exc["input"][1]
            if code in codes:
                cfs.append(((BIOSPHERE, code), exc["amount"]))
                linked_code += 1
                continue
            same = by_key.get((exc["name"], _norm_cats(exc.get("categories"))), [])
            if len(same) == 1:
                cfs.append(((BIOSPHERE, same[0]), exc["amount"]))
                linked_name += 1
            else:
                skipped_by_flow[(exc["name"], tuple(exc.get("categories") or ()))] += 1
        prepared.append((tuple(method["name"]), method, cfs))

    linked = linked_code + linked_name
    skipped = found - linked
    if linked == 0:
        raise EFInstallError(
            f"None of the {found:,} '{family}' characterisation factors match a flow in this project's "
            f"'{BIOSPHERE}', so nothing was installed."
        )

    new_tuples: list[tuple] = []
    already: list[tuple] = []
    try:
        for i, (name, method, cfs) in enumerate(prepared):
            emit(f"writing {name[1]}", 0.30 + 0.65 * i / len(prepared))
            if name in bw2data.methods:
                already.append(name)  # never overwrite a method that is there
                continue
            m = bw2data.Method(name)
            m.register(unit=method.get("unit", ""), description=method.get("description", ""),
                       filename=method.get("filename", ""))
            new_tuples.append(name)
            m.write(cfs)
    except BaseException:
        for name in new_tuples:
            if name in bw2data.methods:
                try:
                    del bw2data.methods[name]
                except Exception:  # noqa: BLE001 - best effort; the original error matters
                    pass
        raise

    top = [
        {"name": n, "categories": list(c), "cfs": k}
        for (n, c), k in sorted(skipped_by_flow.items(), key=lambda kv: (-kv[1], kv[0][0], kv[0][1]))[:TOP_SKIPPED]
    ]
    report = {
        "family": family,
        "methods_registered": len(new_tuples),
        "methods_already_present": len(already),
        "cfs_found": found,
        "cfs_linked": linked,
        "cfs_linked_by_code": linked_code,
        "cfs_linked_by_name": linked_name,
        "cfs_skipped": skipped,
        "skipped_flows": len(skipped_by_flow),
        "top_skipped": top,
    }
    warnings: list[str] = []
    if already:
        warnings.append(
            f"{len(already)} of the {len(methods)} methods were already in this project and were left unchanged."
        )
    if skipped:
        warnings.append(
            f"{skipped:,} of {found:,} characterisation factors ({100 * skipped / found:.1f}%) were skipped because "
            f"their flow is not in this project's {BIOSPHERE}. Results for activities that emit those flows "
            f"miss their contribution. The {len(top)} most frequent skipped flows:"
        )
        warnings.extend(f"{t['name']} [{' / '.join(t['categories'])}]: {t['cfs']} factors" for t in top)
    emit("done", 1.0)
    return new_tuples, warnings, report
