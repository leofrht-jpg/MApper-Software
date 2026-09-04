"""A superstructure fallback leaves a DURABLE record, not just a toast.

WHY THERE IS NO OPT-IN FLAG
===========================

The audit asked for the fallback to be opt-in rather than merely visible, on
the principle that "a run that silently computes against a different database
than requested is a different result". The principle is sound. This instance
does not match it, and the reasoning is a chain someone can re-check rather
than a conclusion to take on trust:

1. The fallback fires only in the WRITE step. ``ndb.update()`` -- the
   expensive, methodologically load-bearing transformation -- has already run
   and produced the per-year databases. Superstructure writes them as one DB
   plus an SDF; the fallback writes the same content as N per-year DBs.
2. The result is honestly labelled: it returns ``mode="separate"`` with the
   separate names. Nothing downstream is told it got a superstructure.
3. ``resolve_prospective_dbs`` does ``int(entry.get("year"))``. Superstructure
   entries carry ``year=None``, so they are REJECTED -- superstructure
   databases are not computable in MApper at all. The vintage picker lists
   them disabled for the same reason.
4. THEREFORE the fallback yields the only format the compute pipeline can use,
   and an opt-in flag would ask the user to opt in to a usable result instead
   of an unusable one.

**Step 3 is the load-bearing link and it is testable.** If
``resolve_prospective_dbs`` ever learns to read a superstructure database with
a year slice, step 4 no longer follows and the opt-in question is live again.
``test_the_reasoning_still_holds`` below checks that link directly, so the
trigger fires on its own rather than waiting for someone to reconstruct the
argument.

What DID change: the warning reached the task and the WS ``done`` frame but
nothing durable, so a dismissed toast left no trace. The registry entry now
records it.
"""
from __future__ import annotations

import pytest

from mapper.api.plca import ProspectiveDB


def test_the_flag_defaults_false_so_old_entries_load_unchanged():
    """Every entry written before this -- all 36 in MAp-test -- has no key."""
    db = ProspectiveDB(
        name="ei_premise_2030", base_db="ei", iam="remind", ssp="SSP2",
        year=2030, years=[2030], mode="separate", created_at="2026-04-24T09:40:07Z",
    )
    assert db.fallback is False


def test_the_flag_round_trips():
    db = ProspectiveDB(
        name="ei_premise_2030", base_db="ei", iam="remind", ssp="SSP2",
        year=2030, years=[2030], mode="separate", created_at="t", fallback=True,
    )
    assert db.model_dump()["fallback"] is True


def test_the_separate_write_records_the_fallback():
    """The registry write must derive it from ``result.fallback_warning`` --
    the only thing that distinguishes a fallback from a separate-mode request,
    since both produce ``mode='separate'``."""
    import inspect

    from mapper.api import plca

    src = inspect.getsource(plca.post_generate)
    assert '"fallback": bool(result.fallback_warning)' in src, (
        "the separate-mode registry write no longer records the fallback"
    )


def test_the_superstructure_branch_does_not_set_it():
    """A superstructure that SUCCEEDED is not a fallback."""
    import inspect

    from mapper.api import plca

    src = inspect.getsource(plca.post_generate)
    superstructure_block = src.split('"mode": "superstructure"')[1].split("else:")[0]
    assert "fallback" not in superstructure_block


# ── the reasoning, checked rather than asserted ─────────────────────────────

def test_the_reasoning_still_holds():
    """Step 3: superstructure entries are rejected by the compute resolver.

    This is the link the no-opt-in decision rests on. If it ever stops being
    true, this test fails and the decision is due for review -- which is the
    point of writing the reasoning as a chain rather than a conclusion.
    """
    import inspect

    from mapper.core import plca_storage

    src = inspect.getsource(plca_storage.resolve_prospective_dbs)
    assert 'int(entry.get("year"))' in src, (
        "resolve_prospective_dbs no longer coerces year to int. If it now "
        "handles a superstructure entry (year=None) -- e.g. by slicing a year "
        "out of an SDF -- then superstructure databases have become "
        "computable, step 4 of the reasoning no longer follows, and whether "
        "the fallback should be opt-in is live again. See the module "
        "docstring."
    )


def test_a_superstructure_entry_is_actually_rejected(monkeypatch):
    """The behavioural half of the same link."""
    from mapper.core import plca_storage

    monkeypatch.setattr(plca_storage, "load_registry", lambda p: [
        {"name": "sup", "base_db": "ei", "iam": "remind", "ssp": "SSP2",
         "mode": "superstructure", "year": None, "years": [2025, 2030]},
        {"name": "sep", "base_db": "ei", "iam": "remind", "ssp": "SSP2",
         "mode": "separate", "year": 2030, "years": [2030]},
    ])
    import bw2data

    monkeypatch.setattr(bw2data, "databases", {"sup": {}, "sep": {}})
    out = plca_storage.resolve_prospective_dbs("proj", "ei", "remind", "SSP2")
    names = [n for n, _ in out]
    assert names == ["sep"], (
        f"expected the superstructure entry to be rejected, got {names}"
    )
