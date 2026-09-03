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

import pytest


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

    pathlib.Path.mkdir = guarded_mkdir
    pathlib.Path.write_text = guarded_write_text
    try:
        yield
    finally:
        pathlib.Path.mkdir = real_mkdir
        pathlib.Path.write_text = real_write_text
