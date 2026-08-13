# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""The carbon-budget rule has exactly one BACKEND implementation.

The frontend has carried this guard since the depletion arithmetic was found in
four places. The backend never had one — and it is the side with the higher
stakes, because it is the authority the frontend is checked against. It has also
already grown four hand-rolled copies of the year resolver and four of the
budget arithmetic; a codebase with that history should not rely on nobody
writing the fifth.

What is being protected:

* `CarbonBudgetConfig.remaining_budget` / `.annual_global_allocation` /
  `.annual_system_allocation` in `mapper/models/aesa_schemas.py` — the only
  place that may sum `projected_emissions` or divide by `end_year - year`.
* `CarbonBudgetConfig.with_basis_applied` / `.co2e_ratio` — the only place that
  may scale a budget by the CO2->CO2e factor.
* `carbon_budget_vintage()` in `mapper/core/aesa_engine.py` — the only place
  that reads the budget data's baseline years.

Everything else calls those. The export builders, the compute engine and the
API handlers currently do exactly that; this test keeps it that way.

WHAT THIS GUARD COVERS
----------------------
Every ``*.py`` under ``mapper/``, comments and docstrings stripped:

* element-wise reads of ``projected_emissions`` — indexing, ``.get``/``.items``/
  ``.values``/``.keys``, ``for … in``. Forbidding ACCESS rather than
  enumerating accumulation idioms is the point: ``+=``, ``sum()``, a
  comprehension, ``functools.reduce`` and a ``for`` loop are five spellings of
  one mistake, and none can be written without reaching individual years first.
* accumulation across years — ``sum()``, ``+=``, ``reduce`` — enforced
  EVERYWHERE, including ``api/aesa.py``, which is exempt from the access rules
  because writing a per-year table is legitimate enumeration.
* comparing a running total to ``initial_budget_gt``, in either direction, on
  any operator (``>``, ``>=``, ``<``, ``<=``, ``==``, ``!=``).
* re-deriving ``remaining / (end_year - year)`` instead of calling
  ``annual_global_allocation`` (which floors the divisor at 1).
* applying the CO2->CO2e factor by hand instead of ``with_basis_applied``,
  INCLUDING as a hard-coded literal (``* 1.4846``) — the worse version.
* reading the budget vintage outside ``carbon_budget_vintage()``.

Each rule is asserted against a synthetic corpus by
``test_the_rules_match_the_constructs_they_name``, so the sweep cannot pass
vacuously if a regex stops matching real code.

WHAT IT CANNOT COVER
--------------------
It is text matching, not analysis. It will NOT catch:

* **an indirection.** A helper that takes ``dict[int, float]`` and sums it never
  names ``projected_emissions``, so nothing here fires. Same for a copy that
  operates on a local alias assigned in a whole-value pass-through.
* **anything outside ``mapper/``** — scripts, notebooks, ad-hoc analysis, and
  the backend test tree itself. (The FRONTEND guard does sweep its tests,
  because a copy was found there. No equivalent copy exists on this side yet.)
* **misuse of a correct call.** Calling ``remaining_budget(year + 1)`` is the
  original bug's shape and passes every rule here — the caller used the helper,
  just with the wrong argument. Only the fixture tests
  (``test_carbon_budget_series_fixture.py``, ``..._sparkline_fixture.py``) catch
  that class.
* **a NEW field.** If a second pathway or budget field is added, these rules do
  not extend to it automatically; add it to the patterns above.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
PKG = BACKEND / "mapper"

#: The one module allowed to implement the rule.
SCHEMA = "models/aesa_schemas.py"
#: The one module allowed to read the budget data's vintage.
ENGINE = "core/aesa_engine.py"


def _sources() -> list[tuple[str, str]]:
    """(POSIX-relative path, source) for every module under ``mapper/``.

    ``as_posix()``, not ``str()``: on Windows the latter yields ``api\\aesa.py``
    while every allowlist here is written with forward slashes, so no file
    matched its allowlist and the sweep flagged the entire package. Caught by
    Windows CI on the first run — and by ``test_the_sweep_finds_the_package``,
    which is why that test exists.
    """
    out = []
    for f in sorted(PKG.rglob("*.py")):
        out.append((f.relative_to(PKG).as_posix(), f.read_text(encoding="utf-8")))
    return out


