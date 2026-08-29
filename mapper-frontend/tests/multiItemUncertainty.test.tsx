/* SPDX-License-Identifier: MPL-2.0 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  ItemPicker, MultiItemBoxPlot, PairwiseDifferences,
} from '../src/components/uncertainty/MultiItemUncertainty'
import { estimatePairedSeconds, formatEstimate } from '../src/api/client'
import type { MonteCarloMultiResult, PairwiseDifference } from '../src/api/client'
import type { MonteCarloMultiHandoff } from '../src/stores/monteCarloStore'

const HANDOFF: MonteCarloMultiHandoff = {
  items: [
    { archetypeId: 'a', archetypeName: 'A - Circular EV' },
    { archetypeId: 'b', archetypeName: 'A0 - Reference EV' },
    { archetypeId: 'c', archetypeName: 'B - Circular BESS' },
  ],
  methods: [['EF v3.1', 'climate change', 'GWP100']],
  scope: 'all', stageAmounts: {}, parameterScenario: null, computeDatabase: null,
}

function diff(over: Partial<PairwiseDifference> = {}): PairwiseDifference {
  return {
    method: ['EF v3.1', 'climate change', 'GWP100'],
    method_label: 'climate change | GWP100', unit: 'kg CO2-eq',
    a_id: 'a', a_name: 'A - Circular EV', b_id: 'b', b_name: 'A0 - Reference EV',
    deterministic: -2.0, median: -2.1, mean: -2.1,
    p2_5: -2.4, p25: -2.2, p75: -2.0, p97_5: -1.8,
    fraction_a_lower: 1.0, correlation: 0.9861, ...over,
  }
}

function dist(label = 'climate change | GWP100', med = 11) {
  return {
    method: ['EF v3.1', 'climate change', 'GWP100'], method_label: label,
    unit: 'kg CO2-eq', deterministic: 10, median: med, mean: med,
    p2_5: med * 0.9, p25: med * 0.95, p75: med * 1.05, p97_5: med * 1.1,
    gsd2: 1.2, n_iterations: 200, seed: 77, samples: null,
  }
}

function result(over: Partial<MonteCarloMultiResult> = {}): MonteCarloMultiResult {
  return {
    scope: 'all', n_iterations: 200, seed: 77, elapsed_seconds: 35,
    compute_database: null, parameter_scenario: null,
    items: [
      { archetype_id: 'a', archetype_name: 'A - Circular EV', distributions: [dist()] },
      { archetype_id: 'b', archetype_name: 'A0 - Reference EV', distributions: [dist('climate change | GWP100', 13)] },
    ],
    differences: [diff()], warnings: [], ...over,
  }
}

describe('the time estimate', () => {
  it('is the measured formula, 59 + 39×(N−1) per 1000 iterations', () => {
    expect(estimatePairedSeconds(1, 1000)).toBeCloseTo(59)
    expect(estimatePairedSeconds(2, 1000)).toBeCloseTo(98)
    expect(estimatePairedSeconds(4, 1000)).toBeCloseTo(176)
    // Linear in iterations.
    expect(estimatePairedSeconds(4, 500)).toBeCloseTo(88)
    expect(estimatePairedSeconds(0, 1000)).toBe(0)
  })

  it('reads as minutes once it is minutes', () => {
    expect(formatEstimate(59)).toBe('~59 s')
    expect(formatEstimate(176)).toBe('~3 min')
  })
})

describe('the item picker', () => {
  it('defaults to the comparison selection and shows the estimate', () => {
    render(<ItemPicker handoff={HANDOFF} selected={['a', 'b', 'c']} onToggle={() => {}} iterations={1000} />)
    for (const it of HANDOFF.items) {
      expect(screen.getByTestId(`mc-item-${it.archetypeId}`)).toBeInTheDocument()
    }
    expect(screen.getByTestId('mc-estimate').textContent).toContain('3 items')
    expect(screen.getByTestId('mc-estimate').textContent).toContain('~2 min')
  })

  it('lets the user narrow, and the estimate follows', () => {
    const onToggle = vi.fn()
    const { rerender } = render(
      <ItemPicker handoff={HANDOFF} selected={['a', 'b', 'c']} onToggle={onToggle} iterations={1000} />)
    fireEvent.click(screen.getByTestId('mc-item-c').querySelector('input')!)
    expect(onToggle).toHaveBeenCalledWith('c')

    rerender(<ItemPicker handoff={HANDOFF} selected={['a', 'b']} onToggle={onToggle} iterations={1000} />)
    expect(screen.getByTestId('mc-estimate').textContent).toContain('2 items')
    // 98 s crosses the 90 s threshold, so it reads as minutes. Rounding UP is
    // the right direction for a figure shown before committing to a run.
    expect(screen.getByTestId('mc-estimate').textContent).toContain('~2 min')
  })

  it('warns when nothing is selected', () => {
    render(<ItemPicker handoff={HANDOFF} selected={[]} onToggle={() => {}} iterations={1000} />)
    expect(screen.getByTestId('mc-estimate').textContent).toMatch(/at least one item/i)
  })
})

describe('the pairwise difference is the headline', () => {
  it('states the claim a paired run supports', () => {
    render(<PairwiseDifferences result={result()} />)
    expect(screen.getByTestId('mc-pair-claim').textContent)
      .toBe('A - Circular EV is lower than A0 - Reference EV in 100% of iterations')
  })

  it('reports the correlation as information, not a warning', () => {
    render(<PairwiseDifferences result={result()} />)
    const corr = screen.getByTestId('mc-pair-corr-a-b').textContent ?? ''
    expect(corr).toContain('0.9861')
    expect(corr).toMatch(/move together/i)
    expect(corr).not.toMatch(/warning|caution|unreliable/i)
  })

  it('says a weakly correlated pair is genuinely wide, not wrong', () => {
    render(<PairwiseDifferences result={result({ differences: [diff({ correlation: 0.12 })] })} />)
    const corr = screen.getByTestId('mc-pair-corr-a-b').textContent ?? ''
    expect(corr).toMatch(/genuinely wide/i)
    expect(corr).not.toMatch(/warning|invalid/i)
  })

  it('handles a non-decisive pair without claiming 100%', () => {
    render(<PairwiseDifferences result={result({ differences: [diff({ fraction_a_lower: 0.62 })] })} />)
    expect(screen.getByTestId('mc-pair-claim').textContent).toContain('62.0% of iterations')
  })

  it('says so when there is only one item', () => {
    render(<PairwiseDifferences result={result({ differences: [] })} />)
    expect(screen.getByTestId('mc-no-pairs').textContent).toMatch(/single item/i)
  })
})

describe('the box plot', () => {
  it('draws one box per item in COMPARISON order', () => {
    const { container } = render(<MultiItemBoxPlot result={result()} />)
    const boxes = container.querySelectorAll('[data-testid^="mc-box-"]')
    expect(boxes).toHaveLength(2)
    // Order preserved: A before A0, not sorted by value (A0's median is higher).
    expect(boxes[0].textContent).toContain('A - Circular EV')
    expect(boxes[1].textContent).toContain('A0 - Reference EV')
  })

  it('opts in to chart export', () => {
    const { container } = render(<MultiItemBoxPlot result={result()} />)
    expect(container.querySelector('svg[data-chart-export-target]')).not.toBeNull()
  })
})
