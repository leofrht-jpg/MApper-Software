#!/usr/bin/env python3
"""Fail if the active environment has drifted from environment.yml.

A release artefact must be frozen against the pinned stack, and an IMPORT
CHECK DOES NOT DETECT DRIFT -- a drifted environment imports everything
perfectly well. The only way to catch it is to compare installed versions
against the pins.

Pins are PARSED from environment.yml rather than hard-coded here, so this
cannot go stale when a pin moves. Run it from the repository root:

    python scripts/verify_pins.py

Exit 0 when every pinned distribution matches, 1 otherwise.
"""
from __future__ import annotations

import importlib.metadata as md
import pathlib
import re
import sys

PIN = re.compile(r"([A-Za-z0-9_.\-]+)\s*(?:==|=)\s*([0-9][^\s#]*)")


def parse_pins(path: pathlib.Path) -> dict[str, str]:
    pins: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        s = line.strip().lstrip("-").strip()
        if not s or s.startswith("#"):
            continue
        m = PIN.fullmatch(s)
        if m:
            pins[m.group(1).lower()] = m.group(2)
    return pins


def main() -> int:
    root = pathlib.Path(__file__).resolve().parent.parent
    env_file = root / "environment.yml"
    if not env_file.is_file():
        print(f"environment.yml not found at {env_file}")
        return 1

    pins = parse_pins(env_file)
    if not pins:
        # A parse that finds nothing would pass vacuously, which is worse than
        # failing: it would report a clean environment without checking one.
        print("no pins parsed out of environment.yml -- refusing to pass vacuously")
        return 1

    failures: list[str] = []

    # python= is the interpreter, not an installed distribution.
    want_py = pins.pop("python", None)
    if want_py:
        got_py = ".".join(str(x) for x in sys.version_info[:3])
        ok = got_py.startswith(want_py)
        print(f"{'ok  ' if ok else 'FAIL'} {'python':22s} {got_py:14s} pinned {want_py}")
        if not ok:
            failures.append(f"python: running {got_py}, pinned {want_py}")

    checked = 0
    for name, want in sorted(pins.items()):
        try:
            got = md.version(name)
        except md.PackageNotFoundError:
            # Not every conda pin is an importable distribution (compilers,
            # system libs). Absence is not drift; a WRONG version is.
            print(f"skip {name:22s} (not an installed distribution)")
            continue
        checked += 1
        ok = got == want
        print(f"{'ok  ' if ok else 'FAIL'} {name:22s} {got:14s} pinned {want}")
        if not ok:
            failures.append(f"{name}: installed {got}, pinned {want}")

    if failures:
        print("\nEnvironment has drifted from environment.yml:")
        for f in failures:
            print(f"  {f}")
        print("\nA release must not be built from a drifted environment.")
        return 1

    print(f"\nall {checked} pinned distributions match environment.yml")
    return 0


if __name__ == "__main__":
    sys.exit(main())
