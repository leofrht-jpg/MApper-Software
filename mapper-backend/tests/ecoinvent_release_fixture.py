# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""A tiny synthetic ecoinvent release on disk: MasterData/ElementaryExchanges.xml
plus a few ``datasets/*.spold``. Nothing here is ecoinvent content."""
from __future__ import annotations

from pathlib import Path

NS = "http://www.EcoInvent.org/EcoSpold02"

# id -> (name, unit, compartment, subcompartment)
RELEASE_FLOWS = {
    "f1-co2": ("Carbon dioxide, fossil", "kg", "air", "urban air close to ground"),
    "f2-ch4": ("Methane, fossil", "kg", "air", "unspecified"),
    "f3-pest": ("Clopyralid", "kg", "water", "surface water"),
    "f4-soilc": ("Carbon, organic, increase in soil or biomass stock", "kg", "natural resource", "in ground"),
    "f5-temp": ("Pyrene_temp", "kg", "air", "unspecified"),  # bw2io drops its exchanges on purpose
}

# activity -> flow ids it emits
ACTIVITIES = {
    "act-a": ["f1-co2", "f3-pest", "f4-soilc"],
    "act-b": ["f2-ch4", "f3-pest"],
    "act-c": ["f1-co2", "f5-temp"],
}
TOTAL_BIOSPHERE_EXCHANGES = sum(len(v) for v in ACTIVITIES.values())  # 7


def _flow_xml(fid: str, name: str, unit: str, comp: str, sub: str) -> str:
    return (
        f'<elementaryExchange id="{fid}"><name>{name}</name><unitName>{unit}</unitName>'
        f"<compartment><compartment>{comp}</compartment><subcompartment>{sub}</subcompartment>"
        f"</compartment></elementaryExchange>"
    )


def _spold(act_id: str, flow_ids: list[str]) -> str:
    elementary = "".join(
        f'<elementaryExchange id="x-{act_id}-{i}" elementaryExchangeId="{fid}" amount="{0.5 + i}">'
        f"<name>{RELEASE_FLOWS[fid][0]}</name><unitName>{RELEASE_FLOWS[fid][1]}</unitName>"
        f"<outputGroup>4</outputGroup></elementaryExchange>"
        for i, fid in enumerate(flow_ids)
    )
    return (
        f'<?xml version="1.0" encoding="utf-8"?><ecoSpold xmlns="{NS}"><activityDataset>'
        f'<activityDescription><activity id="{act_id}" specialActivityType="0">'
        f"<activityName>activity {act_id}</activityName></activity>"
        f"<geography><shortname>GLO</shortname></geography><technology/><timePeriod/></activityDescription>"
        f"<flowData>"
        f'<intermediateExchange id="p-{act_id}" intermediateExchangeId="p-{act_id}" amount="1">'
        f"<name>product {act_id}</name><unitName>kg</unitName><outputGroup>0</outputGroup></intermediateExchange>"
        f"{elementary}</flowData>"
        f'<administrativeInformation><dataEntryBy personName="t" personEmail="t@x"/>'
        f'<dataGeneratorAndPublication personName="t" personEmail="t@x"/></administrativeInformation>'
        f"</activityDataset></ecoSpold>"
    )


def write_release(root: Path, flows: dict | None = None) -> Path:
    """Write the release under ``root``; returns the ``datasets`` folder."""
    flows = RELEASE_FLOWS if flows is None else flows
    (root / "MasterData").mkdir(parents=True)
    (root / "datasets").mkdir()
    (root / "MasterData" / "ElementaryExchanges.xml").write_text(
        f'<?xml version="1.0" encoding="utf-8"?><ecoSpold xmlns="{NS}">'
        + "".join(_flow_xml(fid, *v) for fid, v in flows.items())
        + "</ecoSpold>",
        encoding="utf-8",
    )
    for act_id, flow_ids in ACTIVITIES.items():
        (root / "datasets" / f"{act_id}.spold").write_text(_spold(act_id, flow_ids), encoding="utf-8")
    return root / "datasets"
