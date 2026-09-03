# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""ONE decision, shared: which database does a BOM link resolve against when
the run targets a prospective (premise-generated) database?

Two code paths translate links to a prospective database and they had drifted
apart, which is how a crash reached the fleet:

  * ``api/lca.py:_translate_demand_to_database`` (single product) probed the
    target for the code and fell back to the source with a warning.
  * ``core/dsm_lca_engine.py:_rewrite_db`` (fleet) rewrote EVERY link's
    database unconditionally, with no existence check and no fallback.

The fleet version worked only because every BOM row pointed at base ecoinvent,
and premise preserves codes. The moment a row linked ``mapper-tailpipe`` --
whose codes exist in no premise database, because premise never generated a
variant of it -- the fleet path raised ``ActivityDataset ... does not exist``
and took the whole run down. Measured on MAp-test: 61/61 ecoinvent codes carry
over, 0/2 mapper-tailpipe codes do.

So the DECISION lives here, once. The two callers keep their own iteration --
one walks a demand dict, the other a flattened material list -- because the
shapes genuinely differ; the rule does not.

THE RULE, and why each branch is what it is:

1. No target database, or the link already lives there -> keep it. Nothing to do.

2. ``base_db`` is known and the link's source is NOT it -> keep it, SILENTLY.
   The database was not generated from that base, so premise never produced a
   variant and there is nothing to translate to. For ``mapper-tailpipe`` this
   is not a fallback but the correct model: the activity holds only biosphere
   exchanges, no technosphere inputs, so there is nothing in it premise could
   have changed. Tailpipe CO2 per kg of fuel is combustion stoichiometry --
   invariant to the background electricity mix. A warning here would fire on
   every such row in every year and train people to ignore warnings.

3. Otherwise -- the link IS from the base, or the base is unknown -- probe the
   target. We fall back ONLY when we positively KNOW the code is absent from a
   target database that exists; then we keep the source AND WARN, because a
   base-db code that failed to carry over is a real gap (premise dropped or
   renamed it) and the reader must be told the result is partially translated.

   "Cannot tell" is NOT "absent". ``exists`` returns ``None`` when the target
   database is not present at all, and then we translate as before rather than
   silently pinning every row -- pinning on an unverifiable probe would change
   the numbers of any run whose target database is merely unavailable to the
   prober, and would have silently rewritten the meaning of every synthetic
   fixture in the interpolation tests.

``base_db=None`` deliberately degrades to the probe, so a caller that cannot
say which base it is targeting still gets the guarded behaviour rather than
the crash.
"""

from __future__ import annotations

from typing import Callable


def resolve_link_db(
    src_db: str,
    code: str,
    target_db: str | None,
    base_db: str | None,
    exists: Callable[[str, str], bool | None],
) -> tuple[str, str | None]:
    """Return ``(database_to_use, warning_or_None)`` for one link.

    ``exists(db, code)`` is supplied by the caller so it can cache the probe:
    the fleet path resolves the same handful of codes across 26 years and three
    scopes, and an uncached bw2 lookup per row per year is not affordable. It
    must NOT be cached across runs -- bw2's project state is mutable. It
    returns ``None`` for "cannot tell" (target database absent), which is
    treated as translate, never as fall back.
    """
    if not target_db or src_db == target_db:
        return src_db, None

    # (2) Not derived from this base: pin, silently. Correct, not a fallback.
    if base_db is not None and src_db != base_db:
        return src_db, None

    # (3) From the base (or base unknown): fall back only on a KNOWN absence.
    if exists(target_db, code) is False:
        return src_db, (
            f"Activity {src_db}/{code} not found in {target_db}; "
            "fell back to source database for this key."
        )
    return target_db, None


def base_db_for(project: str, target_db: str | None) -> str | None:
    """The base database a prospective DB was generated from, per the pLCA
    registry -- the same registry ``resolve_prospective_dbs`` reads, so the two
    cannot disagree about what a database's base is.

    ``None`` when the target is not a registered prospective database (then the
    probe branch applies, which is the safe reading).
    """
    if not target_db:
        return None
    try:
        from mapper.core import plca_storage

        meta = plca_storage.get_metadata(project, target_db)
    except Exception:
        return None
    return (meta or {}).get("base_db") or None
