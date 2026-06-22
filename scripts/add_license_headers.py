# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati
"""Idempotent MPL-2.0 license-header injector for MApper first-party source.

Prepends the SPDX identifier + MPL 2.0 boilerplate + DTU copyright notice to
every first-party ``.py / .ts / .tsx / .js / .jsx`` file. Re-runnable: files
that already carry the SPDX line are skipped. Python shebang / coding lines are
preserved (the header is inserted after them).

Usage:
    python scripts/add_license_headers.py            # inject (default)
    python scripts/add_license_headers.py --dry-run  # report only, no writes

See ``check_license_headers.py`` for the CI/verify-only counterpart.
"""
from __future__ import annotations

import sys
from pathlib import Path

SPDX = "SPDX-License-Identifier: MPL-2.0"

_BODY = [
    "This Source Code Form is subject to the terms of the Mozilla Public",
    "License, v. 2.0. If a copy of the MPL was not distributed with this",
    "file, You can obtain one at https://mozilla.org/MPL/2.0/.",
    "",
    "© Copyright 2026 Technical University of Denmark",
    "Lead developer: Leonardo Ferhati",
]

PY_HEADER = "\n".join([f"# {SPDX}"] + [f"# {line}".rstrip() for line in _BODY]) + "\n"
JS_HEADER = (
    f"/* {SPDX}\n"
    + "".join(f" * {line}".rstrip() + "\n" for line in _BODY)
    + " */\n"
)

PY_EXT = {".py"}
JS_EXT = {".ts", ".tsx", ".js", ".jsx"}
SOURCE_EXT = PY_EXT | JS_EXT

# Directory names skipped anywhere in the path (build outputs, deps, vendored,
# private notes, generated). C4MApper lives outside this repo but is listed
# defensively in case the tree is ever relocated.
SKIP_DIRS = {
    "node_modules", ".venv", "venv", "dist", "build", ".next", "target",
    "__pycache__", ".git", ".claude", "_reference", "C4MApper", ".pytest_cache",
    "data", "export",
}


def repo_root() -> Path:
    # scripts/ lives at the repo root.
    return Path(__file__).resolve().parent.parent


def iter_source_files(root: Path):
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        if path.suffix not in SOURCE_EXT:
            continue
        parts = set(path.relative_to(root).parts)
        if parts & SKIP_DIRS:
            continue
        if any(p.endswith(".egg-info") for p in path.relative_to(root).parts):
            continue
        yield path


def has_header(text: str) -> bool:
    # Idempotent guard: SPDX line within the first few lines.
    head = text.splitlines()[:6]
    return any(SPDX in line for line in head)


def _inject_python(text: str) -> str:
    lines = text.splitlines(keepends=True)
    prefix: list[str] = []
    i = 0
    # Preserve shebang and an optional PEP 263 coding line.
    if i < len(lines) and lines[i].startswith("#!"):
        prefix.append(lines[i])
        i += 1
    if i < len(lines) and ("coding:" in lines[i] or "coding=" in lines[i]) and lines[i].lstrip().startswith("#"):
        prefix.append(lines[i])
        i += 1
    rest = "".join(lines[i:])
    body = PY_HEADER + ("\n" if rest and not rest.startswith("\n") else "")
    return "".join(prefix) + body + rest


def _inject_js(text: str) -> str:
    body = JS_HEADER + ("\n" if text and not text.startswith("\n") else "")
    return body + text


def inject(path: Path) -> bool:
    """Return True if the file was modified."""
    text = path.read_text(encoding="utf-8")
    if has_header(text):
        return False
    new = _inject_python(text) if path.suffix in PY_EXT else _inject_js(text)
    path.write_text(new, encoding="utf-8")
    return True


def main() -> int:
    dry = "--dry-run" in sys.argv
    root = repo_root()
    changed = skipped = 0
    by_ext: dict[str, int] = {}
    for path in iter_source_files(root):
        text = path.read_text(encoding="utf-8")
        if has_header(text):
            skipped += 1
            continue
        if not dry:
            inject(path)
        changed += 1
        by_ext[path.suffix] = by_ext.get(path.suffix, 0) + 1
    verb = "would inject" if dry else "injected"
    print(f"{verb}: {changed}   already-present (skipped): {skipped}")
    for ext in sorted(by_ext):
        print(f"  {ext}: {by_ext[ext]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
