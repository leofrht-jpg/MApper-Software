/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A cohort key's `<owner id>::` prefix must never reach the user.
 *
 * The backend prefixes cohort keys with the owning system's or subsystem's id
 * (`SUBSYSTEM_KEY_SEP`) so that two owners holding the same bare name do not
 * merge when results are aggregated. That prefix is an INTERNAL identity. It
 * leaked into six places at once, and the shape of the failure is why this
 * test asserts the way it does:
 *
 *   - It asserts on RENDERED OUTPUT, never on the presence of a formatter
 *     prop. A test that checks "a formatter is passed" passes while the
 *     formatter is wrong, which is the vacuous-guard failure this codebase has
 *     hit repeatedly.
 *   - It SEARCHES for the prefix shape anywhere in the text, rather than
 *     matching the whole string. One of the six defects leaked
 *     `<uuid>::BEV-LFP|2030` through dim parsing, so an anchored `^...$` match
 *     against a text node would have passed while the bug was live. The
 *     `WITH_DIM_SUFFIX` fixture exists to keep that mistake out.
 *   - It covers BOTH prefix shapes: a subsystem id and the primary system id.
 *     The original report showed both leaking, and a fix for only the
 *     subsystem form would have looked complete.
 *
 * Discovery is by query, not by hand. The hand-kept-list precedent in this
 * repo (the upload guard) declared nine routes and missed a tenth that was
 * destroying data.
 */
import fs from 'node:fs'
import path from 'node:path'

import { relPosix } from './helpers/relPosix'

import { describe, it, expect } from 'vitest'

import {
  stripCohortPrefix, SUBSYSTEM_KEY_SEP, parseCohortKey,
  cohortDisplayString, cohortDisplayLabel,
} from '../src/utils/dsmCohortColors'

// Real ids from MAp-test: a subsystem and the primary system. Both shapes.
const SUB_ID = '670be0bf-eb95-4479-b5f1-dea938d0e46f'
const SYS_ID = 'e5442abf-fa89-4804-b192-667f6ecd08bf'

/** The leak, anywhere in a string — NOT anchored. See the file docstring. */
const LEAK = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}::/i

const SRC = path.resolve(__dirname, '../src')

/**
 * Files that touch a cohort key, discovered by a string-level union.
 *
 * Coarse but DECIDABLE. "Components that render values from impact_by_cohort"
 * is a data-flow property a static scan cannot see; this over-approximates it
 * and accepts the false positives, because a file that merely mentions a
 * cohort key and renders nothing costs one line in COVERED.
 */
const QUERY = [
  'impact_by_cohort',
  'cohort_key',
  'cohortStackKeys',
  'colorForCohort',
  'useDSMSystemColors',
  'parseCohortKey',
]

function walk(dir: string, ext: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, ext, out)
    else if (e.name.endsWith(ext)) out.push(p)
  }
  return out
}

function discovered(ext: string): string[] {
  return walk(SRC, ext)
    .filter((p) => {
      const src = fs.readFileSync(p, 'utf8')
      return QUERY.some((q) => src.includes(q))
    })
    .map((p) => relPosix(SRC, p))
    .sort()
}

/**
 * The five frontend sites that leaked. If the query is ever narrowed, this
 * breaks instead of coverage silently shrinking — the discovery query is as
 * much a hand-maintained artifact as a route list, so it gets its own guard.
 */
const KNOWN_LEAK_SITES = [
  'components/aesa/DetailTable.tsx',
  'components/charts/ExpandedCohortChart.tsx',
  'components/impact/ProjectedImpactPanel.tsx',
]

