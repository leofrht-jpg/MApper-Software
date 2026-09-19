/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
// The authoring editor reacts to the preview endpoint's verdict and restates
// none of its rules. So these tests drive the preview mock and check that the
// editor shows what it was told -- and that it never lets Save through before
// scope, all five scores and an accepted preview are in place.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor, within } from '@testing-library/react'

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
  convention: '',
} }))

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return {
    ...actual,
    getPedigreeTable: vi.fn(async () => TABLE),
    searchBiosphereFlows: vi.fn(),
    previewAuthoredExchange: vi.fn(),
    addAuthoredActivity: vi.fn(),
    updateAuthoredActivity: vi.fn(),
  }
})

import * as client from '../src/api/client'
import { HttpError, type AuthoredActivity, type AuthoredExchange, type FlowCandidate } from '../src/api/client'
import { AuthoredActivityEditor } from '../src/components/authored/AuthoredActivityEditor'
import { __resetPedigreeCache } from '../src/utils/pedigree'

const cand = (code: string, bv: number | null): FlowCandidate => ({
  database: 'biosphere3', code, name: 'Nitrogen oxides',
  categories: ['air', code === 's' ? 'non-urban air or from high stacks' : 'urban air close to ground'],
  unit: 'kilogram', type: 'emission', ecoinvent_exchanges: 100, floor_available: bv !== null,
  floor_gsd2: bv === null ? null : 1.93, floor_n: bv === null ? 0 : 2422,
  basic_variance: bv, basic_variance_n: bv === null ? 0 : 2000, characterised: 1, factors: { acidification: 0.74 },
})

const accepted = (floor_status: AuthoredExchange['floor_status'], extra: Partial<AuthoredExchange> = {}) => ({
  ok: true, problems: [], codes: [],
  exchange: {
    flow: { database: 'biosphere3', code: 's', name: 'Nitrogen oxides', categories: ['air', 'x'], unit: 'kilogram' },
    amount: 1, pedigree: {}, basic_variance: 0.08, basic_variance_source: 'ecoinvent_median',
    basic_variance_detail: 'ecoinvent median', gsd2: 1.95, floor_status, floor_gsd2: 1.93,
    floor_detail: floor_status === 'unfloored' ? 'only 3 lognormal ecoinvent exchanges' : '',
    floor_reason: null, ...extra,
  } as any,
})

