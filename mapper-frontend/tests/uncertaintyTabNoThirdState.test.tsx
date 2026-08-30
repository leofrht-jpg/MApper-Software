/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/**
 * The Uncertainty tab has exactly TWO render states: the empty state, or a
 * populated form. There is no third one.
 *
 * The third state that existed: a truthy-but-INCOMPLETE handoff skipped the
 * `!handoff` empty-state branch and then threw on the first field the
 * populated path read. The throw site was the hook phase, not the branch --
 * `handoff?.methods[Math.min(sel, (handoff?.methods.length ?? 1) - 1)]`
 * short-circuits the outer access but still evaluates `.length` on
 * `undefined`. So the guard has to normalise ABOVE the hooks, and a test that
 * only asserted the branch would miss it.
 *
 * Why the transition cases carry their weight: rendering "no handoff" and
 * rendering "has handoff" as two separate mounts both pass against a component
 * that breaks when one becomes the other, because each mount only ever walks
 * one path. That is the same margins-not-the-cross gap the paired `_cf` cache
 * bug shipped through -- every margin was covered and the interaction was not.
 * These tests mutate the store on an ALREADY-MOUNTED panel.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { MonteCarloPage } from '../src/pages/MonteCarlo'
import {
  isUsableHandoff,
  isUsableMultiHandoff,
  useMonteCarloStore,
} from '../src/stores/monteCarloStore'

vi.mock('../src/api/client', async (orig) => {
  const actual = await orig<typeof import('../src/api/client')>()
  return {
    ...actual,
    startMonteCarlo: vi.fn(),
    startMonteCarloMulti: vi.fn(),
    getMonteCarloResult: vi.fn(),
    getMonteCarloMultiResult: vi.fn(),
    cancelTask: vi.fn(),
    getPedigreeCoverage: vi.fn().mockRejectedValue(new Error('no coverage in test')),
    exportMonteCarlo: vi.fn().mockResolvedValue(undefined),
    exportMonteCarloMulti: vi.fn().mockResolvedValue(undefined),
  }
})

const HANDOFF = {
  archetypeId: 'arc-1',
  archetypeName: 'PHEV-NMC811',
  methods: [['EF v3.1', 'climate change', 'GWP100']],
  scope: 'all' as const,
  stageAmounts: { Manufacturing: 1 },
  basisAmounts: null,
  parameterScenario: null,
  computeDatabase: null,
}

const MULTI_HANDOFF = {
  items: [
    { archetypeId: 'arc-1', archetypeName: 'A - Circular EV' },
    { archetypeId: 'arc-2', archetypeName: 'A0 - Reference EV' },
  ],
  methods: [['EF v3.1', 'climate change', 'GWP100']],
  scope: 'all' as const,
  stageAmounts: {},
  parameterScenario: null,
  computeDatabase: null,
}

/** Every slot, so a case can never inherit another's leftovers. */
const CLEARED = {
  handoff: null,
  multiHandoff: null,
  multiResult: null,
  result: null,
  taskId: null,
  running: false,
  pct: 0,
  stage: '',
  error: null,
  cancelled: false,
}

beforeEach(() => {
  useMonteCarloStore.setState(CLEARED as never)
})

/** The invariant under test, in one place: SOMETHING is always drawn. */
function expectDrawsSomething(container: HTMLElement, what: string) {
  expect(container.innerHTML.trim(), `${what} drew nothing`).not.toBe('')
  const empty = container.querySelector('[data-testid="mc-no-handoff"]')
  const single = container.querySelector('[data-testid="monte-carlo-page"]')
  const multi = container.querySelector('[data-testid="monte-carlo-multi"]')
  expect(
    Boolean(empty) || Boolean(single) || Boolean(multi),
    `${what} drew neither the empty state nor a populated form`,
  ).toBe(true)
}