def _strip_comments_and_docstrings(src: str) -> str:
    """Prose ABOUT the bug must not count as an instance of it.

    Crude but sufficient: drop triple-quoted blocks and `#` comments. The rules
    below match code shapes, and this file's own explanations live in prose.
    """
    src = re.sub(r'"""[\s\S]*?"""', '""', src)
    src = re.sub(r"'''[\s\S]*?'''", "''", src)
    return re.sub(r"#.*$", "", src, flags=re.MULTILINE)


# ── the rules ────────────────────────────────────────────────────────────────
#
# As on the frontend, the rule forbids ELEMENT-WISE ACCESS rather than
# enumerating accumulation idioms: `+=`, `sum(...)`, a `for` loop, a
# comprehension and `functools.reduce` are five spellings of one mistake, and
# none of them can be written without reaching individual years first.

ELEMENT_ACCESS: list[tuple[str, re.Pattern]] = [
    # cb.projected_emissions[y]
    ("index", re.compile(r"\.projected_emissions\s*\[")),
    # cb.projected_emissions.get(y, 0.0) / .items() / .values() / .keys()
    ("dict method", re.compile(r"\.projected_emissions\s*\.\s*(get|items|values|keys|pop)\b")),
    # for y in ... projected_emissions
    ("for-in", re.compile(r"\bfor\b[^\n]*\bin\b[^\n]*projected_emissions")),
]

#: ACCUMULATION — the narrower rule, enforced EVERYWHERE including the export.
#:
#: `api/aesa.py` legitimately ENUMERATES the pathway (it writes a year-by-year
#: table), so the element-access rules would flag it for doing its job. Summing
#: ACROSS years is never its job. Same split as the frontend guard, for the same
#: reason: where enumeration is legitimate, forbid the accumulation instead.
ACCUMULATION: list[tuple[str, re.Pattern]] = [
    ("sum()", re.compile(r"\bsum\s*\([^)]{0,200}?projected_emissions", re.S)),
    ("+= accumulator", re.compile(r"\+=\s*[\w.\[\]'\"]*projected_emissions")),
    ("functools.reduce", re.compile(r"reduce\s*\([^)]{0,200}?projected_emissions", re.S)),
]

#: Comparing a running total against the cap, in either direction, any operator.
CAP_COMPARE = re.compile(
    r"(>=|<=|>|<|==|!=)\s*[A-Za-z_][\w.]*\.initial_budget_gt"
    r"|[A-Za-z_][\w.]*\.initial_budget_gt\s*(>=|<=|>|<|==|!=)"
)

#: Re-deriving the per-year allocation instead of calling the method.
#:
#: Matches the DIVISION specifically — `/ (end_year - <anything>)` — not any
#: subtraction of `end_year`. A bare `end_year - start_year` is a horizon
#: LENGTH and appears legitimately (DSM's time horizon, this module's own
#: `deducted_years`); the allocation is the quotient. `\bend_year\b` keeps
#: `deduction_end_year` out.
ALLOCATION_DIVIDE = re.compile(r"/\s*\(?\s*(?:[\w]+\.)?\bend_year\b\s*-\s*")

#: Applying the CO2->CO2e factor by hand instead of `with_basis_applied()`.
#: `[\w.]` not `[A-Za-z_]`: a HARD-CODED factor (`* 1.4846`) is the worse
#: version of this mistake, and an identifier-only rule let it through.
MANUAL_BASIS_SCALE = re.compile(
    r"initial_budget_gt\s*\*\s*[\w.]"
    r"|co2e_ratio\(\)\s*\*"
    r"|\*\s*[A-Za-z_][\w.]*\.co2e_conversion\.factor"
)

#: Re-deriving the budget vintage from a literal instead of the data file.
HARDCODED_VINTAGE = re.compile(r"\bconsumed_2020_2024_gt\b|\bstart_year_reference\b")

