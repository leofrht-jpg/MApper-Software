# SPDX-License-Identifier: MPL-2.0
"""The AESA export's Summary names the source that fed the SRs.

It printed ``config.impact_mode`` -- the fleet Background radio -- which stays
"static" for any single-product source, so a Prospective single-product run
exported as "Impact Mode: static". The source is now stamped on the result at
compute time. Through the real routes: compute, then export, then read the
workbook the route returned.
"""
from __future__ import annotations

import io
import json

from fastapi.testclient import TestClient
from openpyxl import load_workbook

from tests.test_aesa_single_product import _prospective_point, _single_product, _sp_config

H = {"Content-Type": "application/json"}


def _summary(client, body: dict) -> dict:
    r = client.post("/api/aesa/compute", content=json.dumps(body), headers=H)
    assert r.status_code == 200, r.text
    result = r.json()
    e = client.post("/api/aesa/export", headers=H, content=json.dumps(
        {"config": body["config"], "result": result, "source_name": "BEV-LFP"}))
    assert e.status_code == 200, e.text
    ws = load_workbook(io.BytesIO(e.content))["Summary"]
    return result, {r[0]: r[1] for r in ws.iter_rows(values_only=True) if r and r[0]}


def _client():
    from mapper.main import app
    return TestClient(app)


def test_a_prospective_single_product_run_is_not_called_static():
    cfg = _sp_config().model_dump(mode="json")
    pts = [_prospective_point(y, 8e3, 50).model_dump(mode="json") for y in (2030, 2040)]
    result, rows = _summary(_client(), {"config": cfg, "single_product_basis": "prospective",
                                        "prospective_single_product": pts})
    assert result["impact_source"] == "single_product_prospective"
    assert rows["Impact source"] == "Single product (LCA), Prospective"
    assert "Impact Mode" not in rows


def test_a_static_single_product_run_says_static():
    cfg = _sp_config().model_dump(mode="json")
    _, rows = _summary(_client(), {"config": cfg,
                                   "single_product_result": _single_product().model_dump(mode="json")})
    assert rows["Impact source"] == "Single product (LCA), Static"


def test_an_older_result_without_a_stamp_does_not_guess():
    from mapper.api.aesa import impact_source_label
    from mapper.models.aesa_schemas import AESAComputeResult
    old = AESAComputeResult(config_id=None, results=[], summary_by_year=[])
    assert impact_source_label(_sp_config(), old) == "not recorded"
