import { describe, it, expect } from 'vitest'
import { buildVintageLineModel } from '../src/components/impact/MultiProductLineChart'
import { shortenByCommonPrefix } from '../src/utils/labelPrefix'
import type { MultiProductLCAResult } from '../src/api/client'

// Patch 5S Part A — pure-logic tests (jsdom has no layout engine for Recharts
// lines). Lock the scenario→series mapping + ordering, static-vintage
// separation, sparse-year gaps, and the common-prefix label rule.

const BASE = 'ei-3.10'
const CODE = 'elec'
const METHOD = 'EF v3.1 › climate change › GWP100'

// Intrinsic DK-grid intensity at a fixed year: SSP1 > SSP2 > SSP5 (audited
// premise/REMIND ordering, Patch 5P/5R).
const SCORE: Record<string, Record<number, number>> = {
  'SSP1-PkBudg1150': { 2030: 0.110, 2040: 0.031, 2050: 0.023 },
  'SSP2': { 2030: 0.095, 2040: 0.023, 2050: 0.019 },
  'SSP5-PkBudg1150': { 2030: 0.072, 2040: 0.020, 2050: 0.017 },
}

function premiseItem(ssp: string, year: number): MultiProductLCAResult['items'][number] {
  const db = `${BASE}_premise_remind_${ssp.toLowerCase()}_${year}`
  return {
    type: 'activity', item_id: `${db}|${CODE}`,
    label: `electricity, low voltage [${ssp} ${year}]`, status: 'success',
    activity_result: { results: [{ method: ['m'], method_label: METHOD, score: SCORE[ssp][year], unit: 'kg CO2-eq', contributions: [] }], elapsed_seconds: 0 } as any,
  }
}

function coordFor(ssp: string, year: number) {
  const db = `${BASE}_premise_remind_${ssp.toLowerCase()}_${year}`
  return { [`${db}|${CODE}`]: { label: `${ssp} ${year}`, database: db, base_database: BASE, iam: 'remind', ssp, year } }
}

function build(ssps: string[], years: number[]) {
  const items: MultiProductLCAResult['items'] = []
  let coords: Record<string, any> = {}
  for (const ssp of ssps) for (const y of years) {
    items.push(premiseItem(ssp, y))
    coords = { ...coords, ...coordFor(ssp, y) }
  }
  return { items, coords }
}

describe('buildVintageLineModel — scenario-series mapping', () => {
  it('maps one series per (base+iam+ssp) scenario, plotted by year', () => {
    const { items, coords } = build(['SSP1-PkBudg1150', 'SSP2', 'SSP5-PkBudg1150'], [2030, 2040, 2050])
    const model = buildVintageLineModel(items, coords, METHOD)
    // 18 items → 3 scenarios (not 18 series).
    expect(model.scenarios.map((s) => s.label).sort()).toEqual(['SSP1-PkBudg1150', 'SSP2', 'SSP5-PkBudg1150'])
    expect(model.years).toEqual([2030, 2040, 2050])
    // Each series has one point per year, sorted.
    for (const s of model.scenarios) {
      expect(s.points.map((p) => p.year)).toEqual([2030, 2040, 2050])
    }
  })

  it('reflects the audited DK-grid ordering SSP1 > SSP2 > SSP5 at a fixed year', () => {
    const { items, coords } = build(['SSP1-PkBudg1150', 'SSP2', 'SSP5-PkBudg1150'], [2030, 2040, 2050])
    const model = buildVintageLineModel(items, coords, METHOD)
    const at = (label: string, year: number) =>
      model.scenarios.find((s) => s.label === label)!.points.find((p) => p.year === year)!.value
    expect(at('SSP1-PkBudg1150', 2040)).toBeGreaterThan(at('SSP2', 2040))
    expect(at('SSP2', 2040)).toBeGreaterThan(at('SSP5-PkBudg1150', 2040))
  })

  it('colors series by ORIGINAL sorted index — stable regardless of which is hidden later', () => {
    const { items, coords } = build(['SSP1-PkBudg1150', 'SSP2', 'SSP5-PkBudg1150'], [2030, 2040])
    const model = buildVintageLineModel(items, coords, METHOD)
    const colors = model.scenarios.map((s) => s.color)
    // Distinct colors, indexed by sorted order (not by data value).
    expect(new Set(colors).size).toBe(3)
    expect(model.scenarios.map((s) => s.originalIdx)).toEqual([0, 1, 2])
  })

  it('separates the static (ecoinvent) vintage into a reference line, not a series', () => {
    const { items, coords } = build(['SSP1-PkBudg1150'], [2030, 2040])
    const staticItem: MultiProductLCAResult['items'][number] = {
      type: 'activity', item_id: `${BASE}|${CODE}`, label: 'electricity, low voltage [ecoinvent]',
      status: 'success', activity_result: { results: [{ method: ['m'], method_label: METHOD, score: 0.5, unit: 'kg CO2-eq', contributions: [] }], elapsed_seconds: 0 } as any,
    }
    const allCoords = { ...coords, [`${BASE}|${CODE}`]: { label: 'ecoinvent', database: BASE, base_database: BASE, iam: null, ssp: null, year: null } }
    const model = buildVintageLineModel([...items, staticItem], allCoords, METHOD)
    expect(model.scenarios).toHaveLength(1)                 // only the premise scenario
    expect(model.staticLines).toEqual([{ label: 'ecoinvent', value: 0.5 }])
  })

  it('leaves gaps for sparse years (no interpolation across missing years)', () => {
    // SSP1 has 2030+2050 only; SSP2 has all three. Year axis = union.
    const items = [premiseItem('SSP1-PkBudg1150', 2030), premiseItem('SSP1-PkBudg1150', 2050),
      premiseItem('SSP2', 2030), premiseItem('SSP2', 2040), premiseItem('SSP2', 2050)]
    const coords = { ...coordFor('SSP1-PkBudg1150', 2030), ...coordFor('SSP1-PkBudg1150', 2050),
      ...coordFor('SSP2', 2030), ...coordFor('SSP2', 2040), ...coordFor('SSP2', 2050) }
    const model = buildVintageLineModel(items, coords, METHOD)
    expect(model.years).toEqual([2030, 2040, 2050])
    const ssp1 = model.scenarios.find((s) => s.label === 'SSP1-PkBudg1150')!
    // SSP1 has only 2 points (2040 absent) — the row builder will null 2040.
    expect(ssp1.points.map((p) => p.year)).toEqual([2030, 2050])
  })
})

describe('shortenByCommonPrefix — display label rule', () => {
  it('strips the shared activity, leaving only the differing vintage', () => {
    const { shortened, shared } = shortenByCommonPrefix([
      'electricity, low voltage [SSP1-PkBudg1150 2025]',
      'electricity, low voltage [SSP2 2025]',
      'electricity, low voltage [SSP5-PkBudg1150 2025]',
    ])
    expect(shared).toBe('electricity, low voltage')
    expect(shortened).toEqual(['SSP1-PkBudg1150 2025', 'SSP2 2025', 'SSP5-PkBudg1150 2025'])
  })

  it('degrades to full labels when there is no common prefix (distinct activities)', () => {
    const labels = ['steel, market', 'aluminium, primary', 'concrete, ready-mix']
    const { shortened, shared } = shortenByCommonPrefix(labels)
    expect(shared).toBe('')
    expect(shortened).toEqual(labels)
  })

  it('single label → no shortening', () => {
    expect(shortenByCommonPrefix(['only one']).shared).toBe('')
  })
})
