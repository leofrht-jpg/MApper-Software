# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati
"""Verify-only MPL-2.0 header coverage of MApper first-party source.

Exits non-zero (and lists the offenders) if any first-party
``.py / .ts / .tsx / .js / .jsx`` file is missing the SPDX header. Same
discovery + skip-list as ``add_license_headers.py``. Intended for CI and the
public-release verification step.

Usage:
    python scripts/check_license_headers.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from add_license_headers import has_header, iter_source_files, repo_root  # noqa: E402


def main() -> int:
    root = repo_root()
    total = 0
    missing: list[Path] = []
    for path in iter_source_files(root):
        total += 1
        if not has_header(path.read_text(encoding="utf-8")):
            missing.append(path.relative_to(root))
    covered = total - len(missing)
    pct = 100.0 if total == 0 else covered / total * 100.0
    print(f"License-header coverage: {covered}/{total} ({pct:.1f}%) first-party source files")
    if missing:
        print("MISSING header:")
        for m in missing:
            print(f"  {m}")
        return 1
    print("All first-party source files carry the MPL-2.0 header. ✓")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
