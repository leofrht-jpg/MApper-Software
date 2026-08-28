/* SPDX-License-Identifier: MPL-2.0 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Sidebar } from '../src/components/layout/Sidebar'
import { useMonteCarloStore } from '../src/stores/monteCarloStore'

vi.mock('../src/api/client', async (orig) => {
  const actual = await orig<typeof import('../src/api/client')>()
  return { ...actual, getMethods: vi.fn().mockResolvedValue([]) }
})

beforeEach(() => {
  useMonteCarloStore.setState({ handoff: null, result: null, running: false })
})

describe('Uncertainty tab placement', () => {
  it('sits at sidebar position 7, after AESA', () => {
    const { container } = render(<Sidebar activeItem="databases" onItemClick={() => {}} />)
    // Settings renders through the same helper but is pinned to the footer,
    // so it is not part of the ordered nav sequence.
    const labels = Array.from(container.querySelectorAll('button[data-tour^="nav-"]'))
      .map((b) => b.getAttribute('aria-label'))
      .filter((l) => l !== 'Settings')
    expect(labels).toEqual([
      'Databases',
      'pLCA Developer',
      'LCA Architect',
      'Dynamic Stock Modeller',
      'Impact Assessment',
      'AESA',
      'Uncertainty',
    ])
    expect(labels.indexOf('Uncertainty')).toBe(6) // 0-indexed position 7
  })

  it('is reachable directly, not only via a handoff', () => {
    const onItemClick = vi.fn()
    render(<Sidebar activeItem="databases" onItemClick={onItemClick} />)
    fireEvent.click(screen.getByLabelText('Uncertainty'))
    expect(onItemClick).toHaveBeenCalledWith('uncertainty')
  })
})

describe('handoff contract', () => {
  it('carries everything the run needs, so nothing is re-specified', () => {
    useMonteCarloStore.getState().setHandoff({
      archetypeId: 'arc-1',
      archetypeName: 'PHEV-NMC811',
      methods: [['EF v3.1', 'climate change', 'GWP100']],
      scope: 'all',
      stageAmounts: { Manufacturing: 1, 'Use Phase': 15 },
      basisAmounts: null,
      parameterScenario: 'Optimistic',
      computeDatabase: null,
    })
    const h = useMonteCarloStore.getState().handoff!
    // The four coordinates that define a single-product computation.
    expect(h.archetypeId).toBe('arc-1')
    expect(h.methods).toHaveLength(1)
    expect(h.scope).toBe('all')
    expect(h.parameterScenario).toBe('Optimistic')
    // Stage amounts too -- omitting them would silently change the result
    // relative to the deterministic run being compared against.
    expect(h.stageAmounts['Use Phase']).toBe(15)
  })

  it('does not auto-run — a minute of compute is the user\'s call', () => {
    useMonteCarloStore.getState().setHandoff({
      archetypeId: 'arc-1', archetypeName: 'X', methods: [['a', 'b', 'c']],
      scope: 'all', stageAmounts: {}, basisAmounts: null,
      parameterScenario: null, computeDatabase: null,
    })
    expect(useMonteCarloStore.getState().running).toBe(false)
    expect(useMonteCarloStore.getState().result).toBeNull()
  })
})