beforeEach(() => {
  vi.clearAllMocks()
  __resetPedigreeCache()
  ;(globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  ;(client.searchBiosphereFlows as any).mockResolvedValue({
    database: 'biosphere3', family: 'EF v3.1', families: ['EF v3.1'], truncated: false,
    groups: [{
      name: 'Nitrogen oxides', database: 'biosphere3', units: ['kilogram'], family_indicator_count: 1,
      candidates: [cand('s', 0.08), cand('u', null)], varying_methods: [], uniform_methods: [],
    }],
  })
})

function renderEditor(props: Partial<Parameters<typeof AuthoredActivityEditor>[0]> = {}) {
  const onSaved = vi.fn()
  const r = render(<AuthoredActivityEditor database="mine" onSaved={onSaved} onCancel={() => {}} debounceMs={0} {...props} />)
  const body = within(document.body)
  return { ...r, body, onSaved }
}

async function addFlow(body: ReturnType<typeof within>, code: 's' | 'u') {
  fireEvent.click(body.getByTestId('authored-add-flow'))
  fireEvent.change(body.getByTestId('flow-picker-search'), { target: { value: 'nitrogen' } })
  const row = await waitFor(() => body.getByTestId(`flow-picker-candidate-${code}`), { timeout: 2000 })
  fireEvent.click(row)
  await waitFor(() => body.getByTestId(`exchange-${code}`))
}

async function scoreAll(body: ReturnType<typeof within>, code: string, score = 2) {
  await waitFor(() => body.getByTestId(`exchange-${code}-pedigree-reliability-1`))
  for (const ind of TABLE.indicators) fireEvent.click(body.getByTestId(`exchange-${code}-pedigree-${ind}-${score}`))
}

describe('authored activity editor', () => {
  it('requires a scope, and a note when the scope is partial', async () => {
    const { body } = renderEditor()
    fireEvent.change(body.getByTestId('authored-name'), { target: { value: 'Boiler' } })
    expect(body.getByTestId('authored-blockers').textContent).toContain('the inventory scope')
    expect(body.getByTestId('authored-save')).toBeDisabled()
    fireEvent.click(body.getByTestId('scope-partial'))
    expect(body.getByTestId('authored-blockers').textContent).toContain('what the partial inventory leaves out')
    fireEvent.change(body.getByTestId('scope-note'), { target: { value: 'CO2 only' } })
    expect(body.getByTestId('authored-blockers').textContent).not.toContain('partial inventory')
    // Neither scope radio is pre-selected: the user has to say it.
    const { body: fresh } = renderEditor()
    const radios = fresh.getAllByTestId('scope-complete')
    expect((radios[radios.length - 1] as HTMLInputElement).checked).toBe(false)
  })

  it('an added flow waits for all five scores before it is checked', async () => {
    ;(client.previewAuthoredExchange as any).mockResolvedValue(accepted('floored'))
    const { body } = renderEditor()
    await addFlow(body, 's')
    expect(body.getByTestId('exchange-s-compartment').textContent).toContain('non-urban air or from high stacks')
    expect(body.getByTestId('exchange-s-waiting')).toBeTruthy()
    expect(body.getByTestId('exchange-s-pedigree-missing')).toBeTruthy()
    // No "clear to 1" shortcut: a score of 1 must be chosen, not defaulted.
    expect(body.queryByTestId('exchange-s-pedigree-clear')).toBeNull()

    fireEvent.click(body.getByTestId('exchange-s-pedigree-reliability-2'))
    expect(client.previewAuthoredExchange).not.toHaveBeenCalled()
    expect(body.getByTestId('authored-blockers').textContent).toContain('all five pedigree scores')

    for (const ind of TABLE.indicators.slice(1)) fireEvent.click(body.getByTestId(`exchange-s-pedigree-${ind}-1`))
    await waitFor(() => expect(client.previewAuthoredExchange).toHaveBeenCalled())
    const sent = (client.previewAuthoredExchange as any).mock.calls.at(-1)[0]
    expect(sent.pedigree).toEqual({
      'reliability': 2, 'completeness': 1, 'temporal correlation': 1,
      'geographical correlation': 1, 'further technological correlation': 1,
    })
    await waitFor(() => body.getByTestId('exchange-s-floored'))
  })

  it('ecoinvent supplies the basic variance read-only when it has one', async () => {
    ;(client.previewAuthoredExchange as any).mockResolvedValue(accepted('floored'))
    const { body } = renderEditor()
    await addFlow(body, 's')
    expect(body.getByTestId('exchange-s-pedigree-basic-derived').textContent).toBe('0.0800')
    expect(body.getByTestId('exchange-s-pedigree-basic-note').textContent).toContain('2,000 exchanges')
    expect(body.queryByTestId('exchange-s-pedigree-basic-required')).toBeNull()
    expect(body.queryByTestId('exchange-s-bv-reason')).toBeNull()
    await scoreAll(body, 's')
    await waitFor(() => expect(client.previewAuthoredExchange).toHaveBeenCalled())
    const sent = (client.previewAuthoredExchange as any).mock.calls.at(-1)[0]
    expect(sent.basic_variance).toBeNull()
    expect(sent.basic_variance_reason).toBeNull()
  })

  it('without an ecoinvent variance the user must enter one, with a reason', async () => {
    ;(client.previewAuthoredExchange as any).mockResolvedValue(accepted('unfloored'))
    const { body } = renderEditor()
    await addFlow(body, 'u')
    const input = body.getByTestId('exchange-u-pedigree-basic-required') as HTMLInputElement
    expect(input.value).toBe('')
    expect(body.getByTestId('exchange-u-bv-reason')).toBeTruthy()
    fireEvent.change(input, { target: { value: '0.2' } })
    fireEvent.change(body.getByTestId('exchange-u-bv-reason'), { target: { value: 'Supplier range' } })
    await scoreAll(body, 'u')
    await waitFor(() => expect(client.previewAuthoredExchange).toHaveBeenCalled())
    const sent = (client.previewAuthoredExchange as any).mock.calls.at(-1)[0]
    expect(sent.basic_variance).toBe(0.2)
    expect(sent.basic_variance_reason).toBe('Supplier range')
  })

  it('a below-floor verdict asks for a reason and blocks saving until the preview accepts', async () => {
    ;(client.previewAuthoredExchange as any).mockResolvedValue({
      ok: false, exchange: null, codes: ['below_floor'],
      problems: ['GSD² 1.02 is below ecoinvent\'s median 1.93 for this flow; give a reason'],
    })
    const { body } = renderEditor()
    fireEvent.change(body.getByTestId('authored-name'), { target: { value: 'Boiler' } })
    fireEvent.click(body.getByTestId('scope-complete'))
    await addFlow(body, 's')
    expect(body.queryByTestId('exchange-s-floor-reason')).toBeNull()
    await scoreAll(body, 's', 1)
    await waitFor(() => body.getByTestId('exchange-s-floor-reason'))
    expect(body.getByTestId('exchange-s-problems').textContent).toContain('below ecoinvent')
    expect(body.getByTestId('authored-save')).toBeDisabled()
    expect(body.getByTestId('authored-blockers').textContent).toContain('accepted by the check')

    ;(client.previewAuthoredExchange as any).mockResolvedValue(
      accepted('below_floor_with_reason', { floor_reason: 'Stack measurement, n=40' }))
    fireEvent.change(body.getByTestId('exchange-s-floor-reason'), { target: { value: 'Stack measurement, n=40' } })
    await waitFor(() => body.getByTestId('exchange-s-below-floor'))
    const sent = (client.previewAuthoredExchange as any).mock.calls.at(-1)[0]
    expect(sent.floor_reason).toBe('Stack measurement, n=40')
    expect(body.getByTestId('authored-save')).not.toBeDisabled()
  })

  it('an unfloored exchange is marked on the row and on the activity', async () => {
    ;(client.previewAuthoredExchange as any).mockResolvedValue(accepted('unfloored'))
    const { body } = renderEditor()
    await addFlow(body, 's')
    await scoreAll(body, 's')
    await waitFor(() => body.getByTestId('exchange-s-unfloored'))
    expect(body.getByTestId('exchange-s-unfloored').textContent).toContain('Unfloored')
    expect(body.getByTestId('activity-unfloored')).toBeTruthy()
  })

  it('shows the problems the save refused with', async () => {
    ;(client.previewAuthoredExchange as any).mockResolvedValue(accepted('floored'))
    ;(client.addAuthoredActivity as any).mockRejectedValue(new HttpError(422, JSON.stringify({
      detail: { error: 'authored_invalid', problems: ['An activity named Boiler already exists'], codes: ['invalid'] },
    })))
    const { body, onSaved } = renderEditor()
    fireEvent.change(body.getByTestId('authored-name'), { target: { value: 'Boiler' } })
    fireEvent.click(body.getByTestId('scope-complete'))
    await addFlow(body, 's')
    await scoreAll(body, 's')
    await waitFor(() => expect(body.getByTestId('authored-save')).not.toBeDisabled())
    fireEvent.click(body.getByTestId('authored-save'))
    await waitFor(() => body.getByTestId('authored-save-problems'))
    expect(body.getByTestId('authored-save-problems').textContent).toContain('already exists')
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('editing keeps the activity code and sends the stored reasons back', async () => {
    ;(client.previewAuthoredExchange as any).mockResolvedValue(
      accepted('below_floor_with_reason', { floor_reason: 'Stack measurement' }))
    const stored: AuthoredActivity = {
      code: 'abc123', name: 'Boiler', reference_product: 'heat', unit: 'megajoule', location: 'DK',
      comment: '', scope: 'partial', scope_note: 'NOx only', has_unfloored_exchange: false,
      exchanges: [{
        ...accepted('below_floor_with_reason').exchange,
        pedigree: { 'reliability': 1, 'completeness': 1, 'temporal correlation': 1,
          'geographical correlation': 1, 'further technological correlation': 1 },
        floor_reason: 'Stack measurement',
      }],
    }
    ;(client.updateAuthoredActivity as any).mockResolvedValue(stored)
    const { body, onSaved } = renderEditor({ initial: stored })
    expect((body.getByTestId('authored-name') as HTMLInputElement).value).toBe('Boiler')
    expect((body.getByTestId('scope-note') as HTMLTextAreaElement).value).toBe('NOx only')
    expect((body.getByTestId('exchange-s-floor-reason') as HTMLTextAreaElement).value).toBe('Stack measurement')
    await waitFor(() => expect(body.getByTestId('authored-save')).not.toBeDisabled())
    fireEvent.click(body.getByTestId('authored-save'))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const [db, code, sent] = (client.updateAuthoredActivity as any).mock.calls[0]
    expect([db, code]).toEqual(['mine', 'abc123'])
    expect(sent.scope).toBe('partial')
    expect(sent.exchanges[0].floor_reason).toBe('Stack measurement')
    expect(client.addAuthoredActivity).not.toHaveBeenCalled()
  })
})
