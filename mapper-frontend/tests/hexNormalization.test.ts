/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  normalizeHex,
  setLabelColor,
  clearLabelColor,
} from '../src/utils/chartColors'
import { deriveDimColorsFromRowColors } from '../src/utils/dsmCohortColors'
import type { DimensionDef } from '../src/api/client'

// Patch 4AK³ — hex case normalisation and 'auto' handling.
//
// All write boundaries canonicalise hex to lowercase #rrggbb. The
// derivation function treats empty / 'auto' as "no opinion" (skipped)
// rather than conflict. The WP5-style 17-Fuel fixture must derive ALL
// 17 Fuel values to per-dim overrides regardless of input case.

beforeEach(() => {
  localStorage.clear()
})

describe('normalizeHex utility', () => {
  it('lowercases valid 6-digit hex', () => {
    expect(normalizeHex('#FF00FF')).toBe('#ff00ff')
    expect(normalizeHex('#ABCDEF')).toBe('#abcdef')
    expect(normalizeHex('#60A5FA')).toBe('#60a5fa')
  })

  it('is idempotent on already-lowercase hex', () => {
    expect(normalizeHex('#ff00ff')).toBe('#ff00ff')
    expect(normalizeHex(normalizeHex('#FF00FF'))).toBe('#ff00ff')
  })

  it('trims whitespace around valid hex', () => {
    expect(normalizeHex('  #FF00FF  ')).toBe('#ff00ff')
  })

  it('passes through non-hex strings unchanged', () => {
    expect(normalizeHex('auto')).toBe('auto')
    expect(normalizeHex('red')).toBe('red')
    expect(normalizeHex('#abc')).toBe('#abc')  // 3-digit hex left alone
    expect(normalizeHex('')).toBe('')
  })
})

describe('setLabelColor — canonicalises on write', () => {
  it('stores uppercase input as lowercase', () => {
    setLabelColor('BEV-LFP', '#60A5FA', 'p1')
    const raw = localStorage.getItem('mapper-color-assignments-p1')
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw!)['BEV-LFP']).toBe('#60a5fa')
  })

  it('round-trips canonical form (same hex case-insensitively is a no-op)', () => {
    setLabelColor('BEV-LFP', '#60A5FA', 'p1')
    const initialMap = localStorage.getItem('mapper-color-assignments-p1')
    // Second write with lowercase form of the same hex — no
    // change to persisted map; only the overrides set adds.
    setLabelColor('BEV-LFP', '#60a5fa', 'p1')
    expect(localStorage.getItem('mapper-color-assignments-p1')).toBe(initialMap)
  })

  it('preserves last-write-wins semantics across mixed-case inputs', () => {
    setLabelColor('label', '#AAAAAA', 'p1')
    setLabelColor('label', '#bbbbbb', 'p1')
    const parsed = JSON.parse(localStorage.getItem('mapper-color-assignments-p1')!)
    expect(parsed['label']).toBe('#bbbbbb')
  })
})

