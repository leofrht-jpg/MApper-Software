# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Unit tests for :mod:`mapper.core.premise_engine`.

The actual premise library is mocked end-to-end — these tests only verify that
the engine dispatches to the right premise method for each mode, validates
inputs, and produces the expected :class:`GenerationResult` metadata.
"""
from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from mapper.core import premise_engine as pe


@pytest.fixture
def fake_ndb(monkeypatch):
    """Replace premise's NewDatabase + key loader with simple mocks."""
    ndb = MagicMock(name="NewDatabase")
    factory = MagicMock(name="NewDatabaseFactory", return_value=ndb)
    monkeypatch.setattr(pe, "NewDatabase", factory)
    monkeypatch.setattr(pe, "load_premise_key", lambda: b"fake-key")
    return factory, ndb


def _gen(years, mode, sdf_dir=None):
    return pe.ProspectiveDBGenerator(
        base_db="ecoinvent-3.10-cutoff",
        iam="remind",
        ssp="SSP2-Base",
        years=years,
        mode=mode,
        sdf_dir=sdf_dir,
    )


# ── Construction validation ───────────────────────────────────────────────────

def test_superstructure_requires_two_years():
    with pytest.raises(ValueError, match="at least two"):
        _gen([2025], mode="superstructure")


def test_unknown_mode_rejected():
    with pytest.raises(ValueError, match="mode must be"):
        _gen([2025, 2030], mode="bogus")  # type: ignore[arg-type]


def test_separate_mode_accepts_single_year():
    # baseline: old behavior must keep working
    gen = _gen([2025], mode="separate")
    assert gen.mode == "separate"
    assert gen.years == [2025]


# ── Dispatch: separate mode ───────────────────────────────────────────────────

def test_separate_mode_calls_write_db_to_brightway(fake_ndb):
    _, ndb = fake_ndb
    gen = _gen([2025, 2030], mode="separate")

    result = gen.generate()

    assert result.mode == "separate"
    assert result.sdf_path is None
    assert result.names == [
        "ecoinvent-3.10-cutoff_premise_remind_ssp2-base_2025",
        "ecoinvent-3.10-cutoff_premise_remind_ssp2-base_2030",
    ]
    ndb.write_db_to_brightway.assert_called_once_with(name=result.names)
    ndb.write_superstructure_db_to_brightway.assert_not_called()
    assert result.scenarios == [
        {"iam": "remind", "ssp": "SSP2-Base", "year": 2025},
        {"iam": "remind", "ssp": "SSP2-Base", "year": 2030},
    ]


# ── Dispatch: superstructure mode ─────────────────────────────────────────────

def test_superstructure_mode_calls_write_superstructure(fake_ndb, tmp_path: Path):
    _, ndb = fake_ndb
    gen = _gen([2025, 2030, 2035], mode="superstructure", sdf_dir=tmp_path / "sdfs")

    result = gen.generate()

    assert result.mode == "superstructure"
    expected_name = (
        "ecoinvent-3.10-cutoff_premise_remind_ssp2-base_superstructure_2025-2035"
    )
    assert result.names == [expected_name]
    ndb.write_superstructure_db_to_brightway.assert_called_once()
    kwargs = ndb.write_superstructure_db_to_brightway.call_args.kwargs
    assert kwargs["name"] == expected_name
    assert kwargs["file_format"] == "excel"
    assert Path(kwargs["filepath"]) == tmp_path / "sdfs"
    assert (tmp_path / "sdfs").is_dir()  # created on demand
    # premise will write the SDF under this path — engine records the expected location
    assert result.sdf_path == str(tmp_path / "sdfs" / f"scenario_diff_{expected_name}.xlsx")
    ndb.write_db_to_brightway.assert_not_called()


def test_superstructure_mode_dedupes_years(fake_ndb, tmp_path: Path):
    _, ndb = fake_ndb
    gen = _gen([2030, 2025, 2025, 2040], mode="superstructure", sdf_dir=tmp_path)
    result = gen.generate()
    assert result.scenarios == [
        {"iam": "remind", "ssp": "SSP2-Base", "year": 2025},
        {"iam": "remind", "ssp": "SSP2-Base", "year": 2030},
        {"iam": "remind", "ssp": "SSP2-Base", "year": 2040},
    ]


def test_superstructure_db_name_span_format():
    name = pe.superstructure_db_name("ecoinvent-3.10-cutoff", "remind", "SSP2-Base", [2030, 2025, 2050])
    assert name == "ecoinvent-3.10-cutoff_premise_remind_ssp2-base_superstructure_2025-2050"


def test_superstructure_db_name_single_year_span():
    # Helper accepts single-year lists even though the generator does not;
    # naming should degrade to "<year>" without a range separator.
    name = pe.superstructure_db_name("db", "remind", "SSP2-Base", [2030])
    assert name.endswith("_superstructure_2030")


# ── Fallback: superstructure write failure → separate mode ───────────────────


def test_superstructure_falls_back_to_separate_on_write_error(fake_ndb, tmp_path: Path):
    """If premise's superstructure export raises (e.g. biosphere flow lookup
    failure on ecoinvent 3.10), the engine should not crash — it should write
    per-year separate databases instead and mark the result with a warning."""
    _, ndb = fake_ndb
    ndb.write_superstructure_db_to_brightway.side_effect = KeyError(
        ("Ethyne", "air", "urban air close to ground", "kilogram")
    )
    gen = _gen([2025, 2030], mode="superstructure", sdf_dir=tmp_path)

    result = gen.generate()

    # Fallback: result should look like a separate-mode run.
    assert result.mode == "separate"
    assert result.names == [
        "ecoinvent-3.10-cutoff_premise_remind_ssp2-base_2025",
        "ecoinvent-3.10-cutoff_premise_remind_ssp2-base_2030",
    ]
    assert result.sdf_path is None
    assert result.fallback_warning is not None
    assert "Superstructure generation failed" in result.fallback_warning
    # ndb.update() was already called (via generate()); the fallback must NOT
    # re-run transformations — it reuses the same ndb and writes separate DBs.
    ndb.update.assert_called_once()
    ndb.write_superstructure_db_to_brightway.assert_called_once()
    ndb.write_db_to_brightway.assert_called_once_with(name=result.names)


def test_superstructure_success_sets_no_fallback_warning(fake_ndb, tmp_path: Path):
    _, ndb = fake_ndb
    gen = _gen([2025, 2030], mode="superstructure", sdf_dir=tmp_path)
    result = gen.generate()
    assert result.mode == "superstructure"
    assert result.fallback_warning is None
