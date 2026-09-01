"""Test isolation for the module-level parameter registry.

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
