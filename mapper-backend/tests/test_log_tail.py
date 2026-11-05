# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""The Logs panel reads the TAIL of the log, not every file in full.

``read_log_lines`` used to read the active file and every rotated sibling end to
end, decode and filter all of it, then slice off the last N lines -- every time
the panel opened. It now reads the end of the active file, the end of each
rotated sibling only while more lines are needed, and never more than
``_TAIL_MAX_BYTES`` in all.

The contract kept: the same lines come back, newest first, with the same level
filtering. ``total`` is unchanged: the exact count of matching lines over every
file, even when the cap on lines returned is hit.

The reference implementation below is the OLD one, copied verbatim, so these
tests compare against what the panel used to show rather than against the new
code's own idea of it.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from mapper.core import log_config
from mapper.core.log_config import _levels_at_or_above, _line_level


def _reference(paths, max_lines, level):
    """The pre-change implementation, over explicit paths (newest first)."""
    lines: list[str] = []
    for p in reversed(paths):
        with p.open("r", encoding="utf-8", errors="replace") as fh:
            lines.extend(line.rstrip("\n") for line in fh)
    if level:
        wanted = _levels_at_or_above(level)
        lines = [ln for ln in lines if _line_level(ln) in wanted]
    total = len(lines)
    if max_lines and max_lines > 0:
        lines = lines[-max_lines:]
    lines.reverse()
    return lines, total


def _entry(i: int, level: str = "INFO") -> str:
    return f"[2026-11-0{1 + i % 5} 10:{i % 60:02d}:00] [{level}] [mapper.test] entry {i} é ü 漢字"


def _write_log(base, *, newline="\n", rotated=2, per_file=40, trailing_newline=True):
    """Active log + rotated siblings, mixed levels, with traceback continuation lines.

    Returns the paths newest first: ``mapper.log`` holds the newest block and
    ``mapper.log.<rotated>`` the oldest.
    """
    levels = ["INFO", "WARNING", "ERROR", "DEBUG", "INFO", "CRITICAL"]
    n = 0
    blocks = []  # blocks[0] is the oldest
    for _ in range(rotated + 1):
        lines = []
        for _ in range(per_file):
            lines.append(_entry(n, levels[n % len(levels)]))
            if n % 7 == 3:
                lines.append("Traceback (most recent call last):")
                lines.append('  File "x.py", line 1, in <module>')
            n += 1
        blocks.append(lines)
    paths = []
    for age, lines in enumerate(reversed(blocks)):  # age 0 = newest = the active file
        target = base / ("mapper.log" if age == 0 else f"mapper.log.{age}")
        target.write_bytes((newline.join(lines) + (newline if trailing_newline else "")).encode("utf-8"))
        paths.append(target)
    return paths


@pytest.fixture()
def log_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(log_config, "LOG_FILE", tmp_path / "mapper.log")
    monkeypatch.setattr(log_config, "_BACKUP_COUNT", 3)
    return tmp_path


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("trailing", [True, False])
@pytest.mark.parametrize("max_lines", [1, 5, 40, 119, 200, 5000])
@pytest.mark.parametrize("level", [None, "INFO", "WARNING", "error", "CRITICAL"])
def test_same_lines_and_total_as_the_full_read(log_dir, newline, trailing, max_lines, level):
    paths = _write_log(log_dir, newline=newline, trailing_newline=trailing)
    want_lines, want_total = _reference(paths, max_lines, level)
    got_lines, got_total = log_config.read_log_lines(max_lines=max_lines, level=level)
    assert got_lines == want_lines
    # 2 newline styles x 2 trailing x 6 max_lines x 5 levels = 120 combinations:
    # N is the old implementation's total, exactly.
    assert got_total == want_total


def test_no_log_file_is_empty(log_dir):
    assert log_config.read_log_lines(10) == ([], 0)


def test_zero_max_lines_still_means_everything(log_dir):
    paths = _write_log(log_dir)
    assert log_config.read_log_lines(max_lines=0) == _reference(paths, 0, None)


def test_a_single_file_without_rotated_siblings(log_dir):
    paths = _write_log(log_dir, rotated=0, per_file=10)
    assert log_config.read_log_lines(3) == _reference(paths, 3, None)


# ── the window: what is read, and that it is never a cut line ────────────────


def _big_log(base, n_lines=4000):
    p = base / "mapper.log"
    p.write_bytes(("\n".join(_entry(i) for i in range(n_lines)) + "\n").encode("utf-8"))
    return p


