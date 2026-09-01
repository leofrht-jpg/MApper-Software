"""When a result was computed, and by which MApper.

Two fields, stamped at COMPUTE time and carried on the result:

``computed_at``     ISO-8601 UTC
``mapper_version``  the running backend version

They exist because the exports had nothing better to write. Ten workbook
builders stamped ``datetime.now()`` on a row labelled "Calculation date" or
"Generated", so re-exporting last week's result produced a workbook claiming
it was calculated today. That is worse than omitting it: a wrong date in a
file attached to a paper reads as fact.

**An OLD stored result has ``None``, and a builder must write "not recorded"
rather than falling back to ``now()``.** The fallback IS the bug. A result
computed before this shipped genuinely does not know when it ran, and saying
so is the honest answer; substituting today's date reintroduces exactly the
defect at the one place it is hardest to notice.

The two contribution results have carried these fields since they shipped
(``ContributionAnalysisResult.to_persistable_dict`` is the documented
"archive this for paper reproducibility" shape). This module generalises that
precedent to every result model rather than inventing a second convention.

**Stamp the innermost BACKEND-produced result; envelopes derive.**
``MultiParamImpactResult``, ``MultiDSMImpactResult`` and
``MultiPairedImpactResult`` are assembled by the frontend from per-task
results — they are constructed nowhere in the backend. Trusting a client to
supply a compute timestamp would make the field unverifiable at exactly the
point it is load-bearing, so those envelopes read it off the inner
``ImpactAssessmentResult`` they already carry.
"""
from __future__ import annotations

import datetime

#: What a builder writes when the result predates this field. Never ``now()``.
NOT_RECORDED = "not recorded (computed before MApper recorded run provenance)"


def utc_now_iso() -> str:
    """The compute-time stamp. UTC, ISO-8601, timezone-aware."""
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def mapper_version() -> str:
    """The running backend version, from the single source of truth."""
    from mapper import __version__

    return __version__


def stamp() -> dict[str, str]:
    """``{"computed_at": ..., "mapper_version": ...}`` for a result kwargs dict."""
    return {"computed_at": utc_now_iso(), "mapper_version": mapper_version()}


def format_computed_at(value: str | None) -> str:
    """Render ``computed_at`` for a workbook cell.

    ``None`` -> the explicit not-recorded note, never today's date.
    """
    if not value:
        return NOT_RECORDED
    try:
        dt = datetime.datetime.fromisoformat(value)
    except ValueError:
        return value          # unparseable but present: show it verbatim
    if dt.tzinfo is not None:
        dt = dt.astimezone(datetime.timezone.utc)
    return dt.strftime("%Y-%m-%d %H:%M UTC")


def format_version(value: str | None) -> str:
    return value or NOT_RECORDED


def provenance_rows(
    computed_at: str | None, version: str | None
) -> list[tuple[str, str]]:
    """The two rows every workbook Configuration/Summary block carries."""
    return [
        ("Calculated", format_computed_at(computed_at)),
        ("MApper version", format_version(version)),
    ]


def use_phase_basis(project: str | None = None) -> str | None:
    """The project's use-phase basis convention at COMPUTE time.

    ``basis_amounts`` alone is ambiguous: under ``life_cycle`` the BOM already
    holds whole-life quantities and the multiplier does not apply at all, so a
    result carrying ``{"per_year": 15}`` means different things under the two
    conventions. Recording the convention beside the multiplier is what makes
    the pair readable.
    """
    try:
        from mapper.api.project_settings import resolve

        return resolve(project).use_phase_basis
    except Exception:
        # Provenance must never be the thing that fails a compute.
        return None
