/* SPDX-License-Identifier: MPL-2.0 */
/**
 * The charger subsystems' colours on the Prospective by-cohort chart differed
 * from the cohort mapping table (MAp-test, Fueling Infrastructure).
 *
 * Root cause: with a Stack-by set, the band of a cohort and its legend swatch
 * came from different places. The band took the cohort-mapping colour, keyed
 * `<subsystem id>::Public AC Charger|Small`; the legend took the GROUP colour
 * ("Public AC Charger") from a colour map that knew only the PRIMARY system's
 * dimension labels, so a subsystem group was absent from it and fell back to a
 * palette slot by POSITION -- one position among the legend entries, another
 * among the cohorts for an uncoloured band. Two places, two colours.
 *
 * Driven through the real panel (legend DOM) and the real hook (band colours).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, afterEach } from 'vitest'
import { act, cleanup, render, renderHook } from '@testing-library/react'
import { useDSMStore } from '../src/stores/dsmStore'
import { usePLCAStore } from '../src/stores/plcaStore'
import { useSubsystemStore } from '../src/stores/subsystemStore'
import { useImpactStore } from '../src/stores/impactStore'
import {
  SUBSYSTEM_KEY_SEP, buildCombinedRowColorOverrides, useDSMSystemColors,
} from '../src/utils/dsmCohortColors'
import { DetailTable } from '../src/components/aesa/DetailTable'

const SYS = 'sys-cars'
const SUB = 'sub-chargers'
const K = (owner: string, ck: string) => `${owner}${SUBSYSTEM_KEY_SEP}${ck}`

const SYSTEM = {
  id: SYS, name: 'Cars', time_horizon: { start_year: 2025, end_year: 2026 },
  dimensions: [
    { name: 'f', display_name: 'Powertrain', labels: ['BEV-LFP'], is_age: false },
    { name: 's', display_name: 'Size', labels: ['SUV'], is_age: false },
  ],
} as any

// Fueling Infrastructure as it is stored in MAp-test: AC chargers coloured per
// type in the cohort mapping; the DC charger left on auto.
const SUBSYSTEM = {
  id: SUB, name: 'Fueling Infrastructure', type: 'dependent',
  cohort_mappings: {
    'Public AC Charger|Small': { archetype_id: 'a', color: '#3b82f6' },
    'Public AC Charger|Large': { archetype_id: 'a', color: '#3b82f6' },
    'Public DC Charger|Small': { archetype_id: 'b', color: null },
    'Public DC Charger|Large': { archetype_id: 'b', color: null },
  },
} as any

const COHORTS = {
  [K(SYS, 'BEV-LFP|SUV')]: 120,
  [K(SUB, 'Public AC Charger|Small')]: 10,
  [K(SUB, 'Public AC Charger|Large')]: 11,
  [K(SUB, 'Public DC Charger|Small')]: 12,
  [K(SUB, 'Public DC Charger|Large')]: 13,
}
const KEYS = Object.keys(COHORTS)

afterEach(() => cleanup())

function seed() {
  // @ts-expect-error recharts stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  useDSMStore.setState({
    activeSystem: SYSTEM, stackByDimension: 'f',
    systemState: { scenarios: [{ id: 'b', name: 'Base', is_base: true }], active_scenario_id: 'b' } as any,
    cohortMappings: {}, cohortRowColors: { 'BEV-LFP|SUV': '#ef4444' },
  } as any)
  usePLCAStore.setState({ databases: [{ name: 'db', base_db: 'ei', iam: 'remind', ssp: 'SSP2', year: 2030, years: [2030], mode: 'separate' as any, created_at: 'x' }] })
  useSubsystemStore.setState({ subsystems: [SUBSYSTEM], fetchForSystem: (async () => undefined) as never })
  useImpactStore.setState({
    projectedResult: {
      task_id: 't', meta: { mode: 'projected', year_to_database: { 2025: 'db', 2026: 'db' } },
      results: [{
        mfa_system_id: SYS, method: ['EF v3.1', 'climate change', 'GWP100'], method_label: 'GWP100',
        scope: 'all', unit: 'kg CO2-Eq',
        years: [2025, 2026].map((year) => ({
          year, total_impact: 166, unit: 'kg CO2-Eq', impact_by_cohort: { ...COHORTS },
          impact_by_material: {}, count_by_cohort: {},
        })),
        summary: { total_impact: 332, peak_year: 2026, peak_impact: 166 }, stages_included: ['Use Phase'],
      }],
    } as any,
  })
}

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

describe('the Prospective by-cohort legend uses the cohort-mapping colours', () => {
  it('a subsystem group whose cohorts share a mapping colour shows that colour', async () => {
    seed()
    const { ProjectedImpactPanel } = await import('../src/components/impact/ProjectedImpactPanel')
    const { container } = render(<ProjectedImpactPanel />)
    await act(async () => { await Promise.resolve() })
    const swatch = (group: string) =>
      (container.querySelector(`[data-testid="projected-by-cohort-legend-${group}"] span`) as HTMLElement)
        .style.backgroundColor
    expect(swatch('Public AC Charger')).toBe(rgb('#3b82f6'))
    expect(swatch('BEV-LFP')).toBe(rgb('#ef4444'))
  })
})

describe('bands and legend come from one source', () => {
  const hook = () => renderHook(() => useDSMSystemColors(SYSTEM, 'f', {
    rowColorOverrides: buildCombinedRowColorOverrides(SYS, { 'BEV-LFP|SUV': '#ef4444' }, [SUBSYSTEM]),
    cohortKeys: KEYS,
  })).result.current

  it('a coloured cohort\'s band is its mapping colour, and so is its group\'s swatch', () => {
    const c = hook()
    expect(c.colorForCohort(K(SUB, 'Public AC Charger|Small'), 1)).toBe('#3b82f6')
    expect(c.legendColorFor('Public AC Charger', KEYS, 0)).toBe('#3b82f6')
  })

  it('uncoloured cohorts of one group share ONE colour, the same as their swatch, whatever their position', () => {
    const c = hook()
    const small = c.colorForCohort(K(SUB, 'Public DC Charger|Small'), 3)
    const large = c.colorForCohort(K(SUB, 'Public DC Charger|Large'), 4)
    expect(small).toBe(large)                                   // was palette[3] vs palette[4]
    expect(c.legendColorFor('Public DC Charger', KEYS, 2)).toBe(small)
  })
})

describe('AESA Detail shows the same cohort colours', () => {
  it('each cohort row carries the resolver\'s colour', () => {
    const r = {
      year: 2030, pb_id: 'climate_change', pb_name: 'Climate change', ef_indicator: 'climate change',
      impact: 166, allocated_sos: 10, sr: 16.6, zone: 'high_risk', unit: 'kg CO2-Eq',
      sharing_principle: 'EpC', impact_by_cohort: { ...COHORTS },
    } as any
    const { container, getByText } = render(
      <DetailTable results={[r]} cohortColor={(k) => (k.includes('Public AC Charger') ? '#3b82f6' : '#999999')} />,
    )
    act(() => { (getByText('Climate change').closest('tr') as HTMLElement).querySelector('button')?.click() })
    const sw = container.querySelector(`[data-testid="aesa-detail-cohort-swatch-${K(SUB, 'Public AC Charger|Small')}"]`) as HTMLElement
    expect(sw).not.toBeNull()
    expect(sw.style.backgroundColor).toBe(rgb('#3b82f6'))
  })
})
