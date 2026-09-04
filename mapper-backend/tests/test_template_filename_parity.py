# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""ONE download-filename convention: ``{Entity}_{artifact}[_template].{ext}``.

There were THREE in a single download menu:

    systems      Car_Fleet_cohort_mappings_template.xlsx        entity first
    DSM system   stock_template_Car_Fleet.xlsx                  artifact first
    subsystems   cohort_mapping_fueling_infrastructure_...xlsx  artifact first,
                                                                LOWERCASED, singular

and two of the subsystem artifacts carried no entity name at all
(``dependency_rules_template.xlsx``, ``initial_stock_template.xlsx``).

Underneath, FOUR sanitisers disagreed on the interesting names:

    Fleet (EU)  ->  bom/dsm 'Fleet_EU'   parameters 'Fleet_EU_'   export 'Fleet_(EU)'

All four now delegate to ``sanitize_filename_part``. Parentheses are KEPT --
``Fleet (EU)`` and ``Fleet EU`` are different systems and must not collide --
which also means every existing ``_LCA.xlsx`` / ``_AESA.xlsx`` export keeps the
name it has today.
"""
from __future__ import annotations

import ast
import pathlib

import pytest

from mapper.api.bom import build_template_filename, sanitize_filename_part

# [entity, artifact, suffix, template, expected]
#
# Duplicated VERBATIM in mapper-frontend/tests/templateFilename.test.ts, the
# same discipline test_export_filename_parity.py uses -- the two builders set
# Content-Disposition and the browser `a.download` respectively, so they cannot
# be allowed to drift.
TEMPLATE_PARITY_FIXTURES = [
    # The shape that was already right, and stays byte-identical.
    ("Car Fleet", "cohort_mappings", "xlsx", True,
     "Car_Fleet_cohort_mappings_template.xlsx"),
    # Subsystem: was cohort_mapping_fueling_infrastructure_template.xlsx --
    # artifact first, LOWERCASED, singular noun.
    ("Fueling Infrastructure", "cohort_mappings", "xlsx", True,
     "Fueling_Infrastructure_cohort_mappings_template.xlsx"),
    # Was the entity-less "dependency_rules_template.xlsx".
    ("Fueling Infrastructure", "dependency_rules", "xlsx", True,
     "Fueling_Infrastructure_dependency_rules_template.xlsx"),
    # Was the entity-less "initial_stock_template.xlsx".
    ("Fueling Infrastructure", "initial_stock", "xlsx", True,
     "Fueling_Infrastructure_initial_stock_template.xlsx"),
    # DSM system templates: were artifact-first, stock_template_Car_Fleet.xlsx.
    ("Car Fleet", "stock", "xlsx", True, "Car_Fleet_stock_template.xlsx"),
    ("Car Fleet", "outflows", "xlsx", True, "Car_Fleet_outflows_template.xlsx"),
    # CSV suffix still round-trips through the same builder.
    ("Fueling Infrastructure", "manual_inflows", "csv", True,
     "Fueling_Infrastructure_manual_inflows_template.csv"),
    # PARENTHESES ARE KEPT. This is the case that exposed the divergence:
    # bom/dsm/parameters each stripped or replaced them differently, and
    # `Fleet (EU)` collapsing to `Fleet_EU` would collide with a real
    # `Fleet EU`.
    ("Fleet (EU)", "stock", "xlsx", True, "Fleet_(EU)_stock_template.xlsx"),
    # Spaces AND parentheses AND a hyphen, all at once.
    ("WP5 - DK (2025-50)", "dependency_rules", "xlsx", True,
     "WP5_-_DK_(2025-50)_dependency_rules_template.xlsx"),
    # THE TRAILING-UNDERSCORE CASE. This is the one real behavioural change:
    # the `parameters` variant never stripped, so it alone returned
    # 'Car_Fleet_(EU)_'. Expected here WITHOUT the trailing underscore, so a
    # regression to that variant fails on this row and nothing else.
    ("Car Fleet (EU) ", "stock", "xlsx", True, "Car_Fleet_(EU)_stock_template.xlsx"),
    # Same again with the underscore fully internal, so the failure cannot be
    # mistaken for a trim-only difference.
    ("  Fleet  ", "initial_stock", "xlsx", True, "Fleet_initial_stock_template.xlsx"),
    # template=False drops the suffix word but keeps the order.
    ("Car Fleet", "cohort_mappings", "xlsx", False, "Car_Fleet_cohort_mappings.xlsx"),
    # Empty name falls back rather than producing "_stock_template.xlsx".
    ("", "stock", "xlsx", True, "entity_stock_template.xlsx"),
]


@pytest.mark.parametrize("entity,artifact,suffix,template,expected", TEMPLATE_PARITY_FIXTURES)
def test_template_filename_fixtures(entity, artifact, suffix, template, expected):
    assert build_template_filename(entity, artifact, suffix=suffix, template=template) == expected


def test_all_four_sanitisers_now_agree():
    """The divergence itself, pinned.

    `Fleet (EU)` is the case that exposed it: three answers to one question,
    and the new helper would have been a fourth.
    """
    from mapper.api.bom import _sanitize_filename as b
    from mapper.api.dsm import _sanitize_filename as d
    from mapper.api.parameters import _sanitize_filename as p

    for name in ("Fleet (EU)", "Car Fleet", "WP5 - DK (2025-50)", "  spaced  ",
                 "Car Fleet (EU) "):
        answers = {b(name), d(name), p(name)}
        assert len(answers) == 1, f"{name!r} still gets {answers}"


def test_the_trailing_underscore_variant_is_gone():
    """The one real behavioural change, isolated.

    `parameters` never stripped, so it alone returned 'Car_Fleet_(EU)_'. If it
    comes back, this fails and nothing else does.
    """
    assert sanitize_filename_part("Car Fleet (EU) ") == "Car_Fleet_(EU)"
    assert not sanitize_filename_part("Car Fleet (EU) ").endswith("_")


def test_parentheses_are_kept_so_two_systems_cannot_collide():
    assert sanitize_filename_part("Fleet (EU)") != sanitize_filename_part("Fleet EU")


def test_a_system_and_a_subsystem_produce_the_SAME_SHAPE():
    """The invariant the whole patch exists for.

    Same artifact type, two entity kinds, one shape -- so the two paths cannot
    drift apart again the way they had.
    """
    sysname, subname, artifact = "Car Fleet", "Fueling Infrastructure", "cohort_mappings"
    a = build_template_filename(sysname, artifact, fallback="system")
    b = build_template_filename(subname, artifact, fallback="subsystem")
    assert a == f"{sanitize_filename_part(sysname)}_{artifact}_template.xlsx"
    assert b == f"{sanitize_filename_part(subname)}_{artifact}_template.xlsx"
    # Shape equality stated structurally: strip the entity, the rest is identical.
    assert a[len(sanitize_filename_part(sysname)):] == b[len(sanitize_filename_part(subname)):]


# ── The one exemption, stated loudly ───────────────────────────────────────

def test_dimension_labels_are_NOT_routed_through_the_helper():
    """`{dimension}_labels.csv` is an UPLOAD CONTRACT, not a display name.

    `parse_label_file` (core/dsm_engine.py) parses the dimension OUT of the
    basename and REJECTS a mismatch:

        Enforces:
          * filename basename matches `{expected_dimension}_labels` exactly

    Renaming it to `{Dim}_labels_template.csv` would break every labels upload.
    This is why the exemption is a test and not a comment -- a quiet exception
    is one somebody tidies away in six months.
    """
    src = (pathlib.Path(__file__).resolve().parents[1]
           / "mapper" / "core" / "dsm_engine.py").read_text(encoding="utf-8")
    assert "LABEL_FILENAME_RE" in src, (
        "parse_label_file no longer matches on the basename. If the filename is "
        "no longer an upload contract, the labels download MAY join the shared "
        "convention -- but verify the parser first."
    )

    fe = (pathlib.Path(__file__).resolve().parents[2] / "mapper-frontend"
          / "src" / "components" / "dsm" / "DimensionsEditor.tsx")
    if fe.exists():
        assert "buildTemplateFilename" not in fe.read_text(encoding="utf-8"), (
            "DimensionsEditor now builds the labels filename through the shared "
            "helper. That renames it and breaks parse_label_file."
        )


# ── No path may reinvent a filename ────────────────────────────────────────

def test_no_template_route_builds_its_own_filename():
    """Every template download goes through the helper.

    Catches the next hand-rolled f-string before it becomes a fourth
    convention.
    """
    pkg = pathlib.Path(__file__).resolve().parents[1] / "mapper"
    offenders: list[str] = []
    for rel in ("api/bom.py", "api/dsm.py", "api/subsystems.py"):
        tree = ast.parse((pkg / rel).read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.JoinedStr):
                continue
            text = ast.unparse(node)
            if "_template." in text and ".xlsx" in text or "_template.csv" in text:
                offenders.append(f"{rel}:{node.lineno}: {text[:70]}")
    assert not offenders, (
        "these build a template filename by hand instead of calling "
        f"build_template_filename: {offenders}"
    )