# Files that legitimately touch `projected_emissions` as a WHOLE VALUE — never
# element-wise. Each is still run through the rules below, so allowlisting a
# file cannot smuggle an accumulation in beside the pass-through.
WHOLE_VALUE_OK = {
    "core/aesa_engine.py",   # builds the dict from the SSP anchors
}

# The export writes a per-year table, which is a legitimate ENUMERATION of the
# pathway — it reports every year, it does not accumulate across them. It must
# still call `remaining_budget` / `annual_global_allocation` for the numbers,
# which the dedicated test below asserts.
ENUMERATES_FOR_DISPLAY = {"api/aesa.py"}


def test_the_sweep_finds_the_package():
    """A guard that scans nothing passes forever.

    Every path this module names must RESOLVE against the sweep — not just the
    two module constants but each allowlist entry too. A path-separator
    mismatch makes them all miss silently, which on Windows turned the
    allowlists into no-ops and flagged the whole package.
    """
    srcs = _sources()
    assert len(srcs) > 20
    found = {rel for rel, _ in srcs}
    assert SCHEMA in found
    assert ENGINE in found
    for rel in WHOLE_VALUE_OK | ENUMERATES_FOR_DISPLAY:
        assert rel in found, (
            f"allowlist entry {rel!r} matches no swept file — the allowlist is "
            "a no-op (check path separators: paths are compared as POSIX)"
        )
    # And no swept path may carry a backslash, whatever platform this runs on.
    assert not any("\\" in rel for rel in found)


def test_the_rules_match_the_constructs_they_name():
    """Pure text matching over a moving codebase — assert the regexes still
    match their own examples, so the sweep can never pass vacuously."""
    corpus = {
        "index": "total += cb.projected_emissions[y]",
        "dict method": "v = cb.projected_emissions.get(y, 0.0)",
        "sum()": "consumed = sum(cb.projected_emissions[y] for y in years)",
        "for-in": "for y in cb.projected_emissions:",
    }
    for label, rx in ELEMENT_ACCESS:
        assert rx.search(corpus[label]), f"{label} rule no longer matches its own example"
    # A whole-value pass-through must not match.
    passthrough = "CarbonBudgetConfig(projected_emissions=pe, ssp_scenario=sid)"
    for label, rx in ELEMENT_ACCESS:
        assert not rx.search(passthrough), f"{label} rule flags a whole-value pass-through"

    acc_corpus = {
        "sum()": "consumed = sum(cb.projected_emissions.get(y, 0.0) for y in years)",
        "+= accumulator": "total += cb.projected_emissions[y]",
        "functools.reduce": "t = reduce(add, cb.projected_emissions.values())",
    }
    for label, rx in ACCUMULATION:
        assert rx.search(acc_corpus[label]), f"{label} rule no longer matches its own example"
    # Writing a per-year table is enumeration, not accumulation.
    enumeration = 'ws.append([y, cb.projected_emissions.get(y, 0.0), cb.remaining_budget(y)])'
    for label, rx in ACCUMULATION:
        assert not rx.search(enumeration), f"{label} rule flags per-year enumeration"

    for op in (">=", "<=", ">", "<", "==", "!="):
        assert CAP_COMPARE.search(f"if used {op} cb.initial_budget_gt:")
        assert CAP_COMPARE.search(f"if cb.initial_budget_gt {op} used:")
    assert ALLOCATION_DIVIDE.search("alloc = remaining / (self.end_year - year)")
    assert ALLOCATION_DIVIDE.search("a = (b - c) / (cb.end_year - cb.start_year)")
    # A horizon LENGTH is not an allocation, and neither is the vintage window.
    assert not ALLOCATION_DIVIDE.search("return self.end_year - self.start_year + 1")
    assert not ALLOCATION_DIVIDE.search("return self.deduction_end_year - self.reference_year + 1")
    assert MANUAL_BASIS_SCALE.search("b = cb.initial_budget_gt * f")
    assert MANUAL_BASIS_SCALE.search("b = cb.initial_budget_gt * 1.4846")
    assert MANUAL_BASIS_SCALE.search("scaled = v * cb.co2e_conversion.factor")
    assert HARDCODED_VINTAGE.search('raw["consumed_2020_2024_gt"]')


