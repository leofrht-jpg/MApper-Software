/* SPDX-License-Identifier: MPL-2.0 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import {
  CoverageBanner,
  MaterialPedigreeTable,
} from '../src/components/uncertainty/MaterialPedigreeTable'
import { __resetPedigreeCache } from '../src/utils/pedigree'
import type { PedigreeCoverage } from '../src/api/client'

const { TABLE } = vi.hoisted(() => ({ TABLE: {
  indicators: [
    'reliability', 'completeness', 'temporal correlation',
    'geographical correlation', 'further technological correlation',
  ],
  factors: {
    'reliability': [1.0, 1.05, 1.1, 1.2, 1.5],
    'completeness': [1.0, 1.02, 1.05, 1.1, 1.2],
    'temporal correlation': [1.0, 1.03, 1.1, 1.2, 1.5],
    'geographical correlation': [1.0, 1.01, 1.02, 1.05, 1.1],
    'further technological correlation': [1.0, 1.05, 1.2, 1.5, 2.0],
  },
  default_basic_variance: 0.0006,
  convention: 'sigma_i^2 = [ln(f_i) / 2]^2',
} }))

vi.mock('../src/api/client', async (orig) => {
  const actual = await orig<typeof import('../src/api/client')>()
  return {
    ...actual,
    getPedigreeTable: vi.fn().mockResolvedValue(TABLE),
    listProjectMaterials: vi.fn(),
    getMaterialPedigree: vi.fn(),
    saveMaterialPedigree: vi.fn(),
  }
})

const MATERIALS = ['Steel frame', 'Aluminium panels', 'Copper wiring', 'Glass']

function coverage(over: Partial<PedigreeCoverage> = {}): PedigreeCoverage {
  return {
    materials_total: 148, materials_scored: 47,
    archetype_materials_total: 36, archetype_materials_scored: 12,
    impact_share: 0.82,
    method_label: 'climate change | GWP100', unit: 'kg CO2-eq',
    top_unscored: [
      { name: 'Aluminium panels', share: 0.189, impact: 2100 },
      { name: 'Steel frame', share: 0.130, impact: 1450 },
    ],
    ...over,
  }
}

beforeEach(async () => {
  __resetPedigreeCache()
  const c = await import('../src/api/client')
  vi.mocked(c.listProjectMaterials).mockResolvedValue({
    materials: [...MATERIALS], expression_rows: 0, expression_names: 0,
    literal_rows: MATERIALS.length, archetypes: 2,
  })
  vi.mocked(c.getMaterialPedigree).mockResolvedValue({ entries: {} })
  vi.mocked(c.saveMaterialPedigree).mockImplementation(async (l) => l)
})

describe('coverage', () => {
  it('leads with the IMPACT-weighted figure, not the row count', () => {
    render(<CoverageBanner coverage={coverage()} />)
    const headline = screen.getByTestId('pedigree-coverage-headline').textContent ?? ''
    expect(headline).toContain('47 of 148 materials scored')
    expect(headline).toContain('82%')
    expect(headline).toContain('climate change | GWP100')
  })

  it('says the weighting is by impact, so a reader cannot mistake it for rows', () => {
    const { container } = render(<CoverageBanner coverage={coverage()} />)
    expect(container.textContent).toMatch(/weighted by impact, not row count/i)
  })

  it('says what the uncovered share rests on', () => {
    const { container } = render(<CoverageBanner coverage={coverage()} />)
    expect(container.textContent).toMatch(/remaining 18%/)
    expect(container.textContent).toMatch(/background database alone/i)
  })

  it('names where the next hour of scoring pays', () => {
    render(<CoverageBanner coverage={coverage()} />)
    const next = screen.getByTestId('pedigree-coverage-next').textContent ?? ''
    expect(next).toContain('Aluminium panels')
    expect(next).toContain('18.9%')
  })

  it('reads zero coverage without dividing by zero', () => {
    render(<CoverageBanner coverage={coverage({ impact_share: 0, materials_scored: 0, top_unscored: [] })} />)
    expect(screen.getByTestId('pedigree-coverage-headline').textContent).toContain('0%')
  })
})

describe('the short list explains itself', () => {
  async function withScope(over: Partial<import('../src/api/client').MaterialScoringScope>) {
    const c = await import('../src/api/client')
    vi.mocked(c.listProjectMaterials).mockResolvedValue({
      materials: ['PV electricity'], expression_rows: 140, expression_names: 55,
      literal_rows: 2, archetypes: 8, ...over,
    })
  }

  it('states the ACTUAL counts, not a generic sentence', async () => {
    await withScope({})
    render(<MaterialPedigreeTable />)
    const note = await screen.findByTestId('material-scope-note')
    expect(note.textContent).toContain('1 scoreable material')
    expect(note.textContent).toContain('140 rows use parameter expressions')
    expect(note.textContent).toMatch(/inherit uncertainty from\s+their parameters/)
  })

  it('says the table is not where the uncertainty lives when parameters dominate', async () => {
    // Battery Circularity: 2 literal rows against 140 expression rows.
    await withScope({})
    render(<MaterialPedigreeTable />)
    const note = await screen.findByTestId('material-scope-note')
    expect(note.textContent).toMatch(/not where its uncertainty lives/i)
  })

  it('does NOT say that when the project is mostly literal', async () => {
    // MAp-test: 914 literal rows against 38 expression rows.
    await withScope({ materials: [...MATERIALS], expression_rows: 38, literal_rows: 914 })
    render(<MaterialPedigreeTable />)
    const note = await screen.findByTestId('material-scope-note')
    expect(note.textContent).toContain('38 rows use parameter expressions')
    expect(note.textContent).not.toMatch(/not where its uncertainty lives/i)
  })

  it('is absent entirely when nothing is parameterised', async () => {
    await withScope({ materials: [...MATERIALS], expression_rows: 0, literal_rows: 4 })
    render(<MaterialPedigreeTable />)
    await screen.findByTestId('material-pedigree-table')
    expect(screen.queryByTestId('material-scope-note')).toBeNull()
  })

  it('points at the parameter editor', async () => {
    await withScope({})
    const onNavigate = vi.fn()
    render(<MaterialPedigreeTable onNavigate={onNavigate} />)
    fireEvent.click(await screen.findByTestId('material-scope-goto-parameters'))
    expect(onNavigate).toHaveBeenCalledWith('lca')
  })
})

describe('nothing scoreable is not zero percent', () => {
  it('says so, rather than showing 0%', () => {
    // 0% implies there is something here you could score and have not.
    render(<CoverageBanner coverage={coverage({ impact_share: null })} />)
    const el = screen.getByTestId('pedigree-coverage-none-scoreable')
    expect(el.textContent).toMatch(/nothing scoreable/i)
    // The sentence deliberately says "not 0% coverage", so the check is that
    // no percentage READOUT is rendered -- the headline is absent entirely.
    expect(el.textContent).toMatch(/not 0% coverage/i)
    expect(screen.queryByTestId('pedigree-coverage-headline')).toBeNull()
    expect(screen.queryByTestId('pedigree-coverage-next')).toBeNull()
  })

  it('still shows 0% when there ARE scoreable rows and none is scored', () => {
    render(<CoverageBanner coverage={coverage({ impact_share: 0 })} />)
    expect(screen.getByTestId('pedigree-coverage-headline').textContent).toContain('0%')
    expect(screen.queryByTestId('pedigree-coverage-none-scoreable')).toBeNull()
  })
})

describe('material scoring table', () => {
  it('lists one row per distinct material name', async () => {
    render(<MaterialPedigreeTable />)
    await screen.findByTestId('material-pedigree-table')
    for (const m of MATERIALS) {
      expect(screen.getByTestId(`material-row-${m}`)).toBeInTheDocument()
    }
    expect(screen.getByTestId('material-pedigree-count').textContent).toContain('0 of 4 scored')
  })

  it('states that inheritance shares the score, NOT the draw', async () => {
    // After the expression-row finding, a reader will reasonably assume a
    // shared name implies a shared draw. It does not, and the UI says so.
    const { container } = render(<MaterialPedigreeTable />)
    await screen.findByTestId('material-pedigree-table')
    expect(container.textContent).toMatch(/shares the score, not the draw/i)
    expect(container.textContent).toMatch(/sampled independently/i)
  })

  it('orders by unscored impact share, so the costly ones come first', async () => {
    const { container } = render(<MaterialPedigreeTable coverage={coverage()} />)
    await screen.findByTestId('material-pedigree-table')
    const order = Array.from(container.querySelectorAll('[data-testid^="material-row-"]'))
      .map((b) => b.getAttribute('data-testid'))
    expect(order[0]).toBe('material-row-Aluminium panels') // 18.9%
    expect(order[1]).toBe('material-row-Steel frame')      // 13.0%
  })

  it('shows an unscored material\'s cost next to it', async () => {
    render(<MaterialPedigreeTable coverage={coverage()} />)
    await screen.findByTestId('material-pedigree-table')
    expect(screen.getByTestId('material-share-Aluminium panels').textContent).toBe('18.9%')
  })

  it('scoring a name persists it and reports the new count', async () => {
    const c = await import('../src/api/client')
    render(<MaterialPedigreeTable />)
    await screen.findByTestId('material-pedigree-table')

    fireEvent.click(screen.getByTestId('material-row-Steel frame'))
    fireEvent.click(await screen.findByTestId('material-pedigree-Steel frame-reliability-3'))

    await waitFor(() => {
      expect(vi.mocked(c.saveMaterialPedigree)).toHaveBeenCalledWith({
        entries: { 'Steel frame': { pedigree: { 'reliability': 3 }, basic_variance: undefined } },
      })
    })
    expect(screen.getByTestId('material-pedigree-count').textContent).toContain('1 of 4 scored')
    expect(screen.getByTestId('material-scored-Steel frame').textContent).toContain('3,1,1,1,1')
  })

  it('filters, and can hide what is already scored', async () => {
    const c = await import('../src/api/client')
    vi.mocked(c.getMaterialPedigree).mockResolvedValue({
      entries: { 'Steel frame': { pedigree: { 'reliability': 3 } } },
    })
    render(<MaterialPedigreeTable />)
    await screen.findByTestId('material-pedigree-table')

    fireEvent.change(screen.getByTestId('material-pedigree-filter'), { target: { value: 'alum' } })
    expect(screen.getByTestId('material-row-Aluminium panels')).toBeInTheDocument()
    expect(screen.queryByTestId('material-row-Glass')).toBeNull()

    fireEvent.change(screen.getByTestId('material-pedigree-filter'), { target: { value: '' } })
    fireEvent.click(screen.getByTestId('material-pedigree-only-unscored'))
    expect(screen.queryByTestId('material-row-Steel frame')).toBeNull()
    expect(screen.getByTestId('material-row-Glass')).toBeInTheDocument()
  })

  it('an empty library leaves every material unscored', async () => {
    const { container } = render(<MaterialPedigreeTable />)
    await screen.findByTestId('material-pedigree-table')
    expect(container.querySelectorAll('[data-testid^="material-scored-"]')).toHaveLength(0)
  })
})
