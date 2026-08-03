# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""The licence-free demo path.

These are cheap, hermetic checks — they do NOT build the demo project, which
needs bw2setup() (~1 min, writes ~150 MB) and is covered by the documented
walkthrough instead. What is asserted here is the contract CI can protect:

* the demo is labelled as fictional everywhere a name reaches the UI;
* it is confined to its own Brightway2 project;
* the status endpoint answers on a bare install, since the frontend banner
  depends on it.
"""
from fastapi.testclient import TestClient

from mapper.core import demo_project as dp
from mapper.main import app

client = TestClient(app)


def test_demo_names_are_marked_fictional():
    # Anything a user can see must carry the marker, or demo output could be
    # mistaken for a real assessment.
    assert dp.FICTIONAL_TAG in dp.DEMO_SYSTEM_NAME
    assert dp.FICTIONAL_TAG in dp.DEMO_ARCHETYPE_BEV
    assert dp.FICTIONAL_TAG in dp.DEMO_ARCHETYPE_ICEV
    for code, spec in dp._SYNTHETIC_ACTIVITIES.items():
        assert spec["name"].startswith("DEMO "), code
        assert dp.FICTIONAL_TAG in spec["name"], code


def test_demo_project_name_is_distinct_and_recognised():
    assert dp.is_demo_project(dp.DEMO_PROJECT_NAME)
    assert dp.is_demo_project(f"  {dp.DEMO_PROJECT_NAME}  ")  # trimmed
    for other in ("default", "MAp-test", "", None, "MApper demo"):
        assert not dp.is_demo_project(other)


def test_demo_database_is_not_named_after_a_licensed_source():
    # Guards the licence constraint: nothing shipped may be named as, or imply,
    # ecoinvent content.
    lowered = (dp.DEMO_DB_NAME + dp.DEMO_PROJECT_NAME).lower()
    for banned in ("ecoinvent", "ei39", "ei310", "cutoff", "apos", "consequential"):
        assert banned not in lowered


def test_synthetic_activities_only_reference_biosphere_by_search_term():
    # The synthetic inventory must be self-contained: upstream links may only
    # point at other demo activities, never at an external database.
    codes = set(dp._SYNTHETIC_ACTIVITIES)
    for code, spec in dp._SYNTHETIC_ACTIVITIES.items():
        for upstream in spec["inputs"]:
            assert upstream in codes, f"{code} -> unknown upstream {upstream}"


def test_boms_reference_only_declared_synthetic_activities():
    codes = set(dp._SYNTHETIC_ACTIVITIES)
    for bom in (dp._BEV_BOM, dp._ICEV_BOM):
        for stage, materials in bom.items():
            for code in materials:
                assert code in codes, f"{stage} -> unknown activity {code}"


def test_demo_status_endpoint_answers_without_a_demo_project():
    # The banner asks for this on every project change; it must never 500,
    # including on a bare install with no demo built.
    res = client.get("/api/demo/status")
    assert res.status_code == 200
    body = res.json()
    assert body["demo_project_name"] == dp.DEMO_PROJECT_NAME
    assert isinstance(body["is_demo_active"], bool)
