/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest'
import { render, within } from '@testing-library/react'
import {
  describeLayerSeries, resolveYearPair, seriesBadgeText,
} from '../src/utils/aesaSeries'
import { computeChainFactor, useAESAStore } from '../src/stores/aesaStore'
import { DownscalingChainEditor } from '../src/components/aesa/DownscalingChainEditor'
import type { LayerData, SharingPreset } from '../src/api/client'

// A sharing principle's share can now be read two ways between the years the
// user supplied: "step" (each value holds until the next year — the default,
// and the only behaviour that existed before) or "interpolate" (a straight
// line). The choice is per (layer, principle), because a population-based
// share is a curve while a historically-anchored one may be correct held flat.
//
// Two things are locked here:
//   1. The client-side resolver matches the backend's `_resolve_year`,
//      including that system and global are interpolated separately and then
//      divided. The chain editor shows a live factor preview; if the two
//      resolutions disagree, the preview lies about what Compute will do.
//   2. The chain editor SHOWS which principles carry a series and how each is
//      read — visibility, never a warning. Mixing a moving EpC with a frozen
//      AR is a legitimate methodological choice.

const TWO_POINT: LayerData[string] = { 2025: [100, 1000], 2050: [200, 1000] }

describe('resolveYearPair mirrors the backend resolver', () => {
  it('step holds the earlier value, then jumps (ties favour older)', () => {
    expect(resolveYearPair(TWO_POINT, 2037, 'step')).toEqual([100, 1000])
    expect(resolveYearPair(TWO_POINT, 2038, 'step')).toEqual([200, 1000])
  })

  it('interpolate draws a straight line between the supplied years', () => {
    const [sys, glob] = resolveYearPair(TWO_POINT, 2037, 'interpolate')!
    expect(sys).toBeCloseTo(100 + (12 / 25) * 100, 10)
    expect(glob).toBeCloseTo(1000, 10)
  })

  it('both modes agree exactly at the supplied years', () => {
    for (const y of [2025, 2050]) {
      expect(resolveYearPair(TWO_POINT, y, 'step'))
        .toEqual(resolveYearPair(TWO_POINT, y, 'interpolate'))
    }
  })

  it('a single-year entry is constant under both modes', () => {
    const one = { 2030: [7, 70] } as LayerData[string]
    for (const mode of ['step', 'interpolate'] as const) {
      for (const y of [1990, 2030, 2100]) {
        expect(resolveYearPair(one, y, mode)).toEqual([7, 70])
      }
    }
  })

  it('clamps outside the range under both modes — never extrapolates', () => {
    for (const mode of ['step', 'interpolate'] as const) {
      expect(resolveYearPair(TWO_POINT, 1900, mode)).toEqual([100, 1000])
      expect(resolveYearPair(TWO_POINT, 2200, mode)).toEqual([200, 1000])
    }
  })

  it('defaults to step when no mode is given', () => {
    expect(resolveYearPair(TWO_POINT, 2037)).toEqual(resolveYearPair(TWO_POINT, 2037, 'step'))
  })

  it('interpolates the components, then divides — not the ratio', () => {
    const data = { 2020: [100, 1000], 2040: [200, 4000] } as LayerData[string]
    const [sys, glob] = resolveYearPair(data, 2030, 'interpolate')!
    expect(sys / glob).toBeCloseTo(150 / 2500, 12)
    // The midpoint of the two ratios (0.1, 0.05) would be 0.075 — a number
    // matching no supplied datum.
    expect(sys / glob).not.toBeCloseTo(0.075, 6)
  })

  it('returns null when the principle has no data', () => {
    expect(resolveYearPair(undefined, 2030, 'step')).toBeNull()
    expect(resolveYearPair({}, 2030, 'interpolate')).toBeNull()
  })
})

// ── the preview must agree with Compute ─────────────────────────────────────

function presetWith(mode: 'step' | 'interpolate'): SharingPreset {
  return {
    id: 'p', name: 'p', description: '', built_in: false,
    principles: [{ id: 'EpC', name: 'Per capita', description: '' }],
    category_assignments: [{ pb_id: 'climate_change', principle_id: 'EpC', justification: '' }],
    chain: {
      layers: [{
        layer_number: 1, name: 'Global → DK', principle_mode: 'category_specific',
        fixed_principle: null, description: '',
        data: { EpC: TWO_POINT },
        resolution: mode === 'step' ? {} : { EpC: 'interpolate' },
      }],
    },
  } as any
}

describe('computeChainFactor honours the per-principle mode', () => {
  it('step gives the held value, interpolate the ramped one', () => {
    expect(computeChainFactor(presetWith('step'), 'climate_change', 2037))
      .toBeCloseTo(0.1, 12)
    expect(computeChainFactor(presetWith('interpolate'), 'climate_change', 2037))
      .toBeCloseTo((100 + (12 / 25) * 100) / 1000, 12)
  })

  it('agrees at the supplied years regardless of mode', () => {
    for (const y of [2025, 2050]) {
      expect(computeChainFactor(presetWith('step'), 'climate_change', y))
        .toBe(computeChainFactor(presetWith('interpolate'), 'climate_change', y))
    }
  })
})

// ── badge model ─────────────────────────────────────────────────────────────

