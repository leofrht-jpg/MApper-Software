# SPDX-License-Identifier: MPL-2.0
"""Every route that launches a background worker must have a test that REACHES
the launch.

This rule is written in CLAUDE.md twice and was walked into twice, most
recently as a 500 on every ``POST /lca/monte-carlo`` call that shipped to a
packaged build. Prose was not holding it, so it is a test.

THE SHAPE OF THE BUG IT CATCHES. A worker-launching route validates, then
launches. Tests that only exercise the 4xx paths -- missing methods, bad
iteration count, unknown id -- all return BEFORE the launch, so the launch line
is never executed and a wiring error there is invisible. That is exactly how
``run_in_thread(work)`` (wrong arity for that helper) reached a build: the
sampling was tested directly and correctly, the wiring was never run.

HOW COVERAGE IS MEASURED. Not by reading tests, which is what let this through.
The launch sites are discovered from source, then the module's own tests run
with ``threading.Thread.start`` instrumented, and a site counts as covered only
if it appears in a real call stack. Attribution walks the FULL stack rather
than the innermost frame: a ``run_in_thread`` caller sits several frames up,
and anyio's threadpool (``await file.read()`` in an upload route) starts
threads that are not ours and must not be mistaken for coverage.
"""

from __future__ import annotations

import ast
import json
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
API = BACKEND / "mapper" / "api"

#: Sites with no test reaching them, each with the reason it is not worth one
#: YET. Every entry is a real gap, not an exemption on principle -- the point of
#: the list is that shrinking it is visible and growing it needs a sentence.
#: Covered ONLY where a bw2 technosphere exists. Their tests skip in CI, so
#: from the environment that gates merges they read as uncovered. Kept separate
#: from KNOWN_UNCOVERED because they are not gaps -- they are measurements the
#: CI environment cannot make. Discovered the hard way: the guard passed
#: locally and failed in CI on exactly this.
ENV_DEPENDENT: dict[str, str] = {
    "lca.py:start_multi_year_contribution":
        "reached by tests/test_contribution_multi_year.py, which skip without a "
        "technosphere database",
}

KNOWN_UNCOVERED: dict[str, str] = {
    "ecoinvent.py:start_import":
        "needs a live ecoinvent archive + credentials; no fixture exists",
    "ecoinvent.py:start_local_import":
        "needs a real 7z/spold archive on disk",
    "lcia_methods.py:post_install":
        "downloads a .bw2package from Zenodo",
    "lcia_methods.py:post_install_custom":
        "needs a user-supplied .xlsx",
    "lca.py:calculate_lca":
        "legacy single-year LCA; needs a bw2 technosphere",
    "plca.py:post_generate":
        "runs premise against an IAM scenario; minutes of compute and a key",
}


def _launch_sites() -> dict[str, tuple[Path, int]]:
    """Route handlers that start a background worker, by ``file.py:handler``."""
    sites: dict[str, tuple[Path, int]] = {}
    for f in sorted(API.glob("*.py")):
        tree = ast.parse(f.read_text())
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            launch_line = None
            for sub in ast.walk(node):
                if not isinstance(sub, ast.Call):
                    continue
                fn = sub.func
                # threading.Thread(...).start()
                if isinstance(fn, ast.Attribute) and fn.attr == "start":
                    inner = fn.value
                    if isinstance(inner, ast.Call):
                        tgt = inner.func
                        name = tgt.attr if isinstance(tgt, ast.Attribute) else getattr(tgt, "id", "")
                        if name == "Thread":
                            launch_line = sub.lineno
                # run_in_thread(...)
                if isinstance(fn, ast.Name) and fn.id == "run_in_thread":
                    launch_line = sub.lineno
                if isinstance(fn, ast.Attribute) and fn.attr == "run_in_thread":
                    launch_line = sub.lineno
            if launch_line is not None:
                sites[f"{f.name}:{node.name}"] = (f, launch_line)
    return sites


