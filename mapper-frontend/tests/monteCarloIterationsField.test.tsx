/* SPDX-License-Identifier: MPL-2.0 */
/**
 * The Iterations field on the Uncertainty page could not be cleared.
 *
 * Its onChange did `Math.max(1, Number(value) || 1)` on every keystroke, so
 * emptying the field (Number('') is 0, falsy) snapped it straight back to 1,
 * and typing a new count after selecting the old one produced "164", not "64".
 * The clamp now happens on blur (NumberInput); the run payload is unchanged.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MonteCarloPage } from '../src/pages/MonteCarlo'
import { useMonteCarloStore } from '../src/stores/monteCarloStore'
import { startMonteCarlo, startMonteCarloMulti } from '../src/api/client'

vi.mock('../src/api/client', async (orig) => {
  const actual = await orig<typeof import('../src/api/client')>()
  return {
    ...actual,
    // Rejecting stops the run before it opens a WebSocket; only the payload matters.
    startMonteCarlo: vi.fn().mockRejectedValue(new Error('stop here')),
    startMonteCarloMulti: vi.fn().mockRejectedValue(new Error('stop here')),
    getMonteCarloResult: vi.fn(), cancelTask: vi.fn(),
    getPedigreeCoverage: vi.fn().mockRejectedValue(new Error('no coverage in test')),
  }
})

const SINGLE = {
  archetypeId: 'arc-1', archetypeName: 'PHEV-NMC811',
  methods: [['EF v3.1', 'climate change', 'GWP100']],
  scope: 'all' as const, stageAmounts: {}, basisAmounts: null,
  parameterScenario: null, computeDatabase: null,
}
const MULTI = {
  items: [
    { archetypeId: 'a', archetypeName: 'A - Circular EV' },
    { archetypeId: 'b', archetypeName: 'A0 - Reference EV' },
  ],
  methods: [['EF v3.1', 'climate change', 'GWP100']],
  scope: 'all' as const, stageAmounts: {}, parameterScenario: null, computeDatabase: null,
}

const MODES = [
  {
    name: 'single-item', field: 'mc-iterations', run: 'mc-run',
    setup: () => useMonteCarloStore.setState({ handoff: SINGLE, multiHandoff: null }),
    started: () => vi.mocked(startMonteCarlo),
  },
  {
    name: 'multi-item', field: 'mc-multi-iterations', run: 'mc-multi-run',
    setup: () => useMonteCarloStore.setState({ handoff: null, multiHandoff: MULTI }),
    started: () => vi.mocked(startMonteCarloMulti),
  },
]

beforeEach(() => {
  vi.mocked(startMonteCarlo).mockClear()
  vi.mocked(startMonteCarloMulti).mockClear()
  useMonteCarloStore.setState({
    handoff: null, multiHandoff: null, taskId: null, running: false, pct: 0,
    stage: '', error: null, cancelled: false, result: null, multiResult: null,
  })
})

describe.each(MODES)('$name Iterations field', ({ field, run, setup, started }) => {
  const input = () => screen.getByTestId(field) as HTMLInputElement
  // A keystroke appends to what the field SHOWS. Setting the whole value with
  // fireEvent.change would hide the old snap-back: the field re-rendered "1"
  // after clearing, so the next key made "16", not "6".
  const typeKey = (ch: string) =>
    fireEvent.change(input(), { target: { value: input().value + ch } })

  it('keeps the 1000 default and sends it unchanged', async () => {
    setup()
    render(<MonteCarloPage />)
    expect(input().value).toBe('1000')
    fireEvent.click(screen.getByTestId(run))
    await waitFor(() => expect(started()).toHaveBeenCalled())
    expect(started().mock.calls[0][0].iterations).toBe(1000)
  })

  it('can be cleared entirely', () => {
    setup()
    render(<MonteCarloPage />)
    fireEvent.change(input(), { target: { value: '' } })
    expect(input().value).toBe('')
  })

  it('takes "64" typed into an emptied field, and sends 64', async () => {
    setup()
    render(<MonteCarloPage />)
    fireEvent.change(input(), { target: { value: '' } })
    typeKey('6')
    typeKey('4')
    expect(input().value).toBe('64')
    fireEvent.blur(input())
    expect(input().value).toBe('64')
    fireEvent.click(screen.getByTestId(run))
    await waitFor(() => expect(started()).toHaveBeenCalled())
    expect(started().mock.calls[0][0].iterations).toBe(64)
  })

  it('restores the minimum when blurred empty', () => {
    setup()
    render(<MonteCarloPage />)
    fireEvent.change(input(), { target: { value: '' } })
    fireEvent.blur(input())
    expect(input().value).toBe('1')
  })

  it('clamps above the backend cap on blur rather than sending a run that 400s', () => {
    setup()
    render(<MonteCarloPage />)
    fireEvent.change(input(), { target: { value: '50000' } })
    fireEvent.blur(input())
    expect(input().value).toBe('20000')
  })
})
