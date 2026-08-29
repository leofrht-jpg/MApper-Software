/* SPDX-License-Identifier: MPL-2.0 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PedigreeEditor } from '../src/components/uncertainty/PedigreeEditor'
import {
  __resetPedigreeCache,
  gsd2Of,
  scoreSummary,
  totalSigma,
  varianceContribution,
} from '../src/utils/pedigree'
import type { PedigreeTable } from '../src/api/client'

// The real table, as the backend serves it. Written out here independently so
// a typo on either side shows up as a disagreement rather than agreeing with
// itself.
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
  convention: 'sigma_i^2 = [ln(f_i) / 2]^2 — the factor is a 95% range, hence the /2.',
} as PedigreeTable }))

vi.mock('../src/api/client', async (orig) => {
  const actual = await orig<typeof import('../src/api/client')>()
  return { ...actual, getPedigreeTable: vi.fn().mockResolvedValue(TABLE) }
})

beforeEach(() => { __resetPedigreeCache() })

describe('pedigree maths', () => {
  it('applies the /2 — the factor is a 95% range', () => {
    // The same four numbers the backend test pins, so the two sides cannot
    // drift apart silently.
    expect(varianceContribution(TABLE, 'reliability', 5)).toBeCloseTo(0.041100, 6)
    expect(varianceContribution(TABLE, 'further technological correlation', 5)).toBeCloseTo(0.120113, 6)
    expect(varianceContribution(TABLE, 'temporal correlation', 3)).toBeCloseTo(0.002271, 6)
    expect(varianceContribution(TABLE, 'completeness', 4)).toBeCloseTo(0.002271, 6)
  })

  it('would be ~4x larger without the /2', () => {
    const withHalf = varianceContribution(TABLE, 'reliability', 5)
    const withoutHalf = Math.pow(Math.log(1.5), 2)
    expect(withoutHalf / withHalf).toBeCloseTo(4.0, 6)
  })

  it('score 1 contributes nothing', () => {
    for (const ind of TABLE.indicators) {
      expect(varianceContribution(TABLE, ind, 1)).toBe(0)
    }
  })

  it('composes in variance, not in sigma', () => {
    const scores = { 'reliability': 3, 'temporal correlation': 4 }
    const expected = Math.sqrt(
      0.0006
      + varianceContribution(TABLE, 'reliability', 3)
      + varianceContribution(TABLE, 'temporal correlation', 4),
    )
    expect(totalSigma(TABLE, scores, 0.0006)).toBeCloseTo(expected, 12)
  })

  it('an unscored target has GSD² driven by basic variance alone', () => {
    expect(gsd2Of(TABLE, null, 0)).toBe(1)
  })

  it('a single score round-trips to its own published factor', () => {
    for (const [ind, factors] of Object.entries(TABLE.factors)) {
      for (let score = 2; score <= 5; score++) {
        expect(gsd2Of(TABLE, { [ind]: score }, 0)).toBeCloseTo(factors[score - 1], 10)
      }
    }
  })

  it('summarises a score set for the collapsed row badge', () => {
    expect(scoreSummary(TABLE, { 'reliability': 3, 'completeness': 2 })).toBe('3,2,1,1,1')
    expect(scoreSummary(TABLE, null)).toBe('')
  })
})

describe('PedigreeEditor', () => {
  const noop = () => {}

  it('starts unscored and says what that means', async () => {
    render(<PedigreeEditor scores={null} basicVariance={null} onChange={noop} testIdPrefix="t" />)
    await screen.findByTestId('t-editor')
    expect(screen.getByTestId('t-unscored').textContent)
      .toMatch(/contributes no foreground variance/i)
  })

  it('shows a live GSD² from the SERVED table', async () => {
    render(
      <PedigreeEditor
        scores={{ 'reliability': 5 }}
        basicVariance={0}
        onChange={noop}
        testIdPrefix="t"
      />,
    )
    await screen.findByTestId('t-editor')
    // With ONE indicator scored and no basic variance, GSD² is the published
    // factor exactly: exp(2 * ln(f)/2) == f. A clean check that the /2 in the
    // variance and the exp(2 sigma) in the GSD² are exact inverses -- drop
    // either and this stops being 1.500.
    expect(screen.getByTestId('t-gsd2').textContent).toContain('1.500')
  })

  it('picking a score emits it; picking 1 removes it', async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <PedigreeEditor scores={null} basicVariance={null} onChange={onChange} testIdPrefix="t" />,
    )
    await screen.findByTestId('t-editor')

    fireEvent.click(screen.getByTestId('t-reliability-4'))
    expect(onChange).toHaveBeenLastCalledWith({ 'reliability': 4 }, null)

    rerender(
      <PedigreeEditor scores={{ 'reliability': 4 }} basicVariance={null} onChange={onChange} testIdPrefix="t" />,
    )
    // Back to 1 means "no added uncertainty", which is the same as unscored --
    // storing a 1 would make an unscored row look scored.
    fireEvent.click(screen.getByTestId('t-reliability-1'))
    expect(onChange).toHaveBeenLastCalledWith(null, null)
  })

  it('refuses to offer the field on an expression row', async () => {
    render(
      <PedigreeEditor
        scores={null}
        basicVariance={null}
        onChange={noop}
        testIdPrefix="t"
        disabledReason="This quantity is a parameter expression — score the parameters instead."
      />,
    )
    // The guard from the Monte Carlo patch: the UI must not offer the field,
    // not merely reject it on save.
    expect(await screen.findByTestId('t-disabled')).toBeInTheDocument()
    expect(screen.queryByTestId('t-editor')).toBeNull()
    expect(screen.queryByTestId('t-reliability-3')).toBeNull()
  })

  it('clears back to unscored', async () => {
    const onChange = vi.fn()
    render(
      <PedigreeEditor
        scores={{ 'reliability': 3 }}
        basicVariance={0.01}
        onChange={onChange}
        testIdPrefix="t"
      />,
    )
    await screen.findByTestId('t-editor')
    fireEvent.click(screen.getByTestId('t-clear'))
    expect(onChange).toHaveBeenLastCalledWith(null, null)
  })

  it('holds no second copy of the factors', async () => {
    // Serve a deliberately wrong table; the editor must follow it, proving the
    // numbers come from the payload and not from a local constant.
    const { getPedigreeTable } = await import('../src/api/client')
    vi.mocked(getPedigreeTable).mockResolvedValueOnce({
      ...TABLE,
      factors: { ...TABLE.factors, 'reliability': [1, 1, 1, 1, 9.0] },
    })
    render(
      <PedigreeEditor scores={{ 'reliability': 5 }} basicVariance={0} onChange={noop} testIdPrefix="t" />,
    )
    await waitFor(() => {
      // exp(2 * sqrt((ln 9 / 2)^2)) = 9
      expect(screen.getByTestId('t-gsd2').textContent).toContain('9.000')
    })
  })
})
