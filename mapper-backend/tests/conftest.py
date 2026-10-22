"""Test isolation: the parameter registry, and the on-disk storage roots.

``parameters._tables`` is a module-level ``dict[project -> ParameterTable]``
that NOTHING clears between tests -- there was no conftest at all before this
one. So a table installed by test *n* is still there for test *n+40*, and a
fixture can name a sensitivity case it never registered while another test's
table quietly satisfies it.

That is not hypothetical. Three fixtures did exactly this, and the full suite
passed on all three locally while CI -- a clean environment, different skips,
different ordering -- failed on one of them. A full-suite green therefore did
not prove a fixture registered what it named.

Measured before landing: clearing this registry breaks NOTHING (1357 passed),
and it is load-bearing -- reverting one of the three fixture corrections is
INVISIBLE without this fixture (1357 passed) and caught with it. It turns a
leakage-dependent green red locally instead of after a CI round-trip.

Scope is deliberately narrow. Twenty other module-level registries share the
property (``bom._archetypes``, ``dsm._systems``, the task registries, ...) and
none is leaned on today -- proven by the standalone sweep, which now runs in
CI (``.github/workflows/test-isolation.yml``) rather than being a procedure
somebody has to remember. Clearing all twenty-one costs ~25% suite time for no
measured benefit; if the CI sweep goes red it will name the file, and that is
the signal to revisit.
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
from pathlib import Path

import platformdirs
import pytest


# ── The real log file ─────────────────────────────────────────────────────
#
# ``mapper.main`` calls ``configure_logging()`` at IMPORT, which attaches a
# RotatingFileHandler on ~/Library/Logs/mapper/mapper.log (the platform log
# dir). Every test that imports the app therefore wrote into the user's real
# log: measured on 2026-10-22, ~2,400 lines across four rotations, including
# planted lines ("a real error", "index exploded", "Unhandled exception on POST
# /api/authored-databases/mine/activities") that then appeared in Settings ›
# Logs and in exported logs as if the app had produced them.
#
# Redirect at CONFTEST IMPORT, not in a fixture: the app is imported while
# test modules are collected, before any fixture runs. ``api/system.py`` also
# binds ``LOG_FILE`` by value at import, so the environment variable has to be
# in place before the first ``import mapper``.
_REAL_LOG_DIR = Path(platformdirs.user_log_dir("mapper")).resolve()
_TEST_LOG_DIR = Path(tempfile.mkdtemp(prefix="mapper-test-logs-"))
os.environ["MAPPER_LOG_DIR"] = str(_TEST_LOG_DIR)


class RealLogWriteError(AssertionError):
    """A test opened a log handler on the user's real mapper log directory."""


_real_filehandler_init = logging.FileHandler.__init__


def _guarded_filehandler_init(self, filename, *args, **kwargs):
    target = Path(os.fspath(filename)).expanduser().resolve()
    if target == _REAL_LOG_DIR or _REAL_LOG_DIR in target.parents:
        raise RealLogWriteError(
            f"a log handler was opened on {target}, inside the REAL log directory "
            f"{_REAL_LOG_DIR}. Tests log to MAPPER_LOG_DIR={_TEST_LOG_DIR}; "
            "something bypassed it (imported log_config before this conftest, or "
            "built a FileHandler on platformdirs.user_log_dir directly)."
        )
    _real_filehandler_init(self, filename, *args, **kwargs)


# RotatingFileHandler subclasses FileHandler, so this covers mapper.log too.
logging.FileHandler.__init__ = _guarded_filehandler_init