const FUEL: DimensionDef = {
  name: 'fuel_type', is_age: false,
  labels: [
    'BEV-LFP', 'BEV-NCA', 'BEV-NMC532', 'BEV-NMC622', 'BEV-NMC811',
    'HEV-LFP', 'HEV-NCA', 'HEV-NMC532', 'HEV-NMC622', 'HEV-NMC811',
    'ICEV-Diesel', 'ICEV-Petrol',
    'PHEV-LFP', 'PHEV-NCA', 'PHEV-NMC532', 'PHEV-NMC622', 'PHEV-NMC811',
  ],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any
const SIZE: DimensionDef = {
  name: 'size', is_age: false,
  labels: ['Small', 'Sedan', 'SUV'],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any
const WP5_DIMS: readonly DimensionDef[] = [FUEL, SIZE]

// WP5 palette (from the bug report).
const WP5_PALETTE: Record<string, string> = {
  'BEV-LFP': '#60a5fa',
  'BEV-NCA': '#3b82f6',
  'BEV-NMC532': '#93c5fd',
  'BEV-NMC622': '#1d4ed8',
  'BEV-NMC811': '#2563eb',
  'HEV-LFP': '#22c55e',
  'HEV-NCA': '#16a34a',
  'HEV-NMC532': '#15803d',
  'HEV-NMC622': '#4ade80',
  'HEV-NMC811': '#86efac',
  'ICEV-Diesel': '#f97316',
  'ICEV-Petrol': '#ef4444',
  'PHEV-LFP': '#c084fc',
  'PHEV-NCA': '#a855f7',
  'PHEV-NMC532': '#d8b4fe',
  'PHEV-NMC622': '#7e22ce',
  'PHEV-NMC811': '#9333ea',
}

function buildWP5RowColors(uppercaseHex = false): Record<string, string> {
  const rows: Record<string, string> = {}
  for (const fuel of FUEL.labels) {
    const hex = WP5_PALETTE[fuel]
    const value = uppercaseHex ? hex.toUpperCase() : hex
    for (const size of SIZE.labels) {
      rows[`${fuel}|${size}`] = value
    }
  }
  return rows
}

describe('deriveDimColorsFromRowColors — WP5 17-Fuel fixture', () => {
  it('derives all 17 Fuel values when each Fuel block shares one color (lowercase input)', () => {
    const derived = deriveDimColorsFromRowColors(buildWP5RowColors(false), WP5_DIMS)
    for (const fuel of FUEL.labels) {
      expect(derived[fuel]).toBe(WP5_PALETTE[fuel])
    }
  })

  it('derives all 17 Fuel values when input hex is UPPERCASE (bug report scenario)', () => {
    // The user reported partial derivation; this fixture reproduces
    // the Excel-uploaded uppercase shape. With Patch 4AK³ the
    // derivation lowercases at comparison + write, so all 17 derive.
    const derived = deriveDimColorsFromRowColors(buildWP5RowColors(true), WP5_DIMS)
    for (const fuel of FUEL.labels) {
      expect(derived[fuel]).toBe(WP5_PALETTE[fuel])
    }
  })

  it('does NOT derive Size values (each Size value is ambiguous across 17 Fuel families)', () => {
    const derived = deriveDimColorsFromRowColors(buildWP5RowColors(false), WP5_DIMS)
    expect(derived['Small']).toBeUndefined()
    expect(derived['Sedan']).toBeUndefined()
    expect(derived['SUV']).toBeUndefined()
  })
})

describe('deriveDimColorsFromRowColors — mixed-case rows for same Fuel', () => {
  it('treats #FF00FF and #ff00ff as the same color (no false conflict)', () => {
    const rowColors = {
      'BEV-LFP|Small': '#FF00FF',
      'BEV-LFP|Sedan': '#ff00ff',
      'BEV-LFP|SUV':   '#FF00ff',
    }
    const derived = deriveDimColorsFromRowColors(rowColors, WP5_DIMS)
    expect(derived['BEV-LFP']).toBe('#ff00ff')
  })
})

describe('deriveDimColorsFromRowColors — auto / empty handling', () => {
  it('derives when 2 rows share a color and the 3rd is empty', () => {
    const rowColors = {
      'BEV-LFP|Small': '#60a5fa',
      'BEV-LFP|Sedan': '',
      'BEV-LFP|SUV':   '#60a5fa',
    }
    const derived = deriveDimColorsFromRowColors(rowColors, WP5_DIMS)
    expect(derived['BEV-LFP']).toBe('#60a5fa')
  })

  it('derives when 2 rows share a color and the 3rd is "auto"', () => {
    const rowColors = {
      'BEV-LFP|Small': '#60a5fa',
      'BEV-LFP|Sedan': 'auto',
      'BEV-LFP|SUV':   '#60a5fa',
    }
    const derived = deriveDimColorsFromRowColors(rowColors, WP5_DIMS)
    expect(derived['BEV-LFP']).toBe('#60a5fa')
  })

  it('does NOT derive when all rows for a Fuel are auto/empty', () => {
    const rowColors = {
      'BEV-LFP|Small': '',
      'BEV-LFP|Sedan': 'auto',
      'BEV-LFP|SUV':   '',
    }
    const derived = deriveDimColorsFromRowColors(rowColors, WP5_DIMS)
    expect(derived['BEV-LFP']).toBeUndefined()
  })

  it('does NOT derive when 2 rows have different colors (real conflict)', () => {
    const rowColors = {
      'BEV-LFP|Small': '#aaaaaa',
      'BEV-LFP|Sedan': '#bbbbbb',  // conflict
      'BEV-LFP|SUV':   '',         // ignored
    }
    const derived = deriveDimColorsFromRowColors(rowColors, WP5_DIMS)
    expect(derived['BEV-LFP']).toBeUndefined()
  })
})

describe('clearLabelColor — case-insensitive override removal', () => {
  it('clears the override regardless of stored case', () => {
    setLabelColor('label', '#AABBCC', 'p1')
    clearLabelColor('label', 'p1')
    const parsed = JSON.parse(localStorage.getItem('mapper-color-assignments-p1') || '{}')
    expect('label' in parsed).toBe(false)
  })
})
