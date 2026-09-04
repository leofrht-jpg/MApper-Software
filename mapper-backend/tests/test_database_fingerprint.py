"""A weak, honest fingerprint of the databases and LCIA methods a run used.

``compute_database`` is a mutable string, premise regenerates databases IN
PLACE, and the Method Library installs and uninstalls methods at runtime -- so
a result named things that could point at different content than they did at
compute time, and nothing detected it.

A FULL CHECKSUM IS NOT VIABLE: the MAp-test project directory is 40.85 GB.
This is the weaker thing that is actually computable -- measured at 0.02 ms
for all 38 databases -- and the tests below pin what it does NOT detect as
carefully as what it does. A fingerprint that overstates itself is worse than
none, because it converts "we do not know" into a false assurance.
"""
from __future__ import annotations

import pytest

from mapper.core.database_fingerprint import (
    FINGERPRINT_VERSION,
    LIMITS_NOTE,
    fingerprint,
    mismatch_rows,
)


def _fp(dbs=None, methods=None):
    return {
        "version": FINGERPRINT_VERSION,
        "databases": dbs or {},
        "methods": methods or {},
    }


# ── what it detects ─────────────────────────────────────────────────────────

def test_a_regenerated_database_is_detected():
    """The case this exists for: premise rewrites a database IN PLACE, so the
    name is unchanged and ``modified`` moves."""
    stored = _fp({"ei_premise_2030": {"number": 30755, "modified": "2026-04-24T11:25:04"}})
    current = _fp({"ei_premise_2030": {"number": 30755, "modified": "2026-09-01T08:00:00"}})
    rows = mismatch_rows(stored, current)
    assert len(rows) == 1
    assert "ei_premise_2030" in rows[0][0]
    assert "last modified" in rows[0][1]


def test_a_swapped_database_is_detected_by_count():
    stored = _fp({"ei": {"number": 23523, "modified": "t"}})
    current = _fp({"ei": {"number": 19000, "modified": "t"}})
    rows = mismatch_rows(stored, current)
    assert rows and "activity count" in rows[0][1]


def test_a_reinstalled_method_is_detected_by_its_registration_id():
    """The Method Library case: uninstall + reinstall mints a new
    abbreviation."""
    stored = _fp(methods={"EF v3.1 | climate change": {
        "num_cfs": 223, "abbreviation": "ef-v31cg.1c397559135d78f19a1915a0ca4f626a"}})
    current = _fp(methods={"EF v3.1 | climate change": {
        "num_cfs": 223, "abbreviation": "ef-v31cg.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}})
    rows = mismatch_rows(stored, current)
    assert rows and "registration id" in rows[0][1]


def test_a_deleted_database_is_named_rather_than_crashing():
    rows = mismatch_rows(_fp({"gone": {"number": 1, "modified": "t"}}), _fp())
    assert rows and "not installed" in rows[0][1]


# ── what it does NOT detect: pinned, so nobody over-claims ──────────────────

def test_a_count_preserving_CF_edit_is_INVISIBLE():
    """``num_cfs`` is a count. A factor edited in place does not move it, and
    the docstring says so."""
    same = {"num_cfs": 223, "abbreviation": "ef-v31cg.abc"}
    assert mismatch_rows(_fp(methods={"m": same}), _fp(methods={"m": dict(same)})) == []


def test_a_count_preserving_database_edit_is_INVISIBLE_unless_saved():
    """``modified`` moves only when bw2 SAVES. This is regeneration detection,
    not tamper detection."""
    same = {"number": 23523, "modified": "2026-04-14T16:48:54"}
    assert mismatch_rows(_fp({"ei": same}), _fp({"ei": dict(same)})) == []


def test_the_limits_note_states_all_three_limits():
    """It travels with every printed fingerprint, because a reader of an
    exported file cannot see the docstring."""
    low = LIMITS_NOTE.lower()
    assert "regeneration, not tampering" in low
    assert "preserves the count" in low
    assert "registration, not content" in low
    assert "not evidence" in low


def test_the_module_does_not_call_the_abbreviation_a_content_hash():
    """It is bw2's persisted registration id. Two obvious derivations were
    checked and rejected; describing it as content-derived would be a false
    assurance."""
    import pathlib

    src = (pathlib.Path(__file__).resolve().parents[1]
           / "mapper" / "core" / "database_fingerprint.py").read_text(encoding="utf-8")
    lowered = src.lower()
    assert "registration, not content" in lowered
    for claim in ("content hash of the method", "hash of the method content",
                  "content-derived identifier"):
        assert claim not in lowered, f"over-claims: {claim!r}"


# ── behaviour ───────────────────────────────────────────────────────────────

def test_absent_is_not_a_mismatch():
    """Every result stored before this shipped has no fingerprint."""
    assert mismatch_rows(None, _fp({"ei": {"number": 1, "modified": "t"}})) == []
    assert mismatch_rows(_fp(), None) == []


def test_a_version_difference_is_not_reported_as_a_content_change():
    stored = dict(_fp({"ei": {"number": 1, "modified": "t"}}), version="0")
    rows = mismatch_rows(stored, _fp({"ei": {"number": 2, "modified": "u"}}))
    assert len(rows) == 1 and "scheme changed" in rows[0][0].lower()
    assert "activity count" not in rows[0][1]


def test_fingerprinting_never_raises():
    """Provenance must never be the thing that fails a compute."""
    out = fingerprint(["definitely-not-installed", None], [("nope", "nope")])
    assert out["databases"] == {} and out["methods"] == {}
    assert out["version"] == FINGERPRINT_VERSION


def test_an_uninstalled_name_is_skipped_not_reported():
    """Absent from THIS project is not the same as changed."""
    out = fingerprint(["definitely-not-installed"], [])
    assert "definitely-not-installed" not in out["databases"]


# ── against the real project ────────────────────────────────────────────────

def _bw2_ready():
    try:
        import bw2data
    except ImportError:
        return False
    return bool([d for d in bw2data.databases if "biosphere" not in d.lower()])


@pytest.mark.skipif(not _bw2_ready(), reason="no technosphere databases")
def test_it_reads_what_bw2_actually_stores():
    import bw2data

    db = next(d for d in bw2data.databases if "biosphere" not in d.lower())
    out = fingerprint([db], [])
    entry = out["databases"][db]
    assert isinstance(entry["number"], int) and entry["number"] > 0
    assert entry["modified"], "bw2 records a modified timestamp"
    # Self-comparison is silent -- the baseline for every other assertion.
    assert mismatch_rows(out, fingerprint([db], [])) == []