# ── Every real Brightway project ──────────────────────────────────────────
#
# The per-test guard further down checks only the project that is CURRENT
# when a test starts, and deliberately ignores a test that switches away. This
# one is the backstop: it reads each real project's database and method
# registries (``databases.json``, ``methods.json`` -- plain files, read only,
# no project switch) at conftest import and again at the end of the run, and
# fails the run if any of them changed. A new database (guard-db), a removed
# one, a rewritten one (its ``modified`` stamp) or an installed method all
# change these files.
#
# The MApper app, if it is running against the same data while the suite runs,
# can also change them; the message says so.
def _real_bw2_dir() -> Path | None:
    env = os.environ.get("BRIGHTWAY2_DIR")
    if env:
        # CI points this at a scratch directory; nothing real to protect.
        return None
    base = Path(platformdirs.user_data_dir("Brightway3", "pylca"))
    alt = Path(platformdirs.user_data_dir("Brightway3"))
    for cand in (base, alt):
        if cand.is_dir():
            return cand
    return None


def _bw2_registry_fingerprint() -> dict[str, object]:
    root = _real_bw2_dir()
    if root is None:
        return {}
    out: dict[str, object] = {}
    for proj in sorted(p for p in root.iterdir() if p.is_dir()):
        entry: dict[str, object] = {}
        dbf = proj / "databases.json"
        if dbf.is_file():
            try:
                data = json.loads(dbf.read_text(encoding="utf-8"))
                entry["databases"] = {k: (v or {}).get("modified") for k, v in data.items()}
            except (OSError, ValueError):
                entry["databases"] = "unreadable"
        mf = proj / "methods.json"
        if mf.is_file():
            try:
                entry["methods"] = len(json.loads(mf.read_text(encoding="utf-8")))
            except (OSError, ValueError):
                entry["methods"] = "unreadable"
        out[proj.name] = entry
    return out


_BW2_AT_START = _bw2_registry_fingerprint()


def _bw2_changes(before: dict, after: dict) -> list[str]:
    lines = []
    for proj in sorted(set(before) | set(after)):
        b, a = before.get(proj, {}), after.get(proj, {})
        if b == a:
            continue
        if proj not in before:
            # A NEW project directory: tests that build a temporary project
            # delete it again; one left behind is still a write.
            lines.append(f"  {proj}: new project directory left behind")
            continue
        if proj not in after:
            lines.append(f"  {proj}: project directory removed")
            continue
        bd, ad = b.get("databases", {}), a.get("databases", {})
        if isinstance(bd, dict) and isinstance(ad, dict):
            for name in sorted(set(ad) - set(bd)):
                lines.append(f"  {proj}: database ADDED {name!r}")
            for name in sorted(set(bd) - set(ad)):
                lines.append(f"  {proj}: database REMOVED {name!r}")
            for name in sorted(set(bd) & set(ad)):
                if bd[name] != ad[name]:
                    lines.append(f"  {proj}: database REWRITTEN {name!r}")
        elif bd != ad:
            lines.append(f"  {proj}: database registry changed")
        if b.get("methods") != a.get("methods"):
            lines.append(f"  {proj}: LCIA methods {b.get('methods')} -> {a.get('methods')}")
    return lines


# ── The MApper project store is live data too (run-level backstop) ──────────
#
# `GuardlessProbe` -- the DSM system `test_project_guard_e2e.py` used to
# create -- piled up in real projects (Battery Circularity, then EVS40), one
# per run, in whichever bw2 project was current. The per-test redirect and the
# per-write guard further down stop the known paths in-process; neither sees a
# write by another route (a subprocess server started by a test, an `open()` or
# `os.replace` the guard does not wrap, a test file run without this conftest's
# redirect in force). So, like the Brightway fingerprint above: list every file
# under the real project-data roots (size + mtime, stat only, nothing read) at
# conftest import and again at the end, and fail the run on any difference,
# naming the file and, for a DSM system, the system's name.
_STORE_LEAVES = ("dsm", "mfa", "aesa", "parameters", "plca", "aesa_presets")


def _real_store_base() -> Path:
    return Path(platformdirs.user_data_dir("mapper"))