describe('discovery', () => {
  it('the query finds every file that leaked', () => {
    const set = discovered('.tsx')
    for (const site of KNOWN_LEAK_SITES) {
      expect(set, `discovery query no longer reaches ${site}`).toContain(site)
    }
  })

  it('is neither hardcoded to the answer nor unbounded', () => {
    const set = discovered('.tsx')
    // 3 known leak sites: a set of exactly that size would mean the query had
    // been tuned to them. An explosion means it has stopped discriminating.
    expect(set.length).toBeGreaterThan(KNOWN_LEAK_SITES.length)
    expect(set.length).toBeLessThan(25)
  })

  it('no non-tsx module emits a cohort label of its own', () => {
    // The `.tsx` filter is itself a scope choice. The only non-tsx module that
    // writes a cohort string to the user is chartExport.ts, and it reads the
    // already-rendered DOM (`row.textContent`), so it inherits whatever the
    // legend shows rather than formatting a key itself.
    const ts = discovered('.ts')
    const emitters = ts.filter((rel) => {
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8')
      return /innerHTML|createElement\(|<text/.test(src)
    })
    // Each one is accounted for BY NAME with the reason it is benign, so a
    // third module that starts emitting fails this instead of slipping in.
    const ACCOUNTED: Record<string, string> = {
      // Reads the already-rendered legend (`row.textContent`) and re-emits it
      // as SVG <text>, so it inherits the fix rather than formatting a key.
      'components/charts/chartExport.ts': 'row.textContent',
      // `createElement('a')` for file downloads. Cohort keys appear only as
      // payload fields; no cohort string reaches a filename or the DOM.
      'api/client.ts': 'a.download',
    }
    expect(emitters.sort(), 'a non-tsx module now formats a cohort key itself')
      .toEqual(Object.keys(ACCOUNTED).sort())
    for (const [rel, marker] of Object.entries(ACCOUNTED)) {
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8')
      expect(src, `${rel} no longer matches the reason it was exempted`)
        .toContain(marker)
    }
  })
})

describe('the strip itself', () => {
  it('removes both prefix shapes and keeps everything after', () => {
    expect(stripCohortPrefix(`${SUB_ID}${SUBSYSTEM_KEY_SEP}CNG Station|Large`))
      .toBe('CNG Station|Large')
    expect(stripCohortPrefix(`${SYS_ID}${SUBSYSTEM_KEY_SEP}BEV-LFP|SUV`))
      .toBe('BEV-LFP|SUV')
  })

  it('leaves an unprefixed key untouched', () => {
    expect(stripCohortPrefix('BEV-LFP|SUV')).toBe('BEV-LFP|SUV')
  })

  it('strips before splitting dims, so dim VALUES carry no id', () => {
    // Defect 2: parseCohortKey split on '|' first, so the first dim value came
    // back as `<uuid>::BEV-LFP` — into the legend AND the colour grouping.
    const dims = [{ name: 'f', labels: [], is_age: false },
                  { name: 's', labels: [], is_age: false }] as any
    const parsed = parseCohortKey(`${SYS_ID}${SUBSYSTEM_KEY_SEP}BEV-LFP|SUV`, dims)
    expect(parsed.f).toBe('BEV-LFP')
    expect(parsed.s).toBe('SUV')
    expect(JSON.stringify(parsed)).not.toMatch(LEAK)
  })

  it('ONE display rule: legend, tooltip and table agree character for character', () => {
    // Stripping alone leaves the `|`, so a legend built on stripCohortPrefix
    // read `CNG Station|Large` while the tooltip and table read `CNG Station
    // Large`. Two names for one band is the same defect in a quieter form —
    // this was introduced while fixing the loud one.
    const ck = `${SUB_ID}${SUBSYSTEM_KEY_SEP}CNG Station|Large`
    expect(cohortDisplayString(ck)).toBe('CNG Station Large')
    expect(cohortDisplayString(ck)).toBe(cohortDisplayLabel(ck).label)
    expect(cohortDisplayString(ck)).not.toContain('|')
    expect(cohortDisplayString(ck)).not.toMatch(LEAK)
  })

  it('catches a leak that an anchored match would miss', () => {
    // The fixture that keeps the ^...$ mistake out: a leaked key with a dim
    // suffix is not equal to the prefix, it CONTAINS it.
    const WITH_DIM_SUFFIX = `${SUB_ID}${SUBSYSTEM_KEY_SEP}CNG Station|Large`
    expect(WITH_DIM_SUFFIX).toMatch(LEAK)
    expect(new RegExp(`^${LEAK.source}$`, 'i').test(WITH_DIM_SUFFIX)).toBe(false)
    expect(stripCohortPrefix(WITH_DIM_SUFFIX)).not.toMatch(LEAK)
  })
})

export { LEAK, SUB_ID, SYS_ID, discovered, KNOWN_LEAK_SITES }

// ── Render cases ───────────────────────────────────────────────────────────
//
// The assertions that matter. Each mounts a real component with cohort keys
// carrying BOTH prefix shapes AND a dim suffix, then searches the rendered
// text. Nothing here inspects a prop.

import React from 'react'
import { render, act, cleanup, fireEvent } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

import { useDSMStore } from '../src/stores/dsmStore'
import { usePLCAStore } from '../src/stores/plcaStore'
import { useSubsystemStore } from '../src/stores/subsystemStore'
import { useImpactStore } from '../src/stores/impactStore'

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, exportImpact: vi.fn() }
})