describe('describeLayerSeries', () => {
  it('reports span, point count and mode per principle', () => {
    const shapes = describeLayerSeries(
      { EpC: TWO_POINT, AR: { 2025: [5, 100] } } as any,
      { EpC: 'interpolate' },
    )
    const byId = Object.fromEntries(shapes.map((s) => [s.principleId, s]))
    expect(byId.EpC).toMatchObject({
      points: 2, firstYear: 2025, lastYear: 2050, isSeries: true, mode: 'interpolate',
    })
    expect(byId.AR).toMatchObject({ points: 1, isSeries: false, mode: 'step' })
  })

  it('orders by principle id so badges do not reshuffle between renders', () => {
    const shapes = describeLayerSeries({ zeta: TWO_POINT, alpha: TWO_POINT } as any)
    expect(shapes.map((s) => s.principleId)).toEqual(['alpha', 'zeta'])
  })

  it('reads the mode as step when the layer has no resolution map at all', () => {
    // The shape every configuration written before the mode existed has.
    const [s] = describeLayerSeries({ EpC: TWO_POINT } as any, undefined)
    expect(s.mode).toBe('step')
  })

  it('renders a series as span + count + mode, a constant as one year', () => {
    expect(seriesBadgeText({
      principleId: 'EpC', points: 6, firstYear: 2025, lastYear: 2050,
      isSeries: true, mode: 'interpolate',
    })).toBe('2025–2050 · 6 pts · interpolate')
    expect(seriesBadgeText({
      principleId: 'AR', points: 1, firstYear: 2025, lastYear: 2025,
      isSeries: false, mode: 'step',
    })).toBe('2025 · single value')
  })
})

// ── the chain editor surfaces it ────────────────────────────────────────────

function seedDraft(resolution: Record<string, 'step' | 'interpolate'>) {
  useAESAStore.setState({
    draft: {
      name: 'cfg', boundary_set_id: 'Sala2020_EF',
      sharing: {
        id: 'p', name: 'p', description: '', built_in: false,
        principles: [
          { id: 'EpC', name: 'Per capita', description: '' },
          { id: 'AR', name: 'Acquired rights', description: '' },
        ],
        category_assignments: [
          { pb_id: 'climate_change', principle_id: 'EpC', justification: '' },
        ],
        chain: {
          layers: [{
            layer_number: 1, name: 'Global → DK',
            principle_mode: 'category_specific', fixed_principle: null,
            description: '',
            data: { EpC: TWO_POINT, AR: { 2025: [5, 100] } },
            resolution,
          }],
        },
      },
      sharing_preset_id: null, carbon_budget: null, method_mapping: [],
      impact_mode: 'static', dsm_scenario_id: null,
    },
  } as any)
}

describe('the chain editor shows series vs constant per principle', () => {
  it('labels a series with its span, point count and mode', () => {
    seedDraft({ EpC: 'interpolate' })
    const { getByTestId } = render(<DownscalingChainEditor previewYear={2037} />)
    const badges = getByTestId('layer-series-badges-0')
    expect(within(badges).getByTestId('layer-0-series-EpC').textContent)
      .toContain('2025–2050 · 2 pts · interpolate')
  })

  it('labels a single-value principle as a constant, with no mode', () => {
    seedDraft({ EpC: 'interpolate' })
    const { getByTestId } = render(<DownscalingChainEditor previewYear={2037} />)
    const ar = getByTestId('layer-0-series-AR').textContent ?? ''
    expect(ar).toContain('single value')
    // A constant cannot be read step-wise or interpolated differently, so
    // showing a mode there would be noise.
    expect(ar).not.toContain('step')
    expect(ar).not.toContain('interpolate')
  })

  it('shows a mixed chain without warning about it', () => {
    seedDraft({ EpC: 'interpolate' })
    const { container, getByTestId } = render(<DownscalingChainEditor previewYear={2037} />)
    expect(getByTestId('layer-0-series-EpC')).toBeTruthy()
    expect(getByTestId('layer-0-series-AR')).toBeTruthy()
    // Mixing is a legitimate methodological choice — the fix is visibility.
    expect(container.textContent?.toLowerCase()).not.toMatch(/warn|caution|inconsist/)
  })

  it('defaults the badge to step when the layer carries no resolution map', () => {
    seedDraft({})
    const { getByTestId } = render(<DownscalingChainEditor previewYear={2037} />)
    expect(getByTestId('layer-0-series-EpC').textContent).toContain('step')
  })

  it('editing a layer\'s data does not silently drop its resolution modes', () => {
    // The layer edit modal saves a patch through updateLayer. A patch that
    // rebuilt the layer rather than merging into it would quietly reset every
    // principle to step — a change of results with no visible cause.
    seedDraft({ EpC: 'interpolate' })
    useAESAStore.getState().updateLayer(0, {
      data: { EpC: TWO_POINT, AR: { 2025: [5, 100], 2050: [6, 100] } } as any,
    })
    const layer = useAESAStore.getState().draft!.sharing.chain.layers[0]
    expect(layer.resolution).toEqual({ EpC: 'interpolate' })
  })

  it('the factor preview uses the per-principle mode', () => {
    // Preview and Compute must not disagree. 2037 is 12/25 of the way from
    // 2025 to 2050, so under step the factor is the held 2025 value
    // 100/1000 = 10.00%, and under interpolate it is 148/1000 = 14.80%.
    seedDraft({})
    const stepped = render(<DownscalingChainEditor previewYear={2037} />)
    expect(stepped.container.textContent).toContain('10.00%')
    stepped.unmount()

    seedDraft({ EpC: 'interpolate' })
    const ramped = render(<DownscalingChainEditor previewYear={2037} />)
    expect(ramped.container.textContent).not.toContain('10.00%')
    expect(ramped.container.textContent).toContain('14.80%')
    // …and it is the same number the compute path would use.
    expect(computeChainFactor(presetWith('interpolate'), 'climate_change', 2037))
      .toBeCloseTo(0.148, 12)
  })
})
