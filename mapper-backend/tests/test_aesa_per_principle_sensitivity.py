# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Patch 2b (Option 1) — per-principle downscaling in the σ sensitivity sweep.

`compute_with_sensitivity` already flips every *category_specific* layer to the
tested principle. Patch 2b extends this so a *fixed* layer ALSO resolves to the
tested principle P — but only when the layer carries data for P ("has data" =
P present in `layer.data` AND non-empty); otherwise it FALLS BACK to the layer's
`fixed_principle`. A single-principle fixed layer (the built-in Multi-D shape)
therefore stays invariant across the sweep → no SR drift.

Scope: sensitivity path only. Primary compute() and the schema are unchanged.
The per-principle fixed-layer editor is Phase 4; this patch makes the capability
functional via existing/importable data.
"""
from __future__ import annotations

from mapper.core.aesa_engine import (
    AESAEngine,
    build_default_sharing_preset,
    load_boundary_sets,
    suggest_method_mapping,
)
from mapper.models.aesa_schemas import (
    AESAConfiguration,
    AESAComputeResult,
    CategoryAssignment,
    DownscalingChain,
    DownscalingLayer,
    PrincipleDefinition,
    SharingPreset,
)
from mapper.models.bom_schemas import DSMLCAResult, DSMLCASummary, DSMLCAYearResult


# ── fixtures ─────────────────────────────────────────────────────────────────

def _impact() -> list[DSMLCAResult]:
    """Climate + acidification at one year (mirrors the 2a fixture)."""
    climate = DSMLCAResult(
        mfa_system_id="sys-1",
        method=["EF v3.1", "climate change", "global warming potential (GWP100)"],
        method_label="EF v3.1 › climate change › GWP100", scope="stock", unit="kg CO2 eq",
        years=[DSMLCAYearResult(year=2030, total_impact=6.0e9, unit="kg CO2 eq",
                                impact_by_cohort={"BEV": 6.0e9}, impact_by_material={}, count_by_cohort={})],
        summary=DSMLCASummary(total_impact=6.0e9, peak_year=2030, peak_impact=6.0e9),
    )
    acid = DSMLCAResult(
        mfa_system_id="sys-1",
        method=["EF v3.1", "acidification", "accumulated exceedance (AE)"],
        method_label="EF v3.1 › acidification › AE", scope="stock", unit="mol H+ eq",
        years=[DSMLCAYearResult(year=2030, total_impact=1.0e8, unit="mol H+ eq",
                                impact_by_cohort={"BEV": 1.0e8}, impact_by_material={}, count_by_cohort={})],
        summary=DSMLCASummary(total_impact=1.0e8, peak_year=2030, peak_impact=1.0e8),
    )
    return [climate, acid]


def _builtin_config() -> tuple[AESAConfiguration, object]:
    """The built-in Multi-D preset — fixed layers carry only their
    fixed_principle's data, the no-drift case."""
    bset = load_boundary_sets()["Sala2020_EF"]
    methods = [["EF v3.1", "climate change", "global warming potential (GWP100)"],
               ["EF v3.1", "acidification", "accumulated exceedance (AE)"]]
    mapping = suggest_method_mapping(methods, bset)
    config = AESAConfiguration(
        id="cfg-builtin", name="builtin", mfa_system_id="sys-1", impact_mode="static",
        sharing=build_default_sharing_preset(),
        sharing_preset_id="ferhati_2026_multi_d",
        method_mapping=mapping, multi_d=None,
        created_at="2025-01-01T00:00:00Z",
    )
    return config, bset


def _per_principle_config() -> tuple[AESAConfiguration, object]:
    """A preset whose single FIXED layer carries DISTINCT per-principle data
    (EpC vs AR differ) plus a present-but-empty principle and an absent one.
    This is the shape an import would produce before the Phase-4 editor exists.

    fixed_principle = EpC; factor = sys/glob:
      EpC   → 2/1000 = 0.002   (the fallback value)
      AR    → 5/1000 = 0.005   (distinct → varies)
      EMPTY → {} present-but-empty → treated as absent → fallback to EpC (0.002)
      GDP   → absent → fallback to EpC (0.002)
    """
    bset = load_boundary_sets()["Sala2020_EF"]
    methods = [["EF v3.1", "acidification", "accumulated exceedance (AE)"]]
    mapping = suggest_method_mapping(methods, bset)
    preset = SharingPreset(
        id="tpl-perprinciple", name="Per-principle fixed layer", built_in=False,
        principles=[
            PrincipleDefinition(id="EpC", name="Equal per capita"),
            PrincipleDefinition(id="AR", name="Acquired rights"),
            PrincipleDefinition(id="GDP", name="GDP share"),
            PrincipleDefinition(id="EMPTY", name="Empty-data principle"),
        ],
        category_assignments=[],  # single fixed layer → assignments irrelevant
        chain=DownscalingChain(layers=[
            DownscalingLayer(
                layer_number=1, name="Fixed (per-principle data)",
                principle_mode="fixed", fixed_principle="EpC",
                data={
                    "EpC": {2030: (2.0, 1000.0)},
                    "AR": {2030: (5.0, 1000.0)},
                    "EMPTY": {},  # present-but-empty → fallback, not zero
                    # GDP intentionally absent → fallback
                },
            ),
        ]),
        created_at="2025-01-01T00:00:00Z",
    )
    config = AESAConfiguration(
        id="cfg-perprinciple", name="perprinciple", mfa_system_id="sys-1", impact_mode="static",
        sharing=preset, sharing_preset_id="tpl-perprinciple",
        method_mapping=mapping, multi_d=None,
        created_at="2025-01-01T00:00:00Z",
    )
    return config, bset