def _store_fingerprint(base: Path | None = None) -> dict[str, tuple[int, int]]:
    base = _real_store_base() if base is None else base
    out: dict[str, tuple[int, int]] = {}
    for leaf in _STORE_LEAVES:
        root = base / leaf
        if not root.is_dir():
            continue
        for f in root.rglob("*"):
            try:
                if f.is_file():
                    st = f.stat()
                    out[f.relative_to(base).as_posix()] = (st.st_size, st.st_mtime_ns)
            except OSError:
                continue
    return out


def _store_changes(before: dict, after: dict, base: Path | None = None) -> list[str]:
    base = _real_store_base() if base is None else base
    lines = []

    def _label(rel: str) -> str:
        # A DSM system's directory is a uuid; its name is what the user sees.
        if rel.startswith("dsm/") and rel.endswith("/system.json"):
            try:
                name = json.loads((base / rel).read_text(encoding="utf-8")).get("name")
                return f"{rel} (DSM system {name!r})"
            except (OSError, ValueError, AttributeError):
                pass
        return rel

    for rel in sorted(set(after) - set(before)):
        lines.append(f"  ADDED     {_label(rel)}")
    for rel in sorted(set(before) - set(after)):
        lines.append(f"  REMOVED   {rel}")
    for rel in sorted(set(before) & set(after)):
        if before[rel] != after[rel]:
            lines.append(f"  REWRITTEN {_label(rel)}")
    return lines


_STORE_AT_START = _store_fingerprint()


def pytest_sessionfinish(session, exitstatus):
    changes = _bw2_changes(_BW2_AT_START, _bw2_registry_fingerprint())
    if changes:
        session.config._mapper_bw2_changes = changes  # for the terminal summary
        session.exitstatus = 1
    store = _store_changes(_STORE_AT_START, _store_fingerprint())
    if store:
        session.config._mapper_store_changes = store
        session.exitstatus = 1


def pytest_terminal_summary(terminalreporter, exitstatus, config):
    changes = getattr(config, "_mapper_bw2_changes", None)
    if changes:
        terminalreporter.section("REAL BRIGHTWAY PROJECTS WERE WRITTEN", sep="!", red=True)
        terminalreporter.line(
            "The test run changed the developer's real Brightway projects "
            "(or the MApper app was writing to them while the suite ran):"
        )
        for line in changes:
            terminalreporter.line(line)
    store = getattr(config, "_mapper_store_changes", None)
    if store:
        terminalreporter.section("REAL MAPPER PROJECT DATA WAS WRITTEN", sep="!", red=True)
        terminalreporter.line(
            f"The test run changed files under {_real_store_base()} (DSM systems, "
            "archetypes, AESA, parameters, pLCA registry), or the MApper app was "
            "writing to them while the suite ran:"
        )
        for line in store:
            terminalreporter.line(line)


@pytest.fixture(autouse=True)
def _clear_parameter_registry():
    """Give every test an empty ``parameters._tables``.

    A test that needs a table must install one -- which is the point. Both
    sides of the yield: setup so a predecessor cannot supply it, teardown so
    this test cannot supply a successor's.
    """
    from mapper.api import parameters as _parameters

    _parameters._tables.clear()
    yield
    _parameters._tables.clear()


