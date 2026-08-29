# SPDX-License-Identifier: MPL-2.0
"""Unregistered method tuples are rejected UP FRONT, naming the offender.

The gap this closes: every Monte Carlo test used ``EF v3.1`` and only ``EF
v3.1``, so a family-dependent assumption was structurally invisible. A tuple
carried over from a project where it WAS installed reached
``_method_cf_samplers`` -> ``mc.switch_method(m)``, and bw2calc's
``load_lcia_data`` raised a bare ``KeyError(('EF v3.1', 'acidification',
'accumulated exceedance (AE)'))`` minutes into a run, with nothing naming the
cause.

Both routes share ``_method_cf_samplers``, so both are validated.
"""

import pytest
from fastapi.testclient import TestClient

from mapper.main import app

client = TestClient(app)

EF = ["EF v3.1", "acidification", "accumulated exceedance (AE)"]
IW = ["IMPACT World+ Midpoint", "climate change", "GWP100"]

SINGLE = "/api/lca/monte-carlo"
MULTI = "/api/lca/monte-carlo/multi"


@pytest.fixture
def registry(monkeypatch):
    """Control which method tuples count as installed."""
    import bw2data

    def _set(*tuples):
        monkeypatch.setattr(bw2data, "methods", {tuple(t): {} for t in tuples})

    return _set


def _single(methods, **kw):
    return {"archetype_id": "a", "methods": methods, "iterations": 3, **kw}


def _multi(methods, **kw):
    return {"archetype_ids": ["a", "b"], "methods": methods, "iterations": 3, **kw}


# ── the reported bug ─────────────────────────────────────────────────────────


def test_single_route_400s_naming_the_offending_tuple(registry):
    registry(IW)  # EF is NOT installed
    r = client.post(SINGLE, json=_single([IW, EF]))
    assert r.status_code == 400
    detail = r.json()["detail"]
    # The tuple itself must appear -- a count alone sends the user hunting.
    assert "accumulated exceedance (AE)" in detail
    assert "EF v3.1" in detail


def test_paired_route_400s_naming_the_offending_tuple(registry):
    registry(IW)
    r = client.post(MULTI, json=_multi([IW, EF]))
    assert r.status_code == 400
    detail = r.json()["detail"]
    assert "accumulated exceedance (AE)" in detail
    assert "EF v3.1" in detail


def test_it_is_a_400_not_a_500_and_not_a_bare_keyerror(registry):
    """The pre-fix failure was an unhandled KeyError from inside the worker."""
    registry(IW)
    for url, body in ((SINGLE, _single([EF])), (MULTI, _multi([EF]))):
        r = client.post(url, json=body)
        assert r.status_code == 400, url
        assert "KeyError" not in r.text


# ── the coverage gap: a non-EF family must work end to end ───────────────────


def test_a_non_EF_family_passes_validation_on_both_routes(registry):
    """No MC test had ever used a family other than EF v3.1."""
    registry(IW)
    for url, body in ((SINGLE, _single([IW])), (MULTI, _multi([IW]))):
        r = client.post(url, json=body)
        # Accepted by validation -> a task is started (the run itself needs a
        # real technosphere, which CI does not have).
        assert r.status_code != 400, f"{url}: {r.text}"


def test_validation_is_not_skip_with_warning(registry):
    """Dropping the bad indicator silently would return a result the user
    believes covers N indicators when it covers fewer."""
    registry(IW)
    r = client.post(SINGLE, json=_single([IW, EF]))
    assert r.status_code == 400          # refused, not narrowed to [IW]
    assert "task_id" not in r.text


def test_all_registered_is_accepted(registry):
    registry(EF, IW)
    r = client.post(SINGLE, json=_single([EF, IW]))
    assert r.status_code != 400


def test_the_message_says_how_to_recover(registry):
    registry(IW)
    d = client.post(SINGLE, json=_single([EF])).json()["detail"]
    assert "not installed" in d.lower()
    assert "re-pick" in d.lower()


# ── anti-vacuity: the guard must actually be reachable ───────────────────────


def test_the_guard_is_reached_before_any_worker_starts(registry):
    """A 400 here means no thread was launched, so nothing to cancel."""
    registry(IW)
    import mapper.api.monte_carlo as mc

    before = len(mc._TASKS)
    assert client.post(SINGLE, json=_single([EF])).status_code == 400
    assert len(mc._TASKS) == before