/** Both shapes, and `|Large` so an anchored match cannot pass. */
const PREFIXED = {
  [`${SYS_ID}${SUBSYSTEM_KEY_SEP}BEV-LFP|SUV`]: 120,
  [`${SUB_ID}${SUBSYSTEM_KEY_SEP}CNG Station|Large`]: 30,
}

afterEach(() => cleanup())

function seedStores() {
  // @ts-expect-error — minimal stub for recharts ResponsiveContainer
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  useDSMStore.setState({
    activeSystem: {
      id: SYS_ID, name: 'Test System',
      time_horizon: { start_year: 2025, end_year: 2026 },
      dimensions: [
        { name: 'f', display_name: 'Powertrain', labels: ['BEV-LFP'], is_age: false },
        { name: 's', display_name: 'Size', labels: ['SUV'], is_age: false },
      ],
    } as any,
    systemState: {
      scenarios: [{ id: 'base-1', name: 'Base', is_base: true } as any],
      active_scenario_id: 'base-1',
    } as any,
    cohortMappings: {},
  })
  // The panel short-circuits to a "no prospective databases yet" placeholder
  // when this is empty, and the chart never renders.
  usePLCAStore.setState({
    databases: [{
      name: 'ei310-remind-ssp2-2030', base_db: 'ecoinvent-3.10-cutoff',
      iam: 'remind', ssp: 'SSP2-PkBudg1150', year: 2030, years: [2030],
      mode: 'separate' as any, created_at: '2026-01-01',
    }],
  })
  useSubsystemStore.setState({ subsystems: [], fetchForSystem: (async () => undefined) as never })
  useImpactStore.setState({
    projectedResult: {
      task_id: 't',
      // `year_to_database` is read unconditionally by the Year→Database card;
      // omitting it throws before the chart is reached.
      meta: { mode: 'projected', year_to_database: { 2025: 'ei310', 2026: 'ei310' } },
      results: [{
        mfa_system_id: SYS_ID,
        method: ['EF v3.1', 'climate change', 'global warming potential (GWP100)'],
        method_label: 'EF v3.1 › climate change › global warming potential (GWP100)',
        scope: 'all', unit: 'kg CO2-Eq',
        years: [2025, 2026].map((year) => ({
          year, total_impact: 150, unit: 'kg CO2-Eq',
          impact_by_cohort: { ...PREFIXED }, impact_by_material: {}, count_by_cohort: {},
        })),
        summary: { total_impact: 300, peak_year: 2026, peak_impact: 150 },
        stages_included: ['Use Phase'],
      }],
    } as any,
  })
}

