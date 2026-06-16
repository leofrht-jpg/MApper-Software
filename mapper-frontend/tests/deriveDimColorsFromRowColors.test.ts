import { describe, it, expect } from 'vitest'
import { deriveDimColorsFromRowColors } from '../src/utils/dsmCohortColors'
import type { DimensionDef } from '../src/api/client'

// Patch 4AK² — derive per-dim color overrides from per-row colors at
// Excel upload time. Pure function; no store / no localStorage.

const FUEL: DimensionDef = {
  name: 'fuel_type', is_age: false,
  labels: ['BEV-LFP', 'HEV-LFP', 'ICEV-Petrol'],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any
const SIZE: DimensionDef = {
  name: 'size', is_age: false,
  labels: ['Small', 'Sedan', 'SUV'],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any
const DIMS: readonly DimensionDef[] = [FUEL, SIZE]

describe('deriveDimColorsFromRowColors — single-color-per-fuel case', () => {
  it('derives per-dim color when every (BEV-LFP, *) row shares one color', () => {
    const rowColors = {
      'BEV-LFP|Small': '#60a5fa',
      'BEV-LFP|Sedan': '#60a5fa',
      'BEV-LFP|SUV':   '#60a5fa',
    }
    const derived = deriveDimColorsFromRowColors(rowColors, DIMS)
    expect(derived['BEV-LFP']).toBe('#60a5fa')
    // Sizes also derived because each size value appears in only one
    // row and that row carries one color — but only ONE row per size,
    // so all three sizes share the same single observed color.
    // Wait: Small appears once with #60a5fa → derived. Sedan also once
    // with #60a5fa → derived as #60a5fa too. That's the consequence of
    // the user's intent — full coverage with one color → both dims
    // derive to that color. That's correct given the input.
    expect(derived['Small']).toBe('#60a5fa')
  })
})

describe('deriveDimColorsFromRowColors — WP5 semantics (the bug report scenario)', () => {
  it('derives one color per Fuel family when sizes share that color', () => {
    const rowColors = {
      // BEV-LFP family — blue
      'BEV-LFP|Small': '#60a5fa',
      'BEV-LFP|Sedan': '#60a5fa',
      'BEV-LFP|SUV':   '#60a5fa',
      // HEV family — green
      'HEV-LFP|Small': '#22c55e',
      'HEV-LFP|Sedan': '#22c55e',
      'HEV-LFP|SUV':   '#22c55e',
      // ICEV-Petrol family — red
      'ICEV-Petrol|Small': '#ef4444',
      'ICEV-Petrol|Sedan': '#ef4444',
      'ICEV-Petrol|SUV':   '#ef4444',
    }
    const derived = deriveDimColorsFromRowColors(rowColors, DIMS)
    expect(derived['BEV-LFP']).toBe('#60a5fa')
    expect(derived['HEV-LFP']).toBe('#22c55e')
    expect(derived['ICEV-Petrol']).toBe('#ef4444')
    // Each Size value (Small / Sedan / SUV) appears across 3 fuel
    // families with 3 different colors → ambiguous → NOT derived.
    expect(derived['Small']).toBeUndefined()
    expect(derived['Sedan']).toBeUndefined()
    expect(derived['SUV']).toBeUndefined()
  })
})

describe('deriveDimColorsFromRowColors — ambiguity rule', () => {
  it('does NOT derive when rows for a dim value carry different colors', () => {
    const rowColors = {
      'BEV-LFP|Small': '#aaaaaa',
      'BEV-LFP|Sedan': '#bbbbbb', // different
      'BEV-LFP|SUV':   '#aaaaaa',
    }
    const derived = deriveDimColorsFromRowColors(rowColors, DIMS)
    expect(derived['BEV-LFP']).toBeUndefined()
  })

  it('still derives dim values that ARE consistent when siblings are ambiguous', () => {
    const rowColors = {
      'BEV-LFP|Small': '#aaaaaa',
      'BEV-LFP|Sedan': '#bbbbbb', // BEV-LFP rows differ
      'HEV-LFP|Small': '#cccccc',
      'HEV-LFP|Sedan': '#cccccc', // HEV-LFP rows agree
    }
    const derived = deriveDimColorsFromRowColors(rowColors, DIMS)
    expect(derived['BEV-LFP']).toBeUndefined()
    expect(derived['HEV-LFP']).toBe('#cccccc')
  })
})

describe('deriveDimColorsFromRowColors — edge cases', () => {
  it('returns {} when rowColors is empty', () => {
    expect(deriveDimColorsFromRowColors({}, DIMS)).toEqual({})
  })

  it('skips empty-string colors', () => {
    const rowColors = {
      'BEV-LFP|Small': '#60a5fa',
      'BEV-LFP|Sedan': '',
      'BEV-LFP|SUV':   '#60a5fa',
    }
    const derived = deriveDimColorsFromRowColors(rowColors, DIMS)
    // Only 2 non-empty rows, both #60a5fa → BEV-LFP derived.
    expect(derived['BEV-LFP']).toBe('#60a5fa')
  })

  it('normalises hex case so #ABCDEF and #abcdef are treated as same', () => {
    const rowColors = {
      'BEV-LFP|Small': '#ABCDEF',
      'BEV-LFP|Sedan': '#abcdef',
    }
    const derived = deriveDimColorsFromRowColors(rowColors, DIMS)
    expect(derived['BEV-LFP']).toBe('#abcdef')
  })

  it('handles missing dimension parts in the cohort key (defensive)', () => {
    // Cohort key with only one dim value (no separator)
    const rowColors = {
      'BEV-LFP': '#60a5fa',
    }
    const derived = deriveDimColorsFromRowColors(rowColors, DIMS)
    expect(derived['BEV-LFP']).toBe('#60a5fa')
  })
})
