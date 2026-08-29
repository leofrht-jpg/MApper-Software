# SPDX-License-Identifier: MPL-2.0
"""Score by material name — the primary scoring surface.

The property this file exists to pin is the one a reader will get wrong:
inheriting a score from the library shares the SCORE, never the DRAW. Two rows
inheriting one name are sampled independently, exactly as if the scores had
been typed onto each row.

That is worth a test rather than a comment because the expression-row rule
makes the opposite assumption reasonable — there a shared PARAMETER genuinely
does mean a shared draw, and drawing per-row instead collapses the spread.
"""

import numpy as np
import pytest

from mapper.core.monte_carlo_engine import collect_row_draws, lognormal_factor, sigma_of
from mapper.models.bom_schemas import (
    EcoinventLink,
    FlattenedMaterial,
    MaterialPedigreeLibrary,
    RowUncertainty,
)


def _m(node_id, name, expr=None, unc=None):
    return FlattenedMaterial(
        node_id=node_id, name=name, quantity=1.0, unit="kg",
        quantity_expression=expr, uncertainty=unc,
        ecoinvent_activity=EcoinventLink(database="db", code=f"c-{name}", name=name),
    )


LIB = {"Steel frame": RowUncertainty(pedigree={"reliability": 3})}


# ── resolution order ──────────────────────────────────────────────────────────


def test_a_row_inherits_the_score_for_its_name():
    draws = collect_row_draws([_m("n1", "Steel frame")], LIB)
    assert len(draws) == 1
    assert draws[0].inherited is True
    assert draws[0].sigma == pytest.approx(sigma_of(LIB["Steel frame"]))


def test_a_row_s_own_score_wins_over_the_library():
    own = RowUncertainty(pedigree={"reliability": 5})
    draws = collect_row_draws([_m("n1", "Steel frame", unc=own)], LIB)
    assert draws[0].inherited is False
    assert draws[0].sigma == pytest.approx(sigma_of(own))
    assert draws[0].sigma != pytest.approx(sigma_of(LIB["Steel frame"]))


def test_an_unlisted_name_stays_unscored():
    assert collect_row_draws([_m("n1", "Copper wiring")], LIB) == []


def test_an_empty_library_changes_nothing():
    assert collect_row_draws([_m("n1", "Steel frame")], {}) == []
    assert collect_row_draws([_m("n1", "Steel frame")], None) == []


def test_an_expression_row_takes_no_library_score():
    """It inherits from the PARAMETERS in its expression. Handing it a library
    score would reintroduce exactly the double-draw the expression rule bans."""
    draws = collect_row_draws([_m("n1", "Steel frame", expr="w_car * 0.3")], LIB)
    assert draws == []


def test_an_expression_row_carrying_its_own_still_raises_even_with_a_library():
    from mapper.core.monte_carlo_engine import UncertaintyConfigError

    with pytest.raises(UncertaintyConfigError, match="expression"):
        collect_row_draws(
            [_m("n1", "Steel frame", expr="w_car * 0.3", unc=RowUncertainty(pedigree={"reliability": 3}))],
            LIB,
        )


# ── the distinction that matters ──────────────────────────────────────────────


def test_inheritance_shares_the_SCORE_not_the_DRAW():
    """Two rows inheriting one name get two INDEPENDENT draws.

    The engine keys a draw by ``node_id``, never by name, so a shared name is
    two quantities that happen to be equally well known — not a shared driver.
    """
    draws = collect_row_draws([_m("n1", "Steel frame"), _m("n2", "Steel frame")], LIB)
    assert len(draws) == 2
    assert {d.node_id for d in draws} == {"n1", "n2"}
    assert draws[0].sigma == draws[1].sigma          # same score...
    assert draws[0].node_id != draws[1].node_id      # ...separate draws


def test_a_shared_name_does_NOT_behave_like_a_shared_parameter():
    """The measurable form of the rule above.

    If a shared name implied a shared draw, N rows would pass the driver's full
    spread through to the total. Independent draws average out instead. This
    test asserts the engine produces the INDEPENDENT shape, so a future change
    that keys draws by name shows up here as a spread that suddenly widens.
    """
    rng = np.random.default_rng(0)
    n_rows, n_iter = 25, 4000
    sigma = sigma_of(LIB["Steel frame"])

    draws = collect_row_draws([_m(f"n{i}", "Steel frame") for i in range(n_rows)], LIB)
    assert len({d.node_id for d in draws}) == n_rows, "each row must draw for itself"

    independent, shared = [], []
    for _ in range(n_iter):
        independent.append(sum(lognormal_factor(rng, d.sigma) for d in draws))
        z = lognormal_factor(rng, sigma)
        shared.append(n_rows * z)

    spread = lambda xs: float(np.std(np.log(np.asarray(xs))))
    # The independent shape is what the engine produces, and it is narrower.
    assert spread(independent) < spread(shared) / 3


# ── storage ───────────────────────────────────────────────────────────────────


def test_the_library_round_trips(tmp_path, monkeypatch):
    from mapper.core import dsm_storage, material_pedigree_storage

    monkeypatch.setattr(dsm_storage, "STORAGE_DIR", tmp_path)
    lib = MaterialPedigreeLibrary(entries={
        "Steel frame": RowUncertainty(pedigree={"reliability": 3}, basic_variance=0.01),
    })
    material_pedigree_storage.save_library("proj", lib)
    back = material_pedigree_storage.load_library("proj")
    assert back.entries["Steel frame"].pedigree == {"reliability": 3}
    assert back.entries["Steel frame"].basic_variance == 0.01


def test_a_missing_library_is_empty_not_an_error(tmp_path, monkeypatch):
    """Never-scored and file-missing are the same state, and every caller wants
    to look names up either way."""
    from mapper.core import dsm_storage, material_pedigree_storage

    monkeypatch.setattr(dsm_storage, "STORAGE_DIR", tmp_path)
    assert material_pedigree_storage.load_library("nope").entries == {}


def test_a_corrupt_library_reads_as_unscored_rather_than_taking_the_project_down(tmp_path, monkeypatch):
    """Unscored is the safe reading: it changes no number."""
    from mapper.core import dsm_storage, material_pedigree_storage

    monkeypatch.setattr(dsm_storage, "STORAGE_DIR", tmp_path)
    p = material_pedigree_storage.library_path("proj")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("{ not json", encoding="utf-8")
    assert material_pedigree_storage.load_library("proj").entries == {}


def test_the_library_lives_inside_the_dsm_root_so_it_is_carried_for_free(tmp_path, monkeypatch):
    """A FILE in an existing root, not a sixth root — so duplicate, rename,
    export and import carry it with no change to project_storage.py, and an
    older build cannot silently drop it from an archive."""
    from mapper.core import dsm_storage, material_pedigree_storage

    monkeypatch.setattr(dsm_storage, "STORAGE_DIR", tmp_path)
    p = material_pedigree_storage.library_path("My Project")
    assert p.parent.parent == tmp_path
    assert p.name == "material_pedigree.json"

    from mapper.core.project_storage import storage_roots
    assert "material_pedigree" not in storage_roots()


# ── the invariant ─────────────────────────────────────────────────────────────


def test_a_project_with_no_scores_is_still_unchanged():
    """The library must not change the default state. An empty library plus
    unscored rows produces no foreground draws at all."""
    rows = [_m(f"n{i}", f"Material {i}") for i in range(40)]
    assert collect_row_draws(rows, {}) == []
    assert collect_row_draws(rows, None) == []
