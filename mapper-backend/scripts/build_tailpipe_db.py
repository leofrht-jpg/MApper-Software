"""Build ``mapper-tailpipe``: per-kg-of-fuel tailpipe combustion activities.

WHY THIS EXISTS
---------------
ecoinvent 3.10 has no operation-style passenger-car dataset. Searched and
confirmed: ``operation, passenger car`` / ``van`` / ``lorry`` all return
nothing, and of the 151 non-market ``EURO``-labelled datasets, **zero** lack a
vehicle or road technosphere input. The tailpipe emissions live only in the
``transport, passenger car, ...`` leaves, which bundle the fuel, the vehicle
itself (``market for passenger car``), ``market for road`` and road
maintenance. A BOM that already models the vehicle and the fuel separately
cannot link one of those without double-counting two of the three.

So a fleet whose use-phase rows link only ``market for petrol, low-sulfur``
carries well-to-tank supply and **no tank-to-wheel combustion at all** -- the
single largest CO2 term in an ICEV lifecycle is simply absent.

This script writes two small activities that isolate the missing half:

    petrol combustion, EURO 5     per kilogram of fuel
    diesel combustion, EURO 5     per kilogram of fuel

Each contains ONLY the eight tailpipe biosphere exchanges plus the mandatory
``type='production'`` self-exchange. **No fuel input**, so linking one
alongside the existing supply row double-counts nothing: the supply row is
well-to-tank, this is tank-to-wheel.

THE FACTORS ARE DERIVED, NEVER PASTED
-------------------------------------
Every number is read out of ecoinvent at build time and divided by that same
dataset's fuel input::

    factor [kg / kg fuel] = biosphere amount [kg / km] / fuel input [kg / km]

so the derivation is reproducible, auditable, and re-runnable against a future
ecoinvent. The source activity keys and the ecoinvent database name are
recorded in each activity's own ``comment`` field, which is what a reader of a
result -- who has no access to this script -- actually sees.

CODES ARE DETERMINISTIC, AND THAT IS LOAD-BEARING
-------------------------------------------------
A BOM row links by ``(database, code)``. If regenerating the database minted
fresh codes, every link into it would dangle -- the exact failure that orphaned
WP5's cohort mapping on 2026-08-04. The code is therefore an md5 of a stable
identity string, so a recipient who runs this script gets byte-identical codes
and existing links keep resolving. Do not switch to ``uuid4()``.

USAGE
-----
    python scripts/build_tailpipe_db.py --project MAp-test --dry-run
    python scripts/build_tailpipe_db.py --project MAp-test

``--dry-run`` derives and prints everything without writing, so the numbers can
be checked before any database is created. Re-running is idempotent: the
database is replaced and the codes do not move.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import math
import sys

TAILPIPE_DB = "mapper-tailpipe"

# The eight flows requested. Names are biosphere3's, matched exactly -- a
# near-miss must fail loudly rather than silently omit a flow, so a missing
# name is reported and (for the mandatory ones) refuses the build.
FLOWS = [
    "Carbon dioxide, fossil",
    "Methane, fossil",
    "Dinitrogen monoxide",
    "Nitrogen oxides",
    "Carbon monoxide, fossil",
    "NMVOC, non-methane volatile organic compounds",
    "Particulate Matter, < 2.5 um",
    "Sulfur dioxide",
]

# Losing the carbon term would defeat the entire point of the database, so it
# is not allowed to be quietly absent.
REQUIRED_FLOWS = {"Carbon dioxide, fossil"}

# (label, source activity name, the fuel input to divide by)
SOURCES = [
    (
        "petrol",
        "transport, passenger car, small size, petrol, EURO 5",
        "petrol, low-sulfur",
    ),
    (
        "diesel",
        "transport, passenger car, small size, diesel, EURO 5",
        "diesel, low-sulfur",
    ),
]
SOURCE_LOCATION = "RER"

# Fallback pedigree, used ONLY if a future ecoinvent ships an exchange with no
# usable uncertainty. Every exchange in 3.10 carries its own, so this is
# currently unreached -- but a silently-fixed dominant CO2 term is exactly the
# failure this database exists to avoid, so there is no unscored path.
#   (reliability, completeness, temporal, geographical, further technological)
FALLBACK_PEDIGREE = {
    "reliability": 2,
    "completeness": 3,
    "temporal correlation": 3,
    "geographical correlation": 2,
    "further technological correlation": 3,
}
FALLBACK_BASIC_VARIANCE = 0.0006


def stable_code(name: str) -> str:
    """32-char hex, deterministic across machines and re-runs.

    Matches ecoinvent's own code shape, which the BOM validator requires
    (``_EXPECTED_CODE_LENGTH = 32``); biosphere3's 36-char hyphenated UUIDs are
    what that check rejects.
    """
    return hashlib.md5(f"{TAILPIPE_DB}|{name}".encode("utf-8")).hexdigest()


def pick_ecoinvent(bw2data, explicit: str | None) -> str:
    if explicit:
        if explicit not in bw2data.databases:
            raise SystemExit(f"database {explicit!r} is not installed")
        return explicit
    names = [
        d
        for d in bw2data.databases
        if "ecoinvent" in d.lower() and "_premise_" not in d
    ]
    if not names:
        raise SystemExit("no base ecoinvent database found; pass --ecoinvent")
    # Prefer a cutoff system model, else the first base ecoinvent.
    for n in sorted(names):
        if "cutoff" in n.lower():
            return n
    return sorted(names)[0]


def derive(ei, source_name: str, fuel_key: str) -> dict:
    """Read one EURO 5 leaf and return the per-kg-fuel factors + uncertainty."""
    matches = [
        a
        for a in ei
        if a.get("name") == source_name and a.get("location") == SOURCE_LOCATION
    ]
    if not matches:
        raise SystemExit(
            f"source activity not found: {source_name!r} [{SOURCE_LOCATION}] "
            f"in {ei.name!r}. ecoinvent may have renamed it; update SOURCES."
        )
    if len(matches) > 1:
        raise SystemExit(
            f"{len(matches)} activities match {source_name!r} [{SOURCE_LOCATION}] "
            "-- refusing to guess which one is meant."
        )
    src = matches[0]

    # Sum duplicate fuel rows: the RER leaves carry two `market for petrol,
    # low-sulfur` entries, and dividing by only the first would inflate every
    # factor by ~1%.
    fuel = sum(
        e["amount"]
        for e in src.technosphere()
        if fuel_key in e.input.get("name", "")
    )
    if fuel <= 0:
        raise SystemExit(f"no positive {fuel_key!r} input on {source_name!r}")

    rows: dict[str, dict] = {}
    for e in src.biosphere():
        name = e.input.get("name")
        if name not in FLOWS:
            continue
        d = dict(e)
        row = rows.setdefault(
            name,
            {
                "amount": 0.0,
                "key": tuple(e.input.key),
                "unit": e.input.get("unit"),
                "scale": None,
                "scale_without_pedigree": None,
                "pedigree": None,
            },
        )
        row["amount"] += e["amount"]
        # Uncertainty is a property of the flow, not of the individual row, and
        # the duplicates ecoinvent ships agree -- take the first that has one.
        if row["scale"] is None and d.get("uncertainty type") == 2:
            scale = d.get("scale")
            if scale is not None and scale > 0 and not math.isnan(scale):
                row["scale"] = float(scale)
                row["pedigree"] = d.get("pedigree")
                swp = d.get("scale without pedigree")
                if swp is not None and not math.isnan(swp):
                    row["scale_without_pedigree"] = float(swp)

    missing = [f for f in FLOWS if f not in rows]
    hard = sorted(REQUIRED_FLOWS.intersection(missing))
    if hard:
        raise SystemExit(f"{source_name!r} carries no {hard} -- refusing to build")

    for name, row in rows.items():
        row["factor"] = row["amount"] / fuel
        if row["scale"] is not None:
            # Inherit ecoinvent's own dispersion. See the note written into the
            # activity comment for why this is conservative rather than exact.
            row["sigma"] = row["scale"]
            row["uncertainty_source"] = "inherited"
        else:
            # One implementation: the same composition rule the rest of MApper
            # uses for foreground rows, not a second copy of it here.
            from mapper.core.pedigree import total_sigma

            row["sigma"] = total_sigma(FALLBACK_PEDIGREE, FALLBACK_BASIC_VARIANCE)
            row["pedigree"] = dict(FALLBACK_PEDIGREE)
            row["uncertainty_source"] = "stated fallback"

    return {
        "source_key": (src["database"], src["code"]),
        "source_name": source_name,
        "source_location": SOURCE_LOCATION,
        "fuel_key": fuel_key,
        "fuel_amount": fuel,
        "source_unit": src.get("unit"),
        "rows": rows,
        "missing": missing,
    }


def build_comment(label: str, d: dict, ei_name: str, built: str) -> str:
    inherited = sum(1 for r in d["rows"].values() if r["uncertainty_source"] == "inherited")
    stated = len(d["rows"]) - inherited
    lines = [
        f"Tailpipe (tank-to-wheel) combustion emissions for {label}, per kilogram "
        "of fuel burned. Contains ONLY direct biosphere emissions -- no fuel "
        "input, no vehicle, no road. Intended to sit ALONGSIDE a fuel supply "
        f"row (e.g. 'market for {d['fuel_key']}'), which covers well-to-tank. "
        "Using both together does not double-count; using this alone omits fuel "
        "production, and using the supply row alone omits combustion entirely.",
        "",
        "DERIVATION (reproducible; not a transcribed table):",
        f"  factor [kg/kg fuel] = biosphere amount [kg/{d['source_unit']}]"
        f" / fuel input [kg/{d['source_unit']}]",
        f"  source activity : {d['source_name']} [{d['source_location']}]",
        f"  source key      : {d['source_key'][0]} / {d['source_key'][1]}",
        f"  fuel input      : {d['fuel_amount']:.9g} kg per {d['source_unit']}"
        f"  ('{d['fuel_key']}', duplicate rows summed)",
        f"  ecoinvent       : {ei_name}",
        f"  built           : {built}",
        "  script          : mapper-backend/scripts/build_tailpipe_db.py",
        "",
        "WHY DERIVED RATHER THAN LINKED: ecoinvent 3.10 has no operation-style "
        "passenger-car dataset. All 151 non-market EURO datasets bundle the "
        "vehicle and the road alongside the combustion, so none can be linked "
        "by a BOM that already models those separately.",
        "",
        f"UNCERTAINTY: {inherited} of {len(d['rows'])} exchanges inherit "
        "ecoinvent's own lognormal scale and pedigree from the source exchange"
        + (f"; {stated} use a stated fallback pedigree." if stated else " unchanged."),
        "  The scale is carried across the renormalisation unchanged. This is "
        "CONSERVATIVE, not exact: the source dispersion covers both fuel-per-km "
        "and emissions-per-fuel, and dividing the fuel out arguably removes the "
        "first, so the true per-kg-fuel factor is likely better constrained "
        "than stated (CO2 especially, being fixed by carbon balance). ecoinvent "
        "ships no decomposition that would let the two be separated, and "
        "overstating a spread is the defensible direction.",
    ]
    if d["missing"]:
        lines += ["", "NOT PRESENT in the source dataset: " + ", ".join(d["missing"])]
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--project", help="brightway project (default: current)")
    ap.add_argument("--ecoinvent", help="source database (default: auto-detect)")
    ap.add_argument("--dry-run", action="store_true", help="derive and print, write nothing")
    args = ap.parse_args()

    import bw2data

    if args.project:
        if args.project not in bw2data.projects:
            raise SystemExit(f"project {args.project!r} does not exist")
        bw2data.projects.set_current(args.project)

    ei_name = pick_ecoinvent(bw2data, args.ecoinvent)
    ei = bw2data.Database(ei_name)
    built = _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat()

    print(f"project   : {bw2data.projects.current}")
    print(f"ecoinvent : {ei_name}")
    print(f"target    : {TAILPIPE_DB}\n")

    data: dict[tuple[str, str], dict] = {}
    for label, source_name, fuel_key in SOURCES:
        d = derive(ei, source_name, fuel_key)
        act_name = f"{label} combustion, EURO 5"
        code = stable_code(act_name)
        key = (TAILPIPE_DB, code)

        exchanges = [
            {
                "input": key,
                "output": key,
                "amount": 1.0,
                "type": "production",
                "unit": "kilogram",
                "uncertainty type": 0,
            }
        ]
        print(f"{act_name}  [{code}]")
        print(f"  from {d['source_name']} [{d['source_location']}]")
        print(f"  fuel {d['fuel_amount']:.6g} kg per {d['source_unit']}")
        for name in FLOWS:
            row = d["rows"].get(name)
            if row is None:
                print(f"    {name[:44]:46s}   -- absent in source --")
                continue
            amount = row["factor"]
            ex = {
                "input": row["key"],
                "output": key,
                "amount": amount,
                "type": "biosphere",
                "unit": row["unit"],
                "uncertainty type": 2,
                "loc": math.log(amount),
                "scale": row["sigma"],
            }
            if row["pedigree"]:
                ex["pedigree"] = row["pedigree"]
            if row["scale_without_pedigree"] is not None:
                ex["scale without pedigree"] = row["scale_without_pedigree"]
            exchanges.append(ex)
            gsd2 = math.exp(2.0 * row["sigma"])
            print(
                f"    {name[:44]:46s} {amount:>12.6g} kg/kg  "
                f"GSD2 {gsd2:.4f}  ({row['uncertainty_source']})"
            )

        data[key] = {
            "name": act_name,
            "code": code,
            "database": TAILPIPE_DB,
            "unit": "kilogram",
            "type": "process",
            "reference product": f"{label} combustion, EURO 5",
            "location": "RER",
            "production amount": 1.0,
            "comment": build_comment(label, d, ei_name, built),
            "exchanges": exchanges,
        }
        print()

    if args.dry_run:
        print("--dry-run: nothing written.")
        return 0

    db = bw2data.Database(TAILPIPE_DB)
    db.write(data)
    print(f"wrote {len(data)} activities to {TAILPIPE_DB!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
