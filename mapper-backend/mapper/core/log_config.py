# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Rotating file logger used for the Settings → Logs viewer.

A single log file is shared by every module. The log path is derived from the
platform's user-log directory so it survives across runs and doesn't pollute
the repo.
"""
from __future__ import annotations

import logging
import os
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

import platformdirs


#: ``MAPPER_LOG_DIR`` overrides the platform log directory. The test suite sets
#: it so a run never writes into the user's real mapper.log -- it used to, about
#: 6,000 lines of fake requests and planted "a real error" lines that then
#: showed up in Settings > Logs and in exported logs.
LOG_DIR = Path(os.environ.get("MAPPER_LOG_DIR") or platformdirs.user_log_dir("mapper"))
LOG_FILE = LOG_DIR / "mapper.log"

_FILE_FORMAT = "[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s"
_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"
_MAX_BYTES = 1_000_000  # 1 MB
_BACKUP_COUNT = 3

_configured = False


#: Libraries whose INFO lines are per-call progress chatter. bw2calc logs
#: "Switching LCIA method" and "Redoing LCIA" on EVERY characterisation, so one
#: multi-indicator run wrote thousands of lines (4,529 in one user's log) and
#: buried everything else in Settings › Logs. Raised to WARNING: their warnings
#: and errors still come through.
QUIET_INFO_LOGGERS = ("bw2calc",)


def quiet_chatty_libraries() -> None:
    for name in QUIET_INFO_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)


def reenable_mapper_loggers() -> list[str]:
    """Re-enable every ``mapper.*`` logger a third-party library disabled.

    ``premise/transformation.py`` calls ``logging.config.dictConfig(...)`` at
    import with the default ``disable_existing_loggers=True``, which silently
    disables every logger that existed before it -- including MApper's own
    (``mapper.core.dsm_lca_engine`` among them, so its warnings and the
    prospective-run summary never reached mapper.log in a process that imported
    premise after it). Returns the names it re-enabled.
    """
    out = []
    for name, lg in list(logging.root.manager.loggerDict.items()):
        if (name == "mapper" or name.startswith("mapper.")) and isinstance(lg, logging.Logger) and lg.disabled:
            lg.disabled = False
            out.append(name)
    return out


#: premise's ``inventory_imports`` calls ``logging.basicConfig(level=DEBUG,
#: filename="unlinked.log", filemode="a")`` at import. premise is imported (via
#: the routers) before MApper configures logging, so that call wins: the ROOT
#: logger gets a plain FileHandler with no level at DEBUG, and every library's
#: debug output lands in ``unlinked.log`` in the working directory (the
#: packaged app's ``workspace/``), forever, unrotated -- 1.7 GB on one machine.
#: premise's own warnings about unlinked flows are WARNING and above, so those
#: still reach the file.
PREMISE_UNLINKED_LOG = "unlinked.log"


def cap_premise_unlinked_log() -> list[logging.Handler]:
    """Hold premise's root ``unlinked.log`` handler to WARNING, root to INFO.

    Never deletes, truncates or closes the file: an existing log stays as it
    is, it just stops growing with debug chatter. Returns the handlers capped.
    """
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    capped = []
    for h in root.handlers:
        name = getattr(h, "baseFilename", "") or ""
        if isinstance(h, logging.FileHandler) and Path(name).name == PREMISE_UNLINKED_LOG:
            h.setLevel(logging.WARNING)
            capped.append(h)
    return capped


def configure_logging() -> Path:
    """Install a rotating file handler on the root logger.

    Safe to call multiple times; subsequent calls are no-ops. Returns the
    resolved log file path so callers can show it in the UI.
    """
    global _configured
    quiet_chatty_libraries()
    # The app's routers (and with them premise) are imported before this runs.
    reenable_mapper_loggers()
    cap_premise_unlinked_log()
    if _configured:
        return LOG_FILE

    LOG_DIR.mkdir(parents=True, exist_ok=True)

    file_handler = RotatingFileHandler(
        LOG_FILE,
        maxBytes=_MAX_BYTES,
        backupCount=_BACKUP_COUNT,
        encoding="utf-8",
    )
    file_handler.setLevel(logging.INFO)
    file_handler.setFormatter(logging.Formatter(_FILE_FORMAT, datefmt=_DATE_FORMAT))

    root = logging.getLogger()

    # Avoid duplicate file handlers if reload picks us up twice.
    for h in root.handlers:
        if isinstance(h, RotatingFileHandler) and Path(h.baseFilename) == LOG_FILE:
            _configured = True
            return LOG_FILE
    root.addHandler(file_handler)

    # Route unhandled exceptions through logging so they land in mapper.log
    # with a full traceback rather than dying silently on stderr.
    def _excepthook(exc_type, exc_value, exc_tb):
        if issubclass(exc_type, KeyboardInterrupt):
            sys.__excepthook__(exc_type, exc_value, exc_tb)
            return
        logging.getLogger("mapper.unhandled").critical(
            "Unhandled exception", exc_info=(exc_type, exc_value, exc_tb)
        )

    sys.excepthook = _excepthook

    _configured = True
    return LOG_FILE


def read_log_lines(max_lines: int = 200, level: str | None = None) -> tuple[list[str], int]:
    """Return the most recent ``max_lines`` entries from the active log file,
    **newest first**.

    ``level`` filters to entries at or above the given level (case-insensitive).
    The filter is line-prefix based — fine for our ``[LEVEL]`` format.
    Returns ``(lines, total_matching)``.
    """
    if not LOG_FILE.is_file():
        return [], 0

    # Include rotated siblings so a freshly rotated file doesn't appear empty.
    paths = [LOG_FILE]
    for i in range(1, _BACKUP_COUNT + 1):
        p = LOG_FILE.with_name(f"{LOG_FILE.name}.{i}")
        if p.is_file():
            paths.append(p)

    lines: list[str] = []
    # Oldest rotated file first, so the active log comes last (chronological).
    for p in reversed(paths):
        try:
            with p.open("r", encoding="utf-8", errors="replace") as fh:
                lines.extend(line.rstrip("\n") for line in fh)
        except OSError:
            continue

    if level:
        wanted = _levels_at_or_above(level)
        lines = [ln for ln in lines if _line_level(ln) in wanted]

    total = len(lines)
    if max_lines and max_lines > 0:
        lines = lines[-max_lines:]
    # Newest-first for the in-app viewer.
    lines.reverse()
    return lines, total


_LEVEL_ORDER = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]


def _levels_at_or_above(level: str) -> set[str]:
    up = level.upper()
    if up == "WARN":
        up = "WARNING"
    if up not in _LEVEL_ORDER:
        return set(_LEVEL_ORDER)
    idx = _LEVEL_ORDER.index(up)
    return set(_LEVEL_ORDER[idx:])


def _line_level(line: str) -> str:
    # Format is: [date] [LEVEL] [module] message
    # Pull out the second bracketed token.
    try:
        first = line.index("] [")
        start = first + 3
        end = line.index("]", start)
        return line[start:end].upper()
    except ValueError:
        return ""
