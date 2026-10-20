# SPDX-License-Identifier: MPL-2.0
"""Saving an AESA configuration: single-product, and nothing dropped.

Two defects, found together:

* a single-product configuration (no DSM system) could not be saved: the
  routes looked up ``mfa_system_id`` whatever it was, ``None`` included, and
  404'd;
* both routes rebuilt the model field by field and left out ``sharing``,
  ``sharing_preset_id`` and ``dsm_scenario_id`` -- a customised sharing chain,
  the preset bookmark and the cascade's scenario pick were dropped on every
  save.

And a third the fix nearly introduced: the storage layer's one-time
"drop derived copies" migration runs on any configuration without the
``derived_defaults_migrated`` flag, so a freshly saved custom chain would have
been wiped on its first LOAD. The tests therefore read back through the list
and get routes, which is where that migration runs.

Real server, real socket, the payload the store's ``saveConfig`` sends.
"""
from __future__ import annotations

import json

from tests.test_aesa_export_real_path import _post, server  # noqa: F401  (fixture)
from tests.test_aesa_single_product import _sp_config

import urllib.request


def _get(url: str):
    with urllib.request.urlopen(url, timeout=30) as r:
        return r.status, json.loads(r.read())


def _put(url: str, body: dict):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="PUT",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def _payload(**over) -> dict:
    """The body aesaStore.saveConfig sends for a customised single-product draft."""
    cfg = _sp_config()
    sharing = cfg.sharing.model_dump()
    sharing["name"] = "EVS40 per car (customised)"
    body = {
        "name": "EVS40 single product",
        "mfa_system_id": None,
        "dsm_scenario_id": "scenario-7",
        "impact_mode": "projected",
        "boundary_set_id": "Sala2020_EF",
        "sharing": sharing,
        "sharing_preset_id": "ferhati_2026_evs40_per_car",
        "carbon_budget": cfg.carbon_budget.model_dump(),
        "method_mapping": [],
        "impact_basis": "as_computed",
    }
    body.update(over)
    return body


def test_a_single_product_configuration_saves_and_keeps_every_field(server):  # noqa: F811
    status, raw, _ = _post(f"{server}/aesa/configurations", _payload())
    assert status == 200, raw
    saved = json.loads(raw)
    assert saved["mfa_system_id"] is None

    # Read back through BOTH load paths (the storage migration runs on load).
    _, listed = _get(f"{server}/aesa/configurations")
    _, one = _get(f"{server}/aesa/configurations/{saved['id']}")
    for cfg in (next(c for c in listed if c["id"] == saved["id"]), one):
        assert cfg["sharing"]["name"] == "EVS40 per car (customised)", "custom chain kept"
        assert cfg["sharing_preset_id"] == "ferhati_2026_evs40_per_car"
        assert cfg["dsm_scenario_id"] == "scenario-7"
        assert cfg["impact_mode"] == "projected"


def test_an_update_keeps_every_field_too(server):  # noqa: F811
    _, raw, _ = _post(f"{server}/aesa/configurations", _payload())
    cid = json.loads(raw)["id"]
    status, upd = _put(f"{server}/aesa/configurations/{cid}",
                       _payload(name="renamed", dsm_scenario_id="scenario-8"))
    assert status == 200, upd
    _, one = _get(f"{server}/aesa/configurations/{cid}")
    assert one["name"] == "renamed" and one["dsm_scenario_id"] == "scenario-8"
    assert one["sharing"]["name"] == "EVS40 per car (customised)"
    assert one["sharing_preset_id"] == "ferhati_2026_evs40_per_car"


def test_a_derived_default_is_still_saved_as_absent(server):  # noqa: F811
    # The store sends sharing=None for an unedited draft (derived defaults).
    # That must stay None, not be replaced by anything.
    _, raw, _ = _post(f"{server}/aesa/configurations", _payload(sharing=None))
    cid = json.loads(raw)["id"]
    _, one = _get(f"{server}/aesa/configurations/{cid}")
    assert one["sharing"] is None


def test_a_named_system_that_does_not_exist_still_404s(server):  # noqa: F811
    status, raw, _ = _post(f"{server}/aesa/configurations", _payload(mfa_system_id="no-such-system"))
    assert status == 404, raw
