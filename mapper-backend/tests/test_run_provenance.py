"""A result records WHEN it was computed, and the exports read that.

Ten workbook builders stamped ``datetime.now()`` on a row labelled
"Calculation date" or "Generated". That is the EXPORT date: re-export last
week's result and the workbook claimed it was calculated today. A wrong date
in a file attached to a paper is worse than a missing one, and the builders
had nothing better to write because no result carried a compute stamp.

The two contribution results have carried ``computed_at`` + ``mapper_version``
since they shipped. This generalises that precedent rather than inventing a
second convention.
"""
from __future__ import annotations

import ast
import datetime
import pathlib

import pytest

from mapper.core.run_provenance import (
    NOT_RECORDED,
    format_computed_at,
    provenance_rows,
    stamp,
    utc_now_iso,
)

BACKEND = pathlib.Path(__file__).resolve().parents[1] / "mapper"


# ── the helper ──────────────────────────────────────────────────────────────

def test_stamp_is_utc_and_parseable():
    s = stamp()
    dt = datetime.datetime.fromisoformat(s["computed_at"])
    assert dt.tzinfo is not None, "the stamp must be timezone-aware"
    assert dt.utcoffset() == datetime.timedelta(0), "and it must be UTC"
    assert s["mapper_version"]


def test_an_old_result_says_not_recorded_and_NEVER_today():
    """The fallback IS the bug. A result computed before this shipped does not
    know when it ran, and saying so is the honest answer."""
    out = format_computed_at(None)
    assert out == NOT_RECORDED
    today = datetime.date.today().strftime("%Y-%m-%d")
    assert today not in out, "an unstamped result must not be dated today"

    rows = dict(provenance_rows(None, None))
    assert rows["Calculated"] == NOT_RECORDED
    assert rows["MApper version"] == NOT_RECORDED
    assert today not in "".join(rows.values())


def test_a_present_stamp_is_rendered_not_replaced():
    rows = dict(provenance_rows("2026-08-30T12:00:00+00:00", "0.1.9"))
    assert rows["Calculated"] == "2026-08-30 12:00 UTC"
    assert rows["MApper version"] == "0.1.9"


def test_an_unparseable_stamp_is_shown_verbatim():
    """Better to show a reader something odd than to silently drop it."""
    assert format_computed_at("whenever") == "whenever"


def test_a_naive_stamp_is_not_rejected():
    assert "2026-08-30" in format_computed_at("2026-08-30T12:00:00")


# ── the guard: no builder may reintroduce the export-time stamp ─────────────

def _provenance_now_sites() -> list[str]:
    """``datetime.now()`` CODE feeding a row labelled as a calculation date.

    AST, not a line grep: the first version matched ``run_provenance.py``'s own
    docstring, which DESCRIBES the defect. A detector that fires on the
    documentation of the bug it prevents is a detector bug -- exempting the
    module would have hidden the next real one in it.
    """
    out: list[str] = []
    for f in sorted(BACKEND.rglob("*.py")):
        src = f.read_text(encoding="utf-8")
        lines = src.splitlines()
        for n in ast.walk(ast.parse(src)):
            if not (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                    and n.func.attr == "now"):
                continue
            i = n.lineno
            window = " ".join(lines[max(0, i - 3): i + 1]).lower()
            if any(k in window for k in ("calculation date", '"generated"',
                                         "'generated'")):
                out.append(f"{f.relative_to(BACKEND).as_posix()}:{i}")
    return out


def test_no_builder_stamps_the_export_date_as_the_calculation_date():
    sites = _provenance_now_sites()
    assert not sites, (
        "These write the EXPORT time into a row a reader will take as the "
        "calculation date. Read the result's ``computed_at`` and render it "
        "with ``provenance_rows``; an unstamped result must say "
        f"'not recorded'.\n  " + "\n  ".join(sites)
    )


def test_the_guard_would_have_caught_the_original():
    """Anti-vacuity: the detector must fire on the shape that shipped."""
    import tempfile

    bad = (
        'rows = [\n'
        '    ("Scope", scope),\n'
        '    ("Calculation date", datetime.datetime.now().strftime("%Y-%m-%d")),\n'
        ']\n'
    )
    with tempfile.TemporaryDirectory() as d:
        p = pathlib.Path(d) / "probe.py"
        p.write_text(bad, encoding="utf-8")
        lines = bad.splitlines()
        hit = any(
            "datetime.now()" in l
            and "calculation date" in " ".join(lines[max(0, i - 2): i + 1]).lower()
            for i, l in enumerate(lines, start=1)
        )
    assert hit, "the detector does not fire on the original shape"


