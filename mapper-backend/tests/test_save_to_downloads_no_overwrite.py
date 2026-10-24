# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""A server-side save never replaces a same-named file in ~/Downloads.

The AESA export in the packaged app wrote over an earlier export of the same
name. Now the second gets " (1)", the third " (2)", before the extension; the
Logs save keeps its day-stamped name (overwrite=True).
"""
from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from openpyxl import Workbook

from mapper.api import aesa as aesa_api
from mapper.api.system import save_to_downloads, unused_name


@pytest.fixture
def downloads(tmp_path, monkeypatch):
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    d = tmp_path / "Downloads"
    d.mkdir()
    return d


def test_a_new_name_is_used_as_is(downloads, tmp_path):
    p = save_to_downloads(b"a", "Run_AESA.xlsx", fallback_dir=tmp_path)
    assert p == downloads / "Run_AESA.xlsx"


def test_repeats_are_numbered_and_the_first_file_is_kept(downloads, tmp_path):
    first = save_to_downloads(b"first", "Run_AESA.xlsx", fallback_dir=tmp_path)
    second = save_to_downloads(b"second", "Run_AESA.xlsx", fallback_dir=tmp_path)
    third = save_to_downloads(b"third", "Run_AESA.xlsx", fallback_dir=tmp_path)
    assert second.name == "Run_AESA (1).xlsx"
    assert third.name == "Run_AESA (2).xlsx"
    assert first.read_bytes() == b"first"
    assert second.read_bytes() == b"second"


def test_a_gap_is_not_refilled_over_a_later_number(downloads):
    (downloads / "a.xlsx").write_bytes(b"0")
    (downloads / "a (1).xlsx").write_bytes(b"1")
    assert unused_name(downloads / "a.xlsx").name == "a (2).xlsx"


def test_overwrite_keeps_the_name(downloads, tmp_path):
    save_to_downloads(b"old", "mapper_logs_2026-10-24.txt", fallback_dir=tmp_path, overwrite=True)
    p = save_to_downloads(b"new", "mapper_logs_2026-10-24.txt", fallback_dir=tmp_path, overwrite=True)
    assert p.name == "mapper_logs_2026-10-24.txt"
    assert p.read_bytes() == b"new"


def test_the_aesa_save_route_numbers_a_repeat_and_returns_the_final_name(downloads, monkeypatch):
    def tiny(_body):
        wb = Workbook()
        wb.active["A1"] = "x"
        return wb, "EV9_AESA.xlsx"
    monkeypatch.setattr(aesa_api, "_aesa_export_workbook", tiny)
    body = object()  # the route only hands it to the (patched) builder
    a = asyncio.run(aesa_api.post_export_save(body))  # type: ignore[arg-type]
    b = asyncio.run(aesa_api.post_export_save(body))  # type: ignore[arg-type]
    assert Path(a.path).name == "EV9_AESA.xlsx"
    assert Path(b.path).name == "EV9_AESA (1).xlsx"
    assert Path(a.path).exists() and Path(b.path).exists()