def _sig(rows):
    return sorted((r.pb_id, r.year, r.impact, r.allocated_sos, r.sr) for r in rows)


def _acid_alloc(sensitivity, pid) -> float:
    rows = [r for r in sensitivity[pid] if r.pb_id == "acidification"]
    assert rows, f"no acidification row for principle {pid}"
    return rows[0].allocated_sos


# ── NO-DRIFT (the gate) ──────────────────────────────────────────────────────

def test_builtin_sensitivity_no_drift():
    """For the built-in Multi-D preset (fixed layers single-principle), the
    patched sweep is byte-identical to the PRE-patch behaviour (vary only the
    category_specific layer; fixed layers untouched)."""
    impact = _impact()
    config, bset = _builtin_config()
    preset = config.sharing

    patched = AESAEngine.compute_with_sensitivity(impact, config, bset).sensitivity

    # Reproduce the pre-patch sweep verbatim: only category_assignments change,
    # the chain (and thus the fixed layers) is left as-is.
    cat_layers = [ly for ly in preset.chain.layers if ly.principle_mode == "category_specific"]
    baseline: dict[str, list] = {}
    for principle in preset.principles:
        if cat_layers and not all(principle.id in ly.data for ly in cat_layers):
            continue
        variant_assignments = [
            CategoryAssignment(pb_id=a.pb_id, principle_id=principle.id, justification=a.justification)
            for a in preset.category_assignments
        ]
        vp = preset.model_copy(update={"category_assignments": variant_assignments})
        vc = config.model_copy(update={"sharing": vp, "multi_d": None})
        baseline[principle.id] = AESAEngine.compute(impact, vc, bset).results

    assert set(patched) == set(baseline), "principle key set changed"
    assert baseline, "expected at least one tested principle"
    for pid in baseline:
        assert _sig(patched[pid]) == _sig(baseline[pid]), f"SR drift on principle {pid}"


def test_primary_compute_unchanged():
    """The base (primary) result inside compute_with_sensitivity equals a
    standalone compute() — the primary path is not touched by 2b."""
    impact = _impact()
    config, bset = _builtin_config()
    base = AESAEngine.compute(impact, config, bset)
    via_sweep = AESAEngine.compute_with_sensitivity(impact, config, bset)
    assert _sig(via_sweep.results) == _sig(base.results)


# ── NEW capability ───────────────────────────────────────────────────────────

def test_fixed_layer_varies_per_principle_when_data_present():
    """A fixed layer carrying distinct per-principle data varies in the sweep:
    the AR variant uses AR's factor (0.005), the EpC variant uses EpC's (0.002)."""
    impact = _impact()
    config, bset = _per_principle_config()
    sens = AESAEngine.compute_with_sensitivity(impact, config, bset).sensitivity

    epc = _acid_alloc(sens, "EpC")
    ar = _acid_alloc(sens, "AR")
    assert ar != epc, "fixed layer did not vary per tested principle"
    # AR factor 0.005 vs EpC 0.002 → allocated SOS ratio 2.5×.
    assert abs(ar / epc - 2.5) < 1e-9


def test_fixed_layer_falls_back_when_principle_absent():
    """A principle absent on the fixed layer (GDP) falls back to fixed_principle
    (EpC) → its allocated SOS matches the EpC variant exactly."""
    impact = _impact()
    config, bset = _per_principle_config()
    sens = AESAEngine.compute_with_sensitivity(impact, config, bset).sensitivity
    assert _acid_alloc(sens, "GDP") == _acid_alloc(sens, "EpC")


def test_empty_principle_data_falls_back_not_zero():
    """data[P] present-but-empty is treated as ABSENT → fallback to
    fixed_principle, NOT a zero factor."""
    impact = _impact()
    config, bset = _per_principle_config()
    sens = AESAEngine.compute_with_sensitivity(impact, config, bset).sensitivity
    empty_alloc = _acid_alloc(sens, "EMPTY")
    assert empty_alloc > 0, "present-but-empty data wrongly produced a zero factor"
    assert empty_alloc == _acid_alloc(sens, "EpC")  # fell back to fixed_principle


def test_variant_does_not_mutate_original_preset():
    """The per-variant chain copy must not mutate the config's stored layers —
    the original fixed_principle survives the sweep."""
    impact = _impact()
    config, bset = _per_principle_config()
    before = config.sharing.chain.layers[0].fixed_principle
    AESAEngine.compute_with_sensitivity(impact, config, bset)
    assert config.sharing.chain.layers[0].fixed_principle == before == "EpC"