# ── every backend-produced result can carry the fields ──────────────────────

STAMPED = [
    ("mapper.models.bom_schemas", "ImpactAssessmentResult"),
    ("mapper.models.bom_schemas", "MultiScenarioProjectedImpactResult"),
    ("mapper.models.bom_schemas", "MaterialFlowResult"),
    ("mapper.models.schemas", "ArchetypeLCACalculateResult"),
    ("mapper.models.schemas", "ArchetypeTrajectoryResult"),
    ("mapper.models.schemas", "ActivityLCAResult"),
    ("mapper.models.schemas", "MultiProductLCAResult"),
    ("mapper.models.schemas", "MonteCarloResult"),
    ("mapper.models.schemas", "MonteCarloMultiResult"),
    ("mapper.models.schemas", "ContributionAnalysisResult"),
    ("mapper.models.schemas", "MultiYearContributionResult"),
]


@pytest.mark.parametrize("module,cls", STAMPED)
def test_every_result_model_carries_the_fields(module, cls):
    import importlib

    model = getattr(importlib.import_module(module), cls)
    fields = model.model_fields
    assert "computed_at" in fields, f"{cls} cannot record when it was computed"
    assert "mapper_version" in fields
    # Optional, so every OLD stored result still deserialises.
    assert fields["computed_at"].default is None
    assert fields["mapper_version"].default is None


def test_old_stored_results_still_deserialise():
    """Back-compat: a payload written before this shipped has neither field."""
    from mapper.models.schemas import ArchetypeLCACalculateResult

    r = ArchetypeLCACalculateResult(
        archetype_id="a", archetype_name="A", scope="all", results=[],
        amount=1.0, stages_included=[],
    )
    assert r.computed_at is None and r.mapper_version is None


# ── the multipliers ─────────────────────────────────────────────────────────

def test_basis_amounts_is_echoed_beside_stage_amounts():
    """It is load-bearing on the NUMBER -- ``flatten_root_with_amounts`` uses
    it as the per-unit/per-year multiplier, so a lifetime-15 run and a 1-year
    run differ 15x on the annual stages. Its companion was already echoed."""
    from mapper.models.schemas import ArchetypeLCACalculateResult, MonteCarloResult

    for model in (ArchetypeLCACalculateResult, MonteCarloResult):
        assert "basis_amounts" in model.model_fields, model.__name__
        assert "use_phase_basis" in model.model_fields, (
            f"{model.__name__}: the multiplier alone is ambiguous -- "
            "``life_cycle`` means it does not apply at all"
        )


def test_the_multi_monte_carlo_matches_its_sibling():
    """The paired path SAMPLES the foreground, so it must record what was
    scored -- otherwise it is unreproducible in the mode where the scoring
    decides the answer."""
    from mapper.models.schemas import MonteCarloMultiResult, MonteCarloResult

    single = set(MonteCarloResult.model_fields)
    multi = set(MonteCarloMultiResult.model_fields)
    required = {
        "scored_inputs", "rows_with_uncertainty", "rows_inherited",
        "parameters_with_uncertainty", "stage_amounts", "basis_amounts",
        "use_phase_basis", "computed_at", "mapper_version", "seed",
        "n_iterations",
    }
    missing = required - multi
    assert not missing, f"multi-MC is missing: {sorted(missing)}"
    assert required <= single, "the single-item sibling regressed"


# ── adapters carry through; they do not re-stamp ────────────────────────────

def test_the_aesa_adapters_carry_the_stamp_through():
    """They RESHAPE an already-computed result. Stamping ``now()`` there is
    the same defect as the exports stamping the export date -- the adapted
    result would claim to have been computed when it was reshaped."""
    src = (BACKEND / "core" / "aesa_engine.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    for fn_name in ("single_product_to_impact_result",
                    "prospective_single_product_to_impact_result"):
        fn = next(n for n in ast.walk(tree)
                  if isinstance(n, ast.FunctionDef) and n.name == fn_name)
        body = ast.unparse(fn)
        assert "_run_stamp()" not in body, (
            f"{fn_name} stamps a fresh time -- it is an adapter, not a compute"
        )
        assert "computed_at=" in body, f"{fn_name} drops the stamp entirely"
