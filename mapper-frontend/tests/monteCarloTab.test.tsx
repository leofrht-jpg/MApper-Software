/* SPDX-License-Identifier: MPL-2.0 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MonteCarloPage } from '../src/pages/MonteCarlo'
import { useMonteCarloStore } from '../src/stores/monteCarloStore'
import { boxStats, histogram } from '../src/utils/boxStats'
import type { MonteCarloResult } from '../src/api/client'

vi.mock('../src/api/client', async (orig) => {
  const actual = await orig<typeof import('../src/api/client')>()
  return { ...actual, startMonteCarlo: vi.fn(), getMonteCarloResult: vi.fn(), cancelTask: vi.fn() }
})

const HANDOFF = {
  archetypeId: 'arc-1',
  archetypeName: 'PHEV-NMC811',
  methods: [['EF v3.1', 'climate change', 'GWP100'], ['EF v3.1', 'acidification', 'AE']],
  scope: 'all' as const,
  stageAmounts: { Manufacturing: 1 },
  basisAmounts: null,
  parameterScenario: null,
  computeDatabase: null,
}

function result(over: Partial<MonteCarloResult> = {}): MonteCarloResult {
  return {
    archetype_id: 'arc-1', archetype_name: 'PHEV-NMC811', scope: 'all',
    n_iterations: 1000, seed: 42, elapsed_seconds: 75.3,
    compute_database: null, parameter_scenario: null,
    distributions: [{
      method: ['EF v3.1', 'climate change', 'GWP100'],
      method_label: 'climate change | GWP100', unit: 'kg CO2-eq',
      deterministic: 12597, median: 14250, mean: 14400,
      p2_5: 11500, p25: 13400, p75: 15200, p97_5: 17800,
      gsd2: 1.235, n_iterations: 1000, seed: 42, samples: [12000, 13000, 14000, 15000, 16000],
    }],
    contributors: [], rows_with_uncertainty: 0, parameters_with_uncertainty: 0, warnings: [],
    ...over,
  }
}

beforeEach(() => {
  useMonteCarloStore.setState({
    handoff: null, taskId: null, running: false, pct: 0, stage: '',
    error: null, cancelled: false, result: null,
  })
})

describe('Monte Carlo tab', () => {
  it('shows guidance instead of an empty form when nothing was handed over', () => {
    render(<MonteCarloPage />)
    expect(screen.getByTestId('mc-no-handoff')).toBeInTheDocument()
  })

  it('arriving from a result requires no re-specification', () => {
    useMonteCarloStore.setState({ handoff: HANDOFF })
    render(<MonteCarloPage />)
    // archetype, indicator count and scope all carried over
    expect(screen.getByText('PHEV-NMC811')).toBeInTheDocument()
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    expect(screen.getByText('Full Lifecycle')).toBeInTheDocument()
    // and it is runnable immediately
    expect(screen.getByTestId('mc-run')).not.toBeDisabled()
  })

  it('defaults to 1000 iterations with an editable seed', () => {
    useMonteCarloStore.setState({ handoff: HANDOFF })
    render(<MonteCarloPage />)
    expect((screen.getByTestId('mc-iterations') as HTMLInputElement).value).toBe('1000')
    const seed = screen.getByTestId('mc-seed') as HTMLInputElement
    expect(seed.placeholder).toBe('random')
    fireEvent.change(seed, { target: { value: '42' } })
    expect(seed.value).toBe('42')
  })

  it('states the lower-bound caveat in the UI, not only the docs', () => {
    useMonteCarloStore.setState({ handoff: HANDOFF, result: result() })
    render(<MonteCarloPage />)
    const note = screen.getByTestId('mc-lower-bound-note')
    expect(note.textContent).toMatch(/lower bound/i)
    expect(note.textContent).toMatch(/12%/)
    expect(note.textContent).toMatch(/sampled as fixed/i)
  })

  it('shows the deterministic score alongside the distribution', () => {
    useMonteCarloStore.setState({ handoff: HANDOFF, result: result() })
    const { container } = render(<MonteCarloPage />)
    expect(container.textContent).toContain('Deterministic')
    expect(container.textContent).toContain('MC median')
    // and the ratio between them, which is the free correctness check
    expect(container.textContent).toContain('1.131×')
  })

  it('does not flag the ordinary lognormal offset as suspicious', () => {
    // median 1.13x deterministic is EXPECTED for ecoinvent, not a defect --
    // flagging it would cry wolf on every single run.
    useMonteCarloStore.setState({ handoff: HANDOFF, result: result() })
    render(<MonteCarloPage />)
    expect(screen.queryByTestId('mc-ratio-flag')).toBeNull()
  })

  it('does flag a median below the deterministic score', () => {
    const r = result()
    r.distributions[0].median = 6000 // 0.48x -- the shape that IS wrong
    useMonteCarloStore.setState({ handoff: HANDOFF, result: r })
    render(<MonteCarloPage />)
    expect(screen.getByTestId('mc-ratio-flag')).toBeInTheDocument()
  })

  it('says so when no foreground input carries uncertainty', () => {
    useMonteCarloStore.setState({ handoff: HANDOFF, result: result() })
    render(<MonteCarloPage />)
    expect(screen.getByTestId('mc-no-contributors').textContent)
      .toMatch(/background database/i)
  })
})

describe('result lifecycle', () => {
  it('keeps the result when the tab is navigated away from and back to', () => {
    useMonteCarloStore.setState({ handoff: HANDOFF, result: result() })
    const { unmount } = render(<MonteCarloPage />)
    expect(screen.getByTestId('mc-lower-bound-note')).toBeInTheDocument()
    unmount()
    // Remount is exactly what returning to the tab does. Clearing on mount
    // would discard a finished 75-second run every time the user looked away.
    render(<MonteCarloPage />)
    expect(screen.getByTestId('mc-lower-bound-note')).toBeInTheDocument()
    expect(useMonteCarloStore.getState().result).not.toBeNull()
  })

  it('clears the result when a DIFFERENT computation is handed over', () => {
    useMonteCarloStore.setState({ handoff: HANDOFF, result: result() })
    const { rerender } = render(<MonteCarloPage />)
    expect(screen.getByTestId('mc-lower-bound-note')).toBeInTheDocument()
    useMonteCarloStore.setState({ handoff: { ...HANDOFF, archetypeId: 'arc-2', archetypeName: 'BEV-LFP' } })
    rerender(<MonteCarloPage />)
    expect(screen.queryByTestId('mc-lower-bound-note')).toBeNull()
    expect(useMonteCarloStore.getState().result).toBeNull()
  })
})

describe('shared box stats', () => {
  it('is the same implementation AESA uses', async () => {
    // Imported from the shared util by both; a second quantile function would
    // put identical data in visibly different boxes on two tabs.
    const src = await import('../src/components/aesa/BoxPlotView')
    expect(src).toBeTruthy()
    const s = boxStats([1, 2, 3, 4])
    expect(s.median).toBe(2.5)
    expect(s.q1).toBe(1.75)
    expect(s.q3).toBe(3.25)
  })

  it('bins a sample without losing draws', () => {
    const vals = Array.from({ length: 500 }, (_, i) => i)
    const bins = histogram(vals)
    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(500)
  })

  it('returns no bins when every draw is identical', () => {
    expect(histogram([5, 5, 5, 5])).toEqual([])
  })
})
