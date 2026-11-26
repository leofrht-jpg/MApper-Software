# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Which impact assessment method a result came from, for every export.

A workbook used to list its impact categories ("acidification: terrestrial,
climate change, ...") without the method family they belong to. Several
families share category names (EF v3.1, ReCiPe 2016, CML and IMPACT World+ all
have a "climate change"), so a file could not be traced to the method that
produced its numbers.

Every result workbook therefore carries:

* one metadata row, ``Impact assessment method``, naming the family or
  families (``tuple[0]`` of each Brightway method tuple, in first-seen order);
* one sheet, ``Impact assessment methods``, listing per category the full
  Brightway method tuple, its unit and where MApper knows it came from.

**The tuple is the identity and is written raw.** Category and Indicator are
the display form (``method_labels.display_method``), so the bundled ReCiPe
climate indicator reads GWP100 / GWP20 there exactly as it does everywhere
else, while the tuple column keeps the registered name a reader needs to find
the method again.

**The unit is the RESULT's when it has one.** The result is a record of what
was computed; the project's registry can have changed since. The registry unit
is the fallback, and "not recorded" is written when neither knows.

**Never raises.** Provenance must not be the thing that fails an export: every
lookup that touches the project or the Method Library falls back to
"unknown".
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable, Mapping, Sequence

from mapper.core.method_labels import display_method

#: The metadata row label. The same in every export.
LABEL = "Impact assessment method"
#: The per-category sheet. The same in every export.
SHEET = "Impact assessment methods"
COLUMNS = ["Method family", "Category", "Indicator", "Brightway method tuple", "Unit", "Source"]
NOTE = (
    "One row per impact category in this result. The Brightway method tuple is the method's "
    "identity in the project. Unit is the unit the result was computed in. Source is where the "
    "method came from, as the MApper Method Library records it in the project open at export time."
)

NOT_RECORDED = "not recorded"
UNKNOWN = "unknown"
UNKNOWN_NOT_IN_PROJECT = "unknown (the method is not in the project open at export time)"
UNKNOWN_NO_SOURCE = "unknown (the method is in the project with no recorded source)"

#: ``filename`` that bw2io writes on the methods it bundles (ecoinvent 3.9's
#: LCIA implementation). Both ``bw2setup`` and the Method Library's bundled
#: installs carry it.
BW2IO_BUNDLED_FILENAME = "LCIA_Implementation_3.9.xlsx"
BW2IO_BUNDLED = "bw2io bundled data from the ecoinvent 3.9 LCIA implementation"

Method = tuple[str, ...]


@dataclass(frozen=True)
class CategoryMethod:
    method: Method
    family: str
    unit: str
    source: str

    def row(self) -> list[str]:
        shown = display_method(self.method)
        category = shown[1] if len(shown) > 1 else ""
        indicator = " › ".join(shown[2:]) if len(shown) > 2 else ""
        return [self.family, category, indicator, format_tuple(self.method), self.unit, self.source]


@dataclass(frozen=True)
class MethodProvenance:
    families: list[str] = field(default_factory=list)
    categories: list[CategoryMethod] = field(default_factory=list)

    @property
    def family_text(self) -> str:
        """The families, in first-seen order. ``; `` separates them because
        family names themselves contain commas (``ReCiPe 2016 v1.03, midpoint (H)``)."""
        return "; ".join(self.families) if self.families else NOT_RECORDED

    def meta_row(self) -> tuple[str, str]:
        return (LABEL, self.family_text)


def format_tuple(method: Sequence[str]) -> str:
    """The full tuple as Brightway prints it: ``('EF v3.1', 'climate change', ...)``."""
    return str(tuple(str(p) for p in method))


def family_of(method: Sequence[str]) -> str:
    return str(method[0]) if method else NOT_RECORDED


# ── Lookups (both overridable, both never raise) ────────────────────────────

def _registered_metadata(method: Method) -> dict | None:
    """The project's registry entry for ``method`` (``bw2data.methods``), or None."""
    import bw2data

    return dict(bw2data.methods[method]) if method in bw2data.methods else None


def _library_label(manifest: dict, entry: dict | None) -> str | None:
    installer = manifest.get("installer")
    name = (entry or {}).get("name") or manifest.get("method_id") or "unnamed entry"
    if installer == "bundled_ef":
        return f"MApper Method Library ({name}): {BW2IO_BUNDLED}"
    if installer == "bw2package":
        version = manifest.get("ecoinvent_version")
        file_name = Path(manifest["file_path"]).name if manifest.get("file_path") else ""
        detail = "Brightway package" + (f" for ecoinvent {version}" if version else "")
        return f"MApper Method Library ({name}): {detail}" + (f" ({file_name})" if file_name else "")
    if installer == "pip":
        spec = manifest.get("pip_spec") or ""
        return f"MApper Method Library ({name}): Python package {spec}".rstrip()
    if installer == "excel":
        file_name = Path(manifest["file_path"]).name if manifest.get("file_path") else ""
        return "MApper Method Library: custom upload" + (f" ({file_name})" if file_name else "")
    return None


def _library_sources() -> dict[Method, str]:
    """``{method tuple: source}`` for every method a Method Library manifest
    says it installed in the current project. Read only."""
    from mapper.core import lcia_method_engine as engine

    root = Path(engine.CACHE_ROOT)
    if not root.is_dir():
        return {}
    registry = {e.get("id"): e for e in engine._load_registry()}
    out: dict[Method, str] = {}
    for path in sorted(root.glob("*/manifest.json")):
        manifest = engine._read_manifest(path.parent.name)
        if not manifest:
            continue
        label = _library_label(manifest, registry.get(manifest.get("method_id")))
        if label is None:
            continue
        for t in engine._manifest_tuples(manifest):
            out.setdefault(tuple(t), label)
    return out


def _source_from_metadata(meta: dict | None) -> str:
    if meta is None:
        return UNKNOWN_NOT_IN_PROJECT
    filename = str(meta.get("filename") or "").strip()
    if filename == BW2IO_BUNDLED_FILENAME:
        return f"Brightway default methods: {BW2IO_BUNDLED} (not installed by the MApper Method Library)"
    if filename:
        return f"Brightway method metadata names the file {filename} (not installed by the MApper Method Library)"
    return UNKNOWN_NO_SOURCE


#: Indirection so the test suite can keep every lookup off the developer's
#: real project and Method Library (``tests/conftest.py``).
registered_metadata: Callable[[Method], dict | None] = _registered_metadata
library_sources: Callable[[], dict[Method, str]] = _library_sources


def describe_methods(
    methods: Iterable[Sequence[str]],
    units: Mapping[Method, str] | None = None,
) -> MethodProvenance:
    """Families, and per category its tuple, unit and source, for a run's methods.

    ``methods`` in the result's own order; duplicates are listed once.
    ``units`` maps a tuple to the unit the result carries for it.
    """
    ordered: list[Method] = []
    for m in methods:
        t = tuple(str(p) for p in m)
        if t and t not in ordered:
            ordered.append(t)
    units = {tuple(k): v for k, v in (units or {}).items()}

    try:
        lib = library_sources()
    except Exception:  # noqa: BLE001 - provenance never fails an export
        lib = {}

    families: list[str] = []
    categories: list[CategoryMethod] = []
    for t in ordered:
        fam = family_of(t)
        if fam not in families:
            families.append(fam)
        try:
            meta = registered_metadata(t)
        except Exception:  # noqa: BLE001
            meta, source = None, UNKNOWN
        else:
            source = lib.get(t) if (meta is not None and t in lib) else _source_from_metadata(meta)
        unit = units.get(t) or (meta or {}).get("unit") or NOT_RECORDED
        categories.append(CategoryMethod(method=t, family=fam, unit=str(unit), source=source))
    return MethodProvenance(families=families, categories=categories)


def describe_results(results: Iterable) -> MethodProvenance:
    """``describe_methods`` over result rows that carry ``.method`` and ``.unit``."""
    rows = list(results or [])
    return describe_methods(
        (r.method for r in rows),
        {tuple(r.method): getattr(r, "unit", None) for r in rows if getattr(r, "unit", None)},
    )


def add_method_sheet(wb, prov: MethodProvenance) -> None:
    """Append the per-category sheet. Appended, so no existing sheet moves."""
    from openpyxl.styles import Alignment, Font

    ws = wb.create_sheet(SHEET)
    ws.append([LABEL, prov.family_text])
    ws["A1"].font = Font(bold=True)
    ws.append([NOTE])
    ws["A2"].alignment = Alignment(wrap_text=False, vertical="top")
    ws.append([])
    ws.append(COLUMNS)
    for c in ws[4]:
        c.font = Font(bold=True)
    for cat in prov.categories:
        ws.append(cat.row())
    for letter, width in zip("ABCDEF", (32, 34, 44, 70, 16, 60)):
        ws.column_dimensions[letter].width = width
