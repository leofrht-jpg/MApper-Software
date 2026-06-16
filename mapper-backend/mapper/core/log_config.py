"""Rotating file logger used for the Settings → Logs viewer.

A single log file is shared by every module. The log path is derived from the
platform's user-log directory so it survives across runs and doesn't pollute
the repo.
"""
from __future__ import annotations

import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

import platformdirs


LOG_DIR = Path(platformdirs.user_log_dir("mapper"))
LOG_FILE = LOG_DIR / "mapper.log"

_FILE_FORMAT = "[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s"
_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"
_MAX_BYTES = 1_000_000  # 1 MB
_BACKUP_COUNT = 3

_configured = False


def configure_logging() -> Path:
    """Install a rotating file handler on the root logger.

    Safe to call multiple times; subsequent calls are no-ops. Returns the
    resolved log file path so callers can show it in the UI.
    """
    global _configured
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
    # Ensure root level lets INFO through even if basicConfig set something higher.
    if root.level > logging.INFO or root.level == logging.NOTSET:
        root.setLevel(logging.INFO)

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