# ── The live storage roots ────────────────────────────────────────────────
#
# Every storage module holds a module-level
# ``STORAGE_DIR = Path(platformdirs.user_data_dir("mapper")) / <name>``, and a
# test that does not redirect it writes into the USER'S REAL PROJECTS. Three
# test files did: `test_dsm_scenarios.py` left three `sys_promote_*` systems
# and `test_project_guard_e2e.py` left a uuid-named one, all inside the live
# "Battery Circularity" project. They were found by accident while dating
# files for an unrelated investigation, which is the problem -- nothing was
# looking.
#
# Worse than "writes to a fixture project": the target is whatever bw2 project
# happens to be CURRENT when the test runs, so which real project gets
# polluted depends on run order and on what the developer last opened.
#
# The fix is redirection by DEFAULT rather than per test. Eight test files
# already monkeypatch a root by hand; that idiom keeps working -- their
# ``monkeypatch.setattr`` simply overrides an already-redirected value with
# their own tmp_path, and monkeypatch unwinds in reverse order.
#
# ``project_storage.storage_roots()`` reads these module attributes live
# (its docstring already promises that monkeypatching them is honoured), so
# redirecting the modules redirects the copy/rename/export helpers too.
_STORAGE_ROOTS = (
    ("mapper.core.dsm_storage", "STORAGE_DIR", "dsm"),
    # Legacy MFA root: `hydrate_from_disk` migrates from it on first use, so
    # leaving it pointed at the live tree would let a test read real data.
    ("mapper.core.dsm_storage", "_LEGACY_STORAGE_DIR", "mfa"),
    # aesa_storage and aesa_session_storage deliberately share one directory --
    # sessions live at aesa/{project}/sessions/ -- so they must redirect to the
    # SAME temp path or that relationship breaks.
    ("mapper.core.aesa_storage", "STORAGE_DIR", "aesa"),
    ("mapper.core.aesa_session_storage", "STORAGE_DIR", "aesa"),
    ("mapper.core.parameter_storage", "STORAGE_DIR", "parameters"),
    ("mapper.core.plca_storage", "STORAGE_DIR", "plca"),
    ("mapper.core.sharing_preset_storage", "STORAGE_DIR", "aesa_presets"),
)


@pytest.fixture
def live_storage():
    """Opt OUT of the redirect: this test reads the developer's real projects.

    A handful of tests assert against live data on purpose -- the content-hash
    round-trip walks the real archetypes, and the paired Monte Carlo foreground
    tests need Battery Circularity's A / A0, whose rows are 100% expressions
    and are the only place that foreground carries any uncertainty at all. That
    is how the missing paired foreground was found in the first place.

    They already skip when the project is absent, so they contribute nothing in
    CI and never have; the value is entirely local. Redirecting them would have
    turned six passing local tests into silent skips.

    READING live data is what this permits. WRITING is still caught -- see
    ``test_no_test_writes_to_the_live_store``, which does not exempt these.
    """
    yield


@pytest.fixture(autouse=True)
def _isolate_storage_roots(request, tmp_path_factory, monkeypatch):
    """Point every storage root at a per-test temp directory.

    Autouse and unconditional except for an explicit ``live_storage`` request:
    an opt-IN would only ever cover the tests somebody remembered, and the
    offenders are precisely the ones nobody remembered.
    """
    import importlib

    if "live_storage" in request.fixturenames:
        yield
        return

    root = tmp_path_factory.mktemp("mapper-store")
    for mod_name, attr, leaf in _STORAGE_ROOTS:
        monkeypatch.setattr(importlib.import_module(mod_name), attr, root / leaf)
    yield


# ── The guard: nothing may WRITE to the live store ────────────────────────
#
# The redirect above prevents the writes; this catches a test that gets past
# it -- one that resolves a path itself, or a future storage module nobody
# adds to _STORAGE_ROOTS. It fires AT THE WRITE rather than at session end, so
# the failure names the offending test and does not depend on a reporting test
# running last.
#
# Scoped to the seven project-data roots, resolved from platformdirs directly
# rather than from the (redirected) module attributes. Deliberately NOT the
# whole user_data_dir: a premise import creates a `workspace` scratch dir
# there, which is not project data and not ours to police.
#
# `live_storage` tests are NOT exempt. Reading real projects is the point of
# them; writing to one never is.


def _live_roots():
    import pathlib

    import platformdirs

    base = pathlib.Path(platformdirs.user_data_dir("mapper"))
    return tuple(
        (base / leaf).resolve()
        for leaf in ("dsm", "mfa", "aesa", "parameters", "plca", "aesa_presets")
    )


class LiveStoreWriteError(AssertionError):
    """A test tried to write into the developer's real project data."""


_CURRENT_TEST = {"id": "<session>"}