@pytest.mark.parametrize("label,rx", ELEMENT_ACCESS, ids=[r[0] for r in ELEMENT_ACCESS])
def test_only_the_schema_walks_projected_emissions(label, rx):
    bad = [
        rel for rel, src in _sources()
        if rel not in {SCHEMA} | WHOLE_VALUE_OK | ENUMERATES_FOR_DISPLAY
        and rx.search(_strip_comments_and_docstrings(src))
    ]
    assert bad == [], (
        f"{bad} walk projected_emissions ({label}) outside {SCHEMA}; call "
        "CarbonBudgetConfig.remaining_budget / .annual_global_allocation instead"
    )


@pytest.mark.parametrize("label,rx", ACCUMULATION, ids=[r[0] for r in ACCUMULATION])
def test_nothing_outside_the_schema_sums_across_years(label, rx):
    """Enforced everywhere — including `api/aesa.py`, which the element-access
    rules exempt for writing a per-year table."""
    bad = [rel for rel, src in _sources()
           if rel != SCHEMA and rx.search(_strip_comments_and_docstrings(src))]
    assert bad == [], (
        f"{bad} sum across projected_emissions ({label}); call "
        "CarbonBudgetConfig.remaining_budget, which sums [start_year, year) — "
        "EXCLUSIVE of `year`, the term every hand-rolled copy has got wrong"
    )


def test_the_allowlisted_files_really_only_pass_the_value_through():
    """Allowlisting a FILE would let a future accumulation in beside the
    legitimate use, so the allowlisted files are still checked."""
    for rel in WHOLE_VALUE_OK:
        src = _strip_comments_and_docstrings((PKG / rel).read_text(encoding="utf-8"))
        for label, rx in ELEMENT_ACCESS:
            if label == "for-in":
                continue   # aesa_engine interpolates the SSP anchors into the dict
            assert not rx.search(src), f"{rel} now does more than build the dict ({label})"


def test_nothing_compares_a_running_total_to_the_cap():
    bad = [rel for rel, src in _sources()
           if rel != SCHEMA and CAP_COMPARE.search(_strip_comments_and_docstrings(src))]
    assert bad == [], (
        f"{bad} compare against initial_budget_gt; the depletion year is "
        "`remaining_budget(y) <= 0`, which clamps — a raw comparison does not"
    )


def test_nothing_re_derives_the_per_year_allocation():
    bad = [rel for rel, src in _sources()
           if rel != SCHEMA and ALLOCATION_DIVIDE.search(_strip_comments_and_docstrings(src))]
    assert bad == [], (
        f"{bad} divide by (end_year - year); call annual_global_allocation(), "
        "which floors the divisor at 1"
    )


def test_nothing_applies_the_co2e_factor_by_hand():
    bad = [rel for rel, src in _sources()
           if rel != SCHEMA and MANUAL_BASIS_SCALE.search(_strip_comments_and_docstrings(src))]
    assert bad == [], (
        f"{bad} scale by the CO2e factor directly; call with_basis_applied(), "
        "which scales the budget AND the pathway together"
    )


def test_only_the_engine_reads_the_budget_vintage():
    bad = [rel for rel, src in _sources()
           if rel != ENGINE and HARDCODED_VINTAGE.search(_strip_comments_and_docstrings(src))]
    assert bad == [], (
        f"{bad} read the budget vintage directly; call carbon_budget_vintage() "
        "so the base year has one definition"
    )


def test_the_export_still_calls_the_methods_rather_than_re_deriving():
    """`api/aesa.py` is exempt from the enumeration rules because it writes a
    per-year table. That exemption is only safe while it takes its NUMBERS from
    the schema's methods, which is what this asserts."""
    src = _strip_comments_and_docstrings((PKG / "api" / "aesa.py").read_text(encoding="utf-8"))
    assert "cb.remaining_budget(y)" in src
    assert "cb.annual_global_allocation(y)" in src
    assert "with_basis_applied()" in src, (
        "the export must basis-apply via the schema method, not scale by hand"
    )