describe('rendered output carries no cohort-key prefix', () => {
  it('ProjectedImpactPanel — the by-cohort legend (the reported bug)', async () => {
    seedStores()
    const { ProjectedImpactPanel } = await import('../src/components/impact/ProjectedImpactPanel')
    const { container } = render(<ProjectedImpactPanel />)
    await act(async () => { await Promise.resolve() })
    const legend = container.querySelector('[data-testid="projected-by-cohort-legend"]')
    expect(legend, 'the by-cohort legend did not render; the fixture is not reaching the chart')
      .not.toBeNull()
    expect(legend!.textContent ?? '').not.toMatch(LEAK)
    // and it still says something
    expect(legend!.textContent).toContain('CNG Station')
  })

  it('ExpandedCohortChart — facet-expand legend and tooltip series names', async () => {
    const { ExpandedCohortChart } = await import('../src/components/charts/ExpandedCohortChart')
    const { useNumberFormatter } = await import('../src/components/charts/numberFormat')
    function Harness() {
      const format = useNumberFormatter()
      return (
        <ExpandedCohortChart
          years={[2025, 2026].map((year) => ({
            year, total_impact: 150, unit: 'kg CO2-Eq',
            impact_by_cohort: { ...PREFIXED }, impact_by_material: {}, count_by_cohort: {},
          })) as any}
          cohortKeys={Object.keys(PREFIXED)}
          colorForCohort={(_ck: string, i = 0) => ['#111', '#222'][i % 2]}
          unit="kg CO2-Eq"
          format={format}
          detailYear={2025}
          exportFilename="x"
        />
      )
    }
    const { container } = render(<Harness />)
    await act(async () => { await Promise.resolve() })
    expect(container.textContent ?? '').not.toMatch(LEAK)
    // The <Area name=> props feed the tooltip; assert the rendered series
    // names are stripped rather than trusting the prop.
    const names = Array.from(container.querySelectorAll('[data-testid^="expanded-cohort-legend-"]'))
      .map((el) => el.textContent ?? '')
    expect(names.join(' ')).not.toMatch(LEAK)
    expect(names.join(' ')).toContain('CNG Station')
  })

  it('DetailTable — the AESA per-cohort breakdown cells', async () => {
    const { DetailTable } = await import('../src/components/aesa/DetailTable')
    const row = {
      year: 2030, pb_id: 'climate_change', pb_name: 'Climate change',
      pb_short_name: 'CC', impact: 1, allocated_sos: 1, sr: 0.6, zone: 'safe',
      impact_by_cohort: { ...PREFIXED },
    } as any
    const { container } = render(<DetailTable results={[row]} coverageGaps={[]} />)
    // The per-cohort breakdown is behind a disclosure; collapsed, the cells
    // this test exists for are not in the DOM at all.
    const expand = container.querySelector('button[aria-label="Expand cohorts"]') as HTMLButtonElement
    expect(expand, 'no expand control; the fixture carries no cohort rows').not.toBeNull()
    await act(async () => { fireEvent.click(expand) })
    expect(container.textContent ?? '').not.toMatch(LEAK)
    expect(container.textContent).toContain('CNG Station')
  })

  it('ExpandedCohortChart — the series NAMES that feed the tooltip', async () => {
    // The tooltip renders only on hover, so a static mount cannot see it.
    // Assert the computed VALUE of each series `name` instead — which is the
    // formatter's return value, not the existence of a prop. Harvested from
    // the element tree the component actually returns.
    const mod = await import('../src/components/charts/ExpandedCohortChart')
    const { useNumberFormatter } = await import('../src/components/charts/numberFormat')
    let tree: unknown
    function Probe() {
      const format = useNumberFormatter()
      tree = (mod.ExpandedCohortChart as unknown as (p: any) => unknown)({
        years: [{ year: 2025, total_impact: 150, unit: 'kg', impact_by_cohort: { ...PREFIXED },
                  impact_by_material: {}, count_by_cohort: {} }],
        cohortKeys: Object.keys(PREFIXED),
        colorForCohort: () => '#111',
        unit: 'kg', format, detailYear: 2025, exportFilename: 'x',
      })
      return null
    }
    render(<Probe />)
    const names: string[] = []
    const walk = (n: any): void => {
      if (!n || typeof n !== 'object') return
      if (Array.isArray(n)) return n.forEach(walk)
      const t = n.type
      const tn = typeof t === 'string' ? t : (t?.displayName ?? t?.name ?? '')
      if (tn === 'Area' && typeof n.props?.name === 'string') names.push(n.props.name)
      walk(n.props?.children)
    }
    walk(tree)
    expect(names.length, 'no <Area> series found; the probe stopped seeing the tree').toBeGreaterThan(0)
    for (const n of names) expect(n).not.toMatch(LEAK)
    expect(names.join(' ')).toContain('CNG Station')
  })
})