def pytest_runtest_setup(item):
    _CURRENT_TEST["id"] = item.nodeid


@pytest.fixture(autouse=True, scope="session")
def _forbid_live_store_writes():
    import pathlib

    roots = _live_roots()
    real_mkdir = pathlib.Path.mkdir
    real_write_text = pathlib.Path.write_text

    def _check(path, how):
        try:
            resolved = pathlib.Path(path).resolve()
        except OSError:
            return
        for root in roots:
            if resolved == root or root in resolved.parents:
                raise LiveStoreWriteError(
                    f"{_CURRENT_TEST['id']} tried to {how} inside the LIVE "
                    f"project store:\n    {resolved}\n"
                    "Tests must not touch real user data. The storage roots are "
                    "redirected to a temp dir by the autouse _isolate_storage_roots "
                    "fixture -- if you are here, something resolved a path without "
                    "going through a STORAGE_DIR, or a new storage module needs "
                    "adding to _STORAGE_ROOTS in this conftest."
                )

    def guarded_mkdir(self, *a, **k):
        _check(self, "create a directory")
        return real_mkdir(self, *a, **k)

    def guarded_write_text(self, *a, **k):
        _check(self, "write a file")
        return real_write_text(self, *a, **k)

    # `open(path, "w")` and `os.replace(tmp, path)` are the other two ways a
    # file lands on disk; the guard used to see only the Path methods.
    import builtins
    import io
    import os as _os

    real_open = builtins.open  # same object as io.open; Path.open/write_bytes go through io.open
    real_replace = _os.replace

    def guarded_open(file, mode="r", *a, **k):
        if isinstance(file, (str, bytes, _os.PathLike)) and any(c in mode for c in "wax+"):
            _check(_os.fsdecode(file), "open a file for writing")
        return real_open(file, mode, *a, **k)

    def guarded_replace(src, dst, *a, **k):
        _check(_os.fsdecode(dst), "replace a file")
        return real_replace(src, dst, *a, **k)

    pathlib.Path.mkdir = guarded_mkdir
    pathlib.Path.write_text = guarded_write_text
    builtins.open = guarded_open
    io.open = guarded_open
    _os.replace = guarded_replace
    try:
        yield
    finally:
        pathlib.Path.mkdir = real_mkdir
        pathlib.Path.write_text = real_write_text
        builtins.open = real_open
        io.open = real_open
        _os.replace = real_replace


# ── Brightway is live data too ───────────────────────────────────────────────
#
# The storage roots above are redirected; Brightway's own directory is NOT, and
# cannot be cheaply (bw2data binds its project directory at import). So a test
# that reaches a real ``Database.write()`` writes into whichever bw2 project is
# current on the developer's machine. One did: the labelled-body case of
# ``test_json_body_needs_content_type.py`` created an empty ``guard-db`` in
# default, Battery Circularity and EVS40, where it sat in the database dropdown.
#
# bw2 writes through sqlite, not ``Path.write_text``, so the write guard above
# never saw it. This one compares the CURRENT project's database names before
# and after every test and fails naming the test. A test that needs real
# databases must build them in a temporary project of its own (switching away
# and back is not flagged: only growth of the project it started in is).


class LiveBrightwayWriteError(AssertionError):
    """A test created a database in the developer's real Brightway project."""


def _bw2_snapshot():
    try:
        import bw2data

        return bw2data.projects.current, set(bw2data.databases)
    except Exception:
        return None, None


@pytest.fixture(autouse=True)
def _forbid_live_bw2_databases(request):
    project, before = _bw2_snapshot()
    yield
    if project is None:
        return
    now_project, after = _bw2_snapshot()
    if now_project != project or after is None:
        return
    added = sorted(after - before)
    if added:
        raise LiveBrightwayWriteError(
            f"{request.node.nodeid} created database(s) {added} in the LIVE "
            f"Brightway project {project!r}. Use the fake backend, or build the "
            "databases in a temporary project and delete it afterwards."
        )