def test_the_discovery_finds_the_known_launch_sites():
    """Anti-vacuity: an empty or shrunken site list would make the guard pass
    while covering nothing."""
    sites = _launch_sites()
    assert len(sites) >= 8, f"expected the known worker routes, found {sorted(sites)}"
    # The one that shipped broken, and the one that is the same shape.
    assert "monte_carlo.py:post_monte_carlo" in sites
    assert "impact.py:post_calculate" in sites


def test_every_worker_launch_is_either_covered_or_declared():
    """The guard. A new worker-launching route with no test reaching its launch
    fails here, naming itself."""
    sites = _launch_sites()
    undeclared = sorted(
        set(sites) - set(KNOWN_UNCOVERED) - set(ENV_DEPENDENT) - set(_covered_sites())
    )
    assert not undeclared, (
        "these routes launch a background worker but no test reaches the launch, "
        "and they are not declared in KNOWN_UNCOVERED: "
        + ", ".join(undeclared)
        + ". Add a test that drives the route past its validation returns, or "
        "declare it with the reason it cannot be tested yet."
    )


def test_declared_gaps_are_still_gaps():
    """A declared gap that has since gained coverage must leave the list, or it
    rots into a permanent exemption."""
    covered = set(_covered_sites())
    stale = sorted(covered & set(KNOWN_UNCOVERED))
    assert not stale, (
        "these are declared uncovered but a test now reaches them; "
        "remove them from KNOWN_UNCOVERED: " + ", ".join(stale)
    )


# ── measuring coverage ────────────────────────────────────────────────────────

_CACHE: list[str] | None = None


def _covered_sites() -> list[str]:
    """Run the suite with thread starts instrumented; return the sites reached.

    Cached per session: the subprocess runs the whole suite once.
    """
    global _CACHE
    if _CACHE is not None:
        return _CACHE

    sites = _launch_sites()
    spec = {k: f"{v[0].name}:{v[1]}" for k, v in sites.items()}
    probe = BACKEND / "launch_probe.py"
    out = BACKEND / ".launch_hits.json"
    probe.write_text(_PROBE_SRC.replace("__SPEC__", json.dumps(spec)).replace("__OUT__", str(out)))
    try:
        subprocess.run(
            [sys.executable, "-m", "pytest", "tests/", "-q", "-p", "launch_probe",
             "--ignore=tests/test_worker_launch_coverage.py"],
            cwd=BACKEND,
            env={**_env(), "PYTHONPATH": str(BACKEND), "MAPPER_LAUNCH_PROBE": "1"},
            capture_output=True, timeout=900,
        )
        _CACHE = sorted(json.loads(out.read_text())) if out.exists() else []
    finally:
        probe.unlink(missing_ok=True)
        out.unlink(missing_ok=True)
    return _CACHE


def _env() -> dict:
    import os
    return dict(os.environ)


_PROBE_SRC = '''
import threading, traceback, json
SPEC = __SPEC__
OUT = r"__OUT__"
BY_LINE = {v: k for k, v in SPEC.items()}
HITS = set()
_orig = threading.Thread.start
def _patched(self):
    # FULL stack, not the innermost frame: a run_in_thread caller sits several
    # frames up, and anyio's threadpool starts threads that are not ours.
    for fr in traceback.extract_stack():
        if "/mapper/api/" not in fr.filename:
            continue
        key = BY_LINE.get(f"{fr.filename.split('/')[-1]}:{fr.lineno}")
        if key:
            HITS.add(key)
    if HITS:
        try:
            with open(OUT, "w") as fh: json.dump(sorted(HITS), fh)
        except Exception: pass
    return _orig(self)
threading.Thread.start = _patched
'''


@pytest.mark.parametrize(
    "site",
    [
        "monte_carlo.py:post_monte_carlo",
        # Every Sustainability Ratio comes through this one, and it is the same
        # shape as the route that shipped dead.
        "impact.py:post_calculate",
    ],
)
def test_the_load_bearing_routes_are_covered(site):
    """Named explicitly. If either loses its coverage, this says which."""
    assert site in _covered_sites(), (
        f"{site} launches a worker and nothing reaches the launch. This is the "
        "exact gap that let a 500 ship on every call."
    )