def test_it_reads_at_most_the_cap_and_returns_the_last_lines(log_dir, monkeypatch):
    p = _big_log(log_dir)
    assert p.stat().st_size > 150_000
    monkeypatch.setattr(log_config, "_TAIL_MAX_BYTES", 20_000)

    read = []
    real = log_config._read_tail

    def spy(path, max_bytes):
        lines, used = real(path, max_bytes)
        read.append(used)
        return lines, used

    monkeypatch.setattr(log_config, "_read_tail", spy)
    got, total = log_config.read_log_lines(50)

    assert sum(read) <= 20_000, "read more than the cap"
    assert sum(read) < p.stat().st_size / 5, "the whole file was read"
    want, _ = _reference([p], 50, None)
    assert got == want
    # Only the tail was read, but N still counts the whole file.
    assert total == 4000


@pytest.mark.parametrize("cap", [1, 7, 200, 1999, 20_001, 33_333])
def test_a_cut_window_never_returns_a_partial_line(log_dir, monkeypatch, cap):
    p = _big_log(log_dir, 600)
    every = {ln for ln in p.read_text(encoding="utf-8").split("\n") if ln}
    monkeypatch.setattr(log_config, "_TAIL_MAX_BYTES", cap)
    got, _ = log_config.read_log_lines(5000)
    assert all(ln in every for ln in got), "a cut line was returned"
    full, _ = _reference([p], 5000, None)
    assert got == full[: len(got)], "not the newest lines, newest first"


def test_a_window_that_starts_exactly_on_a_line_start_keeps_that_line(log_dir, monkeypatch):
    p = log_dir / "mapper.log"
    p.write_bytes(b"[d] [INFO] [m] aaaa\n[d] [INFO] [m] bbbb\n[d] [INFO] [m] cccc\n")
    one = len(b"[d] [INFO] [m] cccc\n")
    monkeypatch.setattr(log_config, "_TAIL_MAX_BYTES", one)
    got, _ = log_config.read_log_lines(10)
    assert got == ["[d] [INFO] [m] cccc"]


def test_older_files_are_read_only_when_more_lines_are_needed(log_dir, monkeypatch):
    paths = _write_log(log_dir, per_file=30)
    opened = []
    real = log_config._read_tail
    monkeypatch.setattr(log_config, "_read_tail", lambda p, b: (opened.append(p.name), real(p, b))[1])
    log_config.read_log_lines(5)
    assert opened == ["mapper.log"], "a rotated file was read for 5 lines the active file has"
    opened.clear()
    got, _ = log_config.read_log_lines(100)  # more than the active file holds
    assert len(opened) > 1
    assert got == _reference(paths, 100, None)[0]


# ── through the route ─────────────────────────────────────────────────────


def test_route_returns_the_same_lines_for_a_fixture(log_dir, monkeypatch):
    from mapper.api import system as sys_api
    from mapper.main import app

    paths = _write_log(log_dir)
    monkeypatch.setattr(sys_api, "LOG_FILE", log_dir / "mapper.log")
    client = TestClient(app)
    for params, (lines, level) in [
        ("lines=7", (7, None)),
        ("lines=25&level=WARNING", (25, "WARNING")),
        ("lines=5000", (5000, None)),
    ]:
        r = client.get(f"/api/system/logs?{params}")
        assert r.status_code == 200, r.text
        body = r.json()
        want_lines, want_total = _reference(paths, lines, level)
        assert body["lines"] == want_lines
        assert body["total"] == want_total
        assert body["log_path"] == str(log_dir / "mapper.log")


@pytest.mark.parametrize("level", [None, "WARNING"])
def test_total_is_exact_when_the_cap_hides_older_files(log_dir, monkeypatch, level):
    paths = _write_log(log_dir, per_file=60)
    monkeypatch.setattr(log_config, "_TAIL_MAX_BYTES", 500)
    _, want_total = _reference(paths, 5, level)
    got, total = log_config.read_log_lines(5, level)
    assert total == want_total
    # The cap limits what is returned, never N: fewer lines, all of them the newest.
    assert got == _reference(paths, 5, level)[0][: len(got)]


@pytest.mark.parametrize("raw", [b"", b"\n", b"a", b"a\n", b"a\r", b"a\rb", b"a\r\nb\r\n", b"\n\n\r\r\n", b"a\r\n\rb"])
def test_line_count_matches_text_mode_iteration(log_dir, raw):
    p = log_dir / "x.log"
    p.write_bytes(raw)
    with p.open("r", encoding="utf-8", errors="replace") as fh:
        want = sum(1 for _ in fh)
    assert log_config._count_lines(p, None) == want
