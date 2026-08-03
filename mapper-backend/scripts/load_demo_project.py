#!/usr/bin/env python
# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Build MApper's licence-free demo project from the command line.

    cd mapper-backend
    python scripts/load_demo_project.py

Creates a dedicated Brightway2 project holding a synthetic technosphere and a
worked DSM → MFA → LCA → AESA example, so MApper can be run end to end without
an ecoinvent licence. Real projects are untouched.

Everything it produces is FICTIONAL and is not a valid assessment.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Allow `python scripts/load_demo_project.py` from mapper-backend/ without the
# package being installed — same reason the tests run under `python -m pytest`.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--rebuild", action="store_true",
                    help="regenerate the synthetic database and DSM inputs")
    ap.add_argument("--verify", action="store_true",
                    help="after building, run a real LCA and print the score")
    args = ap.parse_args()

    from mapper.core.demo_project import (
        DEMO_DB_NAME, DEMO_PROJECT_NAME, build_demo_project,
    )

    print("Building MApper demo project (synthetic data, no ecoinvent needed)…")
    print("First run installs biosphere3 + 762 LCIA methods: ~10 s, ~150 MB.\n")

    report = build_demo_project(rebuild=args.rebuild)

    print(f"  project                : {report.project}")
    print(f"  bw2setup ran           : {report.bw2setup_ran}")
    print(f"  biosphere3 flows       : {report.biosphere_flows}")
    print(f"  LCIA methods           : {report.lcia_methods}")
    print(f"  synthetic activities   : {report.technosphere_activities}")
    print(f"  DSM system             : {report.dsm_system_id} "
          f"({report.dsm_years} years)")
    print(f"  simulated              : {report.simulated}")
    print(f"  total inflow (vehicles): {report.total_inflow_units:,.0f}")
    for a in report.archetypes:
        print(f"  archetype              : {a}")

    if args.verify:
        import bw2calc as bc
        import bw2data as bd
        previous = bd.projects.current
        try:
            bd.projects.set_current(DEMO_PROJECT_NAME)
            method = next(
                m for m in bd.methods
                if "IPCC" in str(m) and "GWP100" in str(m)
            )
            act = bd.get_activity((DEMO_DB_NAME, "demo_battery_cell"))
            lca = bc.LCA({act: 1}, method)
            lca.lci()
            lca.lcia()
            print(f"\n  VERIFY — real bw2calc solve on synthetic inventory:")
            print(f"    activity : {act['name']}")
            print(f"    method   : {method[-1]}")
            print(f"    score    : {lca.score:.4f} "
                  f"{bd.methods[method].get('unit', '')} per kg")
        finally:
            if previous and previous != DEMO_PROJECT_NAME:
                bd.projects.set_current(previous)

    print("\n" + "!" * 72)
    print("! ALL NUMBERS IN THIS PROJECT ARE FICTIONAL.")
    print("! They exist so the software can be exercised without a licence.")
    print("! Do not cite, publish or otherwise treat any output as an")
    print("! environmental assessment.")
    print("!" * 72)
    print(f"\nOpen MApper and select the project: {DEMO_PROJECT_NAME}")
    print("Prospective (premise) analysis is NOT part of the demo — it needs "
          "both an\necoinvent licence and a premise key.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