describe('Uncertainty tab has no third render state', () => {
  // ---------------------------------------------------------------- transitions

  it('stays rendered when a handoff arrives on an already-mounted panel', () => {
    const { container } = render(<MonteCarloPage />)
    expect(container.querySelector('[data-testid="mc-no-handoff"]')).not.toBeNull()

    act(() => {
      useMonteCarloStore.setState({ handoff: HANDOFF } as never)
    })

    expectDrawsSomething(container, 'after a handoff arrived')
    expect(container.querySelector('[data-testid="monte-carlo-page"]')).not.toBeNull()
  })

  it('stays rendered when a multi-item handoff arrives on an already-mounted panel', () => {
    const { container } = render(<MonteCarloPage />)
    expect(container.querySelector('[data-testid="mc-no-handoff"]')).not.toBeNull()

    act(() => {
      useMonteCarloStore.setState({ multiHandoff: MULTI_HANDOFF } as never)
    })

    expectDrawsSomething(container, 'after a multi handoff arrived')
    expect(container.querySelector('[data-testid="monte-carlo-multi"]')).not.toBeNull()
  })

  it('stays rendered when a handoff is cleared again (project switch)', () => {
    useMonteCarloStore.setState({ handoff: HANDOFF } as never)
    const { container } = render(<MonteCarloPage />)
    expect(container.querySelector('[data-testid="monte-carlo-page"]')).not.toBeNull()

    act(() => {
      useMonteCarloStore.setState({ handoff: null, multiHandoff: null } as never)
    })

    expectDrawsSomething(container, 'after the handoff was cleared')
    expect(container.querySelector('[data-testid="mc-no-handoff"]')).not.toBeNull()
  })

  it('survives switching between single and multi modes in place', () => {
    const { container } = render(<MonteCarloPage />)
    for (const next of [
      { handoff: HANDOFF, multiHandoff: null },
      { handoff: null, multiHandoff: MULTI_HANDOFF },
      { handoff: HANDOFF, multiHandoff: null },
      { handoff: null, multiHandoff: null },
    ]) {
      act(() => {
        useMonteCarloStore.setState(next as never)
      })
      expectDrawsSomething(container, `after switching to ${JSON.stringify(Object.keys(next))}`)
    }
  })

  // ------------------------------------------------- incomplete handoffs (the bug)

  // Each of these is truthy, so the `!handoff` empty-state branch is skipped.
  // Before the fix every one of them threw during the hook phase.
  const incompleteSingle: Array<[string, unknown]> = [
    ['empty object', {}],
    ['methods undefined', { archetypeId: 'a', archetypeName: 'A', scope: 'all', stageAmounts: {} }],
    ['methods null', { archetypeId: 'a', archetypeName: 'A', methods: null, scope: 'all', stageAmounts: {} }],
    ['methods not an array', { archetypeId: 'a', archetypeName: 'A', methods: 'EF', scope: 'all', stageAmounts: {} }],
  ]

  for (const [name, bad] of incompleteSingle) {
    it(`falls back to the empty state for an incomplete handoff: ${name}`, () => {
      useMonteCarloStore.setState({ ...CLEARED, handoff: bad } as never)
      const { container } = render(<MonteCarloPage />)
      expectDrawsSomething(container, `incomplete handoff (${name})`)
      expect(container.querySelector('[data-testid="mc-no-handoff"]')).not.toBeNull()
    })
  }

  const incompleteMulti: Array<[string, unknown]> = [
    ['empty object', {}],
    ['items undefined', { methods: [['a', 'b', 'c']], scope: 'all', stageAmounts: {} }],
    ['items null', { items: null, methods: [['a', 'b', 'c']], scope: 'all', stageAmounts: {} }],
    ['methods undefined', { items: [{ archetypeId: 'a', archetypeName: 'A' }], scope: 'all', stageAmounts: {} }],
  ]

  for (const [name, bad] of incompleteMulti) {
    it(`falls back to the empty state for an incomplete multi handoff: ${name}`, () => {
      useMonteCarloStore.setState({ ...CLEARED, multiHandoff: bad } as never)
      const { container } = render(<MonteCarloPage />)
      expectDrawsSomething(container, `incomplete multi handoff (${name})`)
      expect(container.querySelector('[data-testid="mc-no-handoff"]')).not.toBeNull()
    })
  }

  it('an incomplete handoff ARRIVING on a mounted panel does not blank it', () => {
    const { container } = render(<MonteCarloPage />)
    act(() => {
      useMonteCarloStore.setState({ handoff: { archetypeId: 'a' } } as never)
    })
    expectDrawsSomething(container, 'after an incomplete handoff arrived')
    expect(container.querySelector('[data-testid="mc-no-handoff"]')).not.toBeNull()
  })

  // ------------------------------------------------------------------ predicates

  it('the predicates accept exactly what the panel dereferences', () => {
    expect(isUsableHandoff(HANDOFF)).toBe(true)
    expect(isUsableHandoff(null)).toBe(false)
    expect(isUsableHandoff(undefined)).toBe(false)
    // methods is the field the populated path reads first
    expect(isUsableHandoff({ ...HANDOFF, methods: undefined } as never)).toBe(false)
    // an EMPTY methods list is still drawable -- the guard must not reject it
    expect(isUsableHandoff({ ...HANDOFF, methods: [] })).toBe(true)

    expect(isUsableMultiHandoff(MULTI_HANDOFF)).toBe(true)
    expect(isUsableMultiHandoff(null)).toBe(false)
    expect(isUsableMultiHandoff({ ...MULTI_HANDOFF, items: undefined } as never)).toBe(false)
    // an empty comparison still draws (with Run disabled), so it is usable
    expect(isUsableMultiHandoff({ ...MULTI_HANDOFF, items: [] })).toBe(true)
  })
})
