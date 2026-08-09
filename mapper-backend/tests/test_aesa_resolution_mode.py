# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Per-principle temporal resolution on a sharing chain.

The engine already resolved a share per assessment year; what it could not do
was read the years BETWEEN the ones supplied any way but nearest-neighbour.
With anchors at 2025 and 2050, 2037 took the 2025 value and 2038 jumped to
2050 — a step, not a ramp.

That is wrong for a population-based share (EpC rests on a projection, which
is a curve) and defensible for a historically-anchored one (AR, acquired
rights). So the mode is per (layer, principle), not global, and "step" stays
the default so nothing already written moves.

The acceptance criterion is backward compatibility, pinned three ways:
  * ``test_shipped_template_sharing_factors_are_unchanged`` — hex-exact factors
    from the shipped Ferhati Multi-D template, captured before the change.
  * ``test_explicit_step_is_indistinguishable_from_the_default``
  * ``test_shipped_template_carries_no_resolution_and_one_point_per_principle``
"""
from __future__ import annotations

import pytest

from mapper.core.aesa_engine import (
    AESAEngine,
    build_carbon_budget,
    build_default_sharing_preset,
    load_boundary_sets,
    suggest_method_mapping,
)
from mapper.models.aesa_schemas import (
    AESAConfiguration,
    CategoryAssignment,
    DownscalingChain,
    DownscalingLayer,
    PrincipleDefinition,
    SharingPreset,
    _resolve_year,
)
from mapper.models.bom_schemas import DSMLCAResult, DSMLCASummary, DSMLCAYearResult

# A two-point series: system doubles, global stays put, so the factor at the
# anchors is 0.1 and 0.2 and the arithmetic is checkable by eye.
TWO_POINT = {2025: (100.0, 1000.0), 2050: (200.0, 1000.0)}


# ── the resolver itself ──────────────────────────────────────────────────────


def test_step_holds_the_earlier_value_then_jumps():
    # Nearest-neighbour with ties favouring older: the midpoint 2037.5 falls
    # to 2025's side at 2037 and to 2050's at 2038.
    assert _resolve_year(TWO_POINT, 2037, "step") == (100.0, 1000.0)
    assert _resolve_year(TWO_POINT, 2038, "step") == (200.0, 1000.0)


def test_interpolate_draws_a_straight_line():
    # 2037 is 12/25 of the way from 2025 to 2050.
    sys_v, glob_v = _resolve_year(TWO_POINT, 2037, "interpolate")
    assert sys_v == pytest.approx(100.0 + (12 / 25) * 100.0)
    assert glob_v == pytest.approx(1000.0)
    # And the next year is one step further along, not a cliff.
    nxt, _ = _resolve_year(TWO_POINT, 2038, "interpolate")
    assert nxt == pytest.approx(100.0 + (13 / 25) * 100.0)
    assert nxt > sys_v


def test_both_modes_agree_exactly_at_the_supplied_years():
    for year in TWO_POINT:
        assert _resolve_year(TWO_POINT, year, "step") == \
               _resolve_year(TWO_POINT, year, "interpolate")


def test_a_single_year_entry_is_constant_under_both_modes():
    one = {2030: (7.0, 70.0)}
    for year in (1990, 2030, 2100):
        assert _resolve_year(one, year, "step") == (7.0, 70.0)
        assert _resolve_year(one, year, "interpolate") == (7.0, 70.0)


@pytest.mark.parametrize("mode", ["step", "interpolate"])
def test_clamped_outside_the_supplied_range_no_extrapolation(mode):
    # Before the first anchor and after the last, both modes hold the
    # endpoint. Extrapolating would invent an assumption the user never made.
    assert _resolve_year(TWO_POINT, 1900, mode) == (100.0, 1000.0)
    assert _resolve_year(TWO_POINT, 2200, mode) == (200.0, 1000.0)


def test_no_data_stays_none_under_both_modes():
    for mode in ("step", "interpolate"):
        assert _resolve_year(None, 2030, mode) is None
        assert _resolve_year({}, 2030, mode) is None


def test_interpolate_divides_after_interpolating_not_before():
    """System and global are interpolated separately, then divided.

    The ratio of two linear series is not linear, so the two orders give
    different numbers. Interpolating the components is the one that matches
    what the user would get by supplying that year's two quantities directly.
    """
    data = {2020: (100.0, 1000.0), 2040: (200.0, 4000.0)}
    layer = DownscalingLayer(
        layer_number=1, name="L", principle_mode="fixed", fixed_principle="EpC",
        data={"EpC": data}, resolution={"EpC": "interpolate"},
    )
    got = layer.compute_factor("any_pb", 2030, {})
    # Components at the midpoint: 150 / 2500.
    assert got == pytest.approx(150.0 / 2500.0)
    # NOT the midpoint of the two ratios (0.1 and 0.05 → 0.075).
    assert got != pytest.approx((0.1 + 0.05) / 2)


# ── scope: the mode is per (layer, principle) ────────────────────────────────


def _mixed_layer() -> DownscalingLayer:
    """One layer, two principles, different modes — the case the scoping
    decision exists for: a moving EpC beside a frozen AR."""
    return DownscalingLayer(
        layer_number=1, name="Global → Denmark",
        principle_mode="category_specific",
        data={
            "EpC": {2025: (100.0, 1000.0), 2050: (200.0, 1000.0)},
            "AR": {2025: (100.0, 1000.0), 2050: (200.0, 1000.0)},
        },
        resolution={"EpC": "interpolate"},  # AR left at the default
    )


def test_two_principles_on_one_layer_resolve_differently():
    layer = _mixed_layer()
    assignments = {"pb_moving": "EpC", "pb_frozen": "AR"}
    moving = layer.compute_factor("pb_moving", 2037, assignments)
    frozen = layer.compute_factor("pb_frozen", 2037, assignments)
    assert moving == pytest.approx((100.0 + (12 / 25) * 100.0) / 1000.0)
    assert frozen == pytest.approx(0.1)  # held at the 2025 value
    assert moving != frozen


def test_resolution_for_defaults_to_step_for_unlisted_principles():
    layer = _mixed_layer()
    assert layer.resolution_for("EpC") == "interpolate"
    assert layer.resolution_for("AR") == "step"
    assert layer.resolution_for("never_configured") == "step"


def test_explicit_step_is_normalised_away():
    """One behaviour, one representation.

    Storing an explicit "step" would give a default two spellings, and then
    round-trip equality would depend on which one a configuration happened to
    take. The model drops it, so ``resolution`` only ever holds deviations.
    """
    layer = DownscalingLayer(
        layer_number=1, name="L", principle_mode="fixed", fixed_principle="EpC",
        data={"EpC": TWO_POINT},
        resolution={"EpC": "step", "AR": "interpolate"},
    )
    assert layer.resolution == {"AR": "interpolate"}
    assert layer.resolution_for("EpC") == "step"


def test_an_unknown_mode_is_rejected_by_the_schema():
    with pytest.raises(Exception):
        DownscalingLayer(
            layer_number=1, name="L", principle_mode="fixed", fixed_principle="EpC",
            data={"EpC": TWO_POINT}, resolution={"EpC": "linear"},
        )


# ── the regression gate: the shipped Ferhati Multi-D template ────────────────

# Hex-exact, captured from a compute run BEFORE the resolution mode existed.
# float.hex() rather than a decimal literal: 0.1 and 0.10000000000000001 print
# the same and are not the same number, and "bit-identical" was the criterion.
#
# These are the total sharing factors (the product of every layer factor) that
# the shipped template produces — precisely the quantity a resolution-mode
# regression would move. A failure here means either the engine drifted or the
# shipped template's data changed; both need a human, not a re-baseline.
# RE-BASELINED when acidification's default principle changed EpC -> AGR.
# This test SHOULD have failed on that change — a hex pin whose whole purpose
# is to catch an unintended shift in the shipped template. The shift was
# intended, so the value was re-captured from the engine (never hand-typed) and
# the reason recorded here. Only acidification moved; the other three are
# byte-identical, which is the right blast radius for a single-boundary
# principle change. new/old = 3.792713, exactly the AGR/EpC layer-1 ratio
# (12e9/4.3e12 over 5.96e6/8.1e9) — the factor moved by precisely the amount
# the methodology change implies and nothing else.
SHIPPED_TOTAL_SHARING_FACTOR = {
    "acidification": float.fromhex("0x1.b6f05496504cfp-12"),
    "climate_change": float.fromhex("0x1.ceed486562f98p-14"),
    "land_use": float.fromhex("0x1.6c124a3312625p-15"),
    "water_use": float.fromhex("0x1.ceed486562f98p-14"),
}

_GATE_YEARS = [2025, 2030, 2032, 2037, 2038, 2041, 2050]
_GATE_METHODS = [
    (["EF v3.1", "climate change", "global warming potential (GWP100)"], "kg CO2 eq", 6.0e9),
    (["EF v3.1", "acidification", "accumulated exceedance (AE)"], "mol H+ eq", 1.0e8),
    (["EF v3.1", "land use", "soil quality index"], "dimensionless", 3.0e10),
    (["EF v3.1", "water use",
      "user deprivation potential (deprivation-weighted water consumption)"],
     "m3 world eq. deprived", 4.2e8),
]


def _gate_impact() -> list[DSMLCAResult]:
    out = []
    for method, unit, base in _GATE_METHODS:
        years = [
            DSMLCAYearResult(
                year=y, total_impact=base * (1.0 + 0.037 * (y - 2025)), unit=unit,
                impact_by_cohort={"BEV": base * (1.0 + 0.037 * (y - 2025))},
                impact_by_material={}, count_by_cohort={},
            )
            for y in _GATE_YEARS
        ]
        out.append(DSMLCAResult(
            mfa_system_id="sys-1", method=method, method_label=" > ".join(method),
            scope="stock", unit=unit, years=years,
            summary=DSMLCASummary(
                total_impact=sum(y.total_impact for y in years),
                peak_year=_GATE_YEARS[-1], peak_impact=years[-1].total_impact,
            ),
        ))
    return out


def _gate_config(preset: SharingPreset, with_budget: bool = False):
    bset = load_boundary_sets()["Sala2020_EF"]
    cfg = AESAConfiguration(
        id="cfg-gate", name="gate", mfa_system_id="sys-1", impact_mode="static",
        sharing=preset, sharing_preset_id="ferhati_2026_multi_d",
        method_mapping=suggest_method_mapping([m for m, _, _ in _GATE_METHODS], bset),
        multi_d=None,
        carbon_budget=build_carbon_budget() if with_budget else None,
        created_at="2025-01-01T00:00:00Z",
    )
    return cfg, bset


def test_shipped_template_carries_no_resolution_and_one_point_per_principle():
    """Whether the shipped template's principles should carry projections is a
    methodological call, not a code change. This pins that the patch did not
    quietly make one: every principle still holds a single year, and no
    resolution mode is set — so the mode cannot alter its results at all."""
    preset = build_default_sharing_preset()
    for layer in preset.chain.layers:
        assert layer.resolution == {}, layer.name
        for principle_id, years in layer.data.items():
            assert len(years) == 1, f"{layer.name}/{principle_id} gained points"


def test_shipped_template_sharing_factors_are_unchanged():
    cfg, bset = _gate_config(build_default_sharing_preset())
    result = AESAEngine.compute(_gate_impact(), cfg, bset)
    assert result.results, "no SR rows computed — the gate would pass vacuously"
    for row in result.results:
        expected = SHIPPED_TOTAL_SHARING_FACTOR.get(row.pb_id)
        if expected is None:
            continue
        # Exact equality, not approx: the claim is bit-identity.
        assert row.total_sharing_factor == expected, (
            f"{row.pb_id} @ {row.year}: "
            f"{row.total_sharing_factor.hex()} != {expected.hex()}"
        )


@pytest.mark.parametrize("with_budget", [False, True])
def test_explicit_step_is_indistinguishable_from_the_default(with_budget):
    """Setting every principle to "step" explicitly must change nothing —
    on the flow path and on the cumulative carbon-budget path alike."""
    default_preset = build_default_sharing_preset()

    stepped = build_default_sharing_preset()
    stepped = stepped.model_copy(update={
        "chain": DownscalingChain(layers=[
            ly.model_copy(update={"resolution": {p: "step" for p in ly.data}})
            for ly in stepped.chain.layers
        ]),
    })

    a = AESAEngine.compute(_gate_impact(), *_gate_config(default_preset, with_budget))
    b = AESAEngine.compute(_gate_impact(), *_gate_config(stepped, with_budget))

    assert [r.model_dump() for r in a.results] == [r.model_dump() for r in b.results]
    assert [s.model_dump() for s in a.summary_by_year] == \
           [s.model_dump() for s in b.summary_by_year]


def test_interpolate_changes_results_only_between_supplied_years():
    """The mode is inert where it should be and live where it should be."""
    principles = [PrincipleDefinition(id="EpC", name="Per capita")]
    def _preset(mode: str) -> SharingPreset:
        return SharingPreset(
            id="p", name="p", description="", built_in=False,
            principles=principles,
            category_assignments=[
                CategoryAssignment(pb_id="climate_change", principle_id="EpC"),
            ],
            chain=DownscalingChain(layers=[DownscalingLayer(
                layer_number=1, name="L", principle_mode="category_specific",
                data={"EpC": TWO_POINT}, resolution={"EpC": mode},
            )]),
        )

    step_layer = _preset("step").chain.layers[0]
    interp_layer = _preset("interpolate").chain.layers[0]
    assignments = {"climate_change": "EpC"}

    # At the anchors and outside the range: identical.
    for year in (1990, 2025, 2050, 2100):
        assert step_layer.compute_factor("climate_change", year, assignments) == \
               interp_layer.compute_factor("climate_change", year, assignments)
    # In between: different, and the interpolated one is strictly rising.
    mids = [interp_layer.compute_factor("climate_change", y, assignments)
            for y in range(2026, 2050)]
    assert mids == sorted(mids)
    assert len(set(mids)) == len(mids)
    assert step_layer.compute_factor("climate_change", 2037, assignments) != mids[11]
