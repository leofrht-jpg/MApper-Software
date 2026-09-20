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
    fetchReachedIndicators: vi.fn(),
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

const GWT = ['EF v3.1', 'climate change', 'global warming potential (GWP100)']
const POF = ['EF v3.1', 'photochemical oxidant formation: human health', 'tropospheric ozone concentration increase']
const REACHED = {
  families: ['EF v3.1', 'IPCC 2021'], default_family: 'EF v3.1',
  indicators: [
    { method: GWT, family: 'EF v3.1', label: 'climate change › global warming potential (GWP100)' },
    { method: POF, family: 'EF v3.1', label: 'photochemical oxidant formation: human health › tropospheric ozone concentration increase' },
    { method: ['IPCC 2021', 'climate change', 'GWP100'], family: 'IPCC 2021', label: 'climate change › GWP100' },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetPedigreeCache()
  ;(client.fetchReachedIndicators as any).mockResolvedValue(REACHED)
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


describe('per-indicator coverage declaration', () => {
  async function partialWithFlow(body: ReturnType<typeof within>) {
    ;(client.previewAuthoredExchange as any).mockResolvedValue(accepted('floored'))
    fireEvent.change(body.getByTestId('authored-name'), { target: { value: 'Flare' } })
    fireEvent.click(body.getByTestId('scope-partial'))
    fireEvent.change(body.getByTestId('scope-note'), { target: { value: 'CO2 and CH4 only' } })
    await addFlow(body, 's')
    await scoreAll(body, 's')
    await waitFor(() => body.getByTestId(`coverage-tick-${GWT.join('|')}`))
  }

  it('lists only the reached indicators, with nothing ticked', async () => {
    const { body } = renderEditor()
    await partialWithFlow(body)
    const gw = body.getByTestId(`coverage-tick-${GWT.join('|')}`) as HTMLInputElement
    const pof = body.getByTestId(`coverage-tick-${POF.join('|')}`) as HTMLInputElement
    expect(gw.checked).toBe(false)
    expect(pof.checked).toBe(false)
    // default family shown; the other family is behind the selector
    expect(body.queryByTestId('coverage-tick-IPCC 2021|climate change|GWP100')).toBeNull()
    expect(body.getByTestId('authored-coverage-summary').textContent).toContain('0 of 2')
    const sent = (client.fetchReachedIndicators as any).mock.calls.at(-1)[0]
    expect(sent).toEqual([{ database: 'biosphere3', code: 's' }])
  })

  it('sends exactly the ticked indicators on save', async () => {
    ;(client.addAuthoredActivity as any).mockResolvedValue({})
    const { body, onSaved } = renderEditor()
    await partialWithFlow(body)
    fireEvent.click(body.getByTestId(`coverage-tick-${GWT.join('|')}`))
    await waitFor(() => expect(body.getByTestId('authored-save')).not.toBeDisabled())
    fireEvent.click(body.getByTestId('authored-save'))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect((client.addAuthoredActivity as any).mock.calls[0][1].complete_indicators).toEqual([GWT])
  })

  it('a complete activity has no declaration step and sends no ticks', async () => {
    ;(client.previewAuthoredExchange as any).mockResolvedValue(accepted('floored'))
    ;(client.addAuthoredActivity as any).mockResolvedValue({})
    const { body, onSaved } = renderEditor()
    fireEvent.change(body.getByTestId('authored-name'), { target: { value: 'Leak' } })
    fireEvent.click(body.getByTestId('scope-complete'))
    await addFlow(body, 's')
    await scoreAll(body, 's')
    await waitFor(() => expect(body.getByTestId('authored-save')).not.toBeDisabled())
    expect(body.queryByTestId('authored-coverage-declaration')).toBeNull()
    fireEvent.click(body.getByTestId('authored-save'))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect((client.addAuthoredActivity as any).mock.calls[0][1].complete_indicators).toEqual([])
  })

  it('a tick no listed flow reaches any more blocks saving until unticked', async () => {
    ;(client.previewAuthoredExchange as any).mockResolvedValue(accepted('floored'))
    const stored: AuthoredActivity = {
      code: 'abc', name: 'Flare', reference_product: 'x', unit: 'kilogram', location: 'GLO', comment: '',
      scope: 'partial', scope_note: 'CO2 and CH4 only', has_unfloored_exchange: false,
      complete_indicators: [GWT, ['EF v3.1', 'water use', 'x']],
      exchanges: [{
        ...accepted('floored').exchange,
        pedigree: { 'reliability': 1, 'completeness': 1, 'temporal correlation': 1,
          'geographical correlation': 1, 'further technological correlation': 1 },
      }],
    }
    const { body } = renderEditor({ initial: stored })
    await waitFor(() => body.getByTestId('authored-coverage-stale'))
    expect((body.getByTestId(`coverage-tick-${GWT.join('|')}`) as HTMLInputElement).checked).toBe(true)
    expect(body.getByTestId('authored-blockers').textContent).toContain('no ticks on indicators no listed flow reaches')
    fireEvent.click(body.getByTestId('coverage-stale-EF v3.1|water use|x'))
    await waitFor(() => expect(body.queryByTestId('authored-coverage-stale')).toBeNull())
    await waitFor(() => expect(body.getByTestId('authored-save')).not.toBeDisabled())
  })
})

// The exemption from ecoinvent's floor. It has to be REACHABLE by someone
// entering a supplier's figure and UNATTRACTIVE to someone whose GSD² was
// merely called low -- so these tests check both directions.
describe('uncertainty basis', () => {
  it('defaults to ecoinvent, closed, and sends that', async () => {
    ;(client.previewAuthoredExchange as any).mockResolvedValue(accepted('floored'))
    const { body } = renderEditor()
    await addFlow(body, 's')
    const d = body.getByTestId('exchange-s-basis') as HTMLDetailsElement
    expect(d.open).toBe(false)
    expect(body.getByTestId('exchange-s-basis-summary').textContent).toContain("ecoinvent's spread")
    expect((body.getByTestId('exchange-s-basis-supplied') as HTMLInputElement).checked).toBe(false)
    // and the default path is untouched: ecoinvent's variance, read-only
    expect(body.getByTestId('exchange-s-pedigree-basic-derived').textContent).toBe('0.0800')
    await scoreAll(body, 's')
    await waitFor(() => expect(client.previewAuthoredExchange).toHaveBeenCalled())
    const sent = (client.previewAuthoredExchange as any).mock.calls.at(-1)[0]
    expect(sent.uncertainty_basis).toBe('ecoinvent')
    expect(sent.basic_variance).toBeNull()
  })

  it('choosing supplied asks for MORE than the default, not less', async () => {
    ;(client.previewAuthoredExchange as any).mockResolvedValue(accepted('floored'))
    const { body } = renderEditor()
    await addFlow(body, 's')
    await scoreAll(body, 's')
    await waitFor(() => body.getByTestId('exchange-s-floored'))
    expect(body.queryByTestId('exchange-s-bv-reason')).toBeNull()

    fireEvent.click(body.getByTestId('exchange-s-basis-supplied'))
    // ecoinvent's median is no longer offered: the author states the variance
    // AND where it came from, both of which the default did not ask for.
    expect(body.queryByTestId('exchange-s-pedigree-basic-derived')).toBeNull()
    expect(body.getByTestId('exchange-s-pedigree-basic-required')).toBeTruthy()
    expect(body.getByTestId('exchange-s-pedigree-basic-note').textContent).toContain('not used')
    const reason = body.getByTestId('exchange-s-bv-reason') as HTMLTextAreaElement
    expect(reason.placeholder).toContain('whose uncertainty this is')

    fireEvent.change(body.getByTestId('exchange-s-pedigree-basic-required'), { target: { value: '0.0083' } })
    fireEvent.change(reason, { target: { value: 'Supplier PCF: no uncertainty reported' } })
    await waitFor(() => {
      const sent = (client.previewAuthoredExchange as any).mock.calls.at(-1)[0]
      expect(sent.uncertainty_basis).toBe('supplied')
      expect(sent.basic_variance).toBe(0.0083)
      expect(sent.basic_variance_reason).toBe('Supplier PCF: no uncertainty reported')
    })
  })

  it('is not offered as the way out of a below-floor complaint', async () => {
    ;(client.previewAuthoredExchange as any).mockResolvedValue({
      ok: false, exchange: null, codes: ['below_floor'],
      problems: ['GSD² 1.02 is below ecoinvent\'s median 1.93 for this flow; give a reason'],
    })
    const { body } = renderEditor()
    await addFlow(body, 's')
    await scoreAll(body, 's', 1)
    await waitFor(() => body.getByTestId('exchange-s-floor-reason'))
    // The complaint points at a reason, never at the basis.
    const complaint = body.getByTestId('exchange-s-problems').textContent!.toLowerCase()
    expect(complaint).not.toContain('basis')
    expect(complaint).not.toContain('supplied')
    // And the exemption is still shut, still in the same place, still unticked:
    // a floor verdict changes nothing about it.
    expect((body.getByTestId('exchange-s-basis') as HTMLDetailsElement).open).toBe(false)
    expect((body.getByTestId('exchange-s-basis-supplied') as HTMLInputElement).checked).toBe(false)
    // Opened, it says so in words rather than reading as a remedy.
    expect(body.getByTestId('exchange-s-basis').textContent).toContain('leave this as it is')
  })

  it('drops a floor reason typed before the basis changed rather than sending it', async () => {
    ;(client.previewAuthoredExchange as any).mockResolvedValue(
      accepted('below_floor_with_reason', { floor_reason: 'Stack measurement' }))
    ;(client.previewAuthoredExchange as any).mockResolvedValueOnce({
      ok: false, exchange: null, codes: ['below_floor'], problems: ['below the median; give a reason'],
    })
    const { body } = renderEditor()
    await addFlow(body, 's')
    await scoreAll(body, 's', 1)
    await waitFor(() => body.getByTestId('exchange-s-floor-reason'))
    fireEvent.change(body.getByTestId('exchange-s-floor-reason'), { target: { value: 'Stack measurement' } })
    await waitFor(() => {
      expect((client.previewAuthoredExchange as any).mock.calls.at(-1)[0].floor_reason).toBe('Stack measurement')
    })
    fireEvent.click(body.getByTestId('exchange-s-basis-supplied'))
    // There is no floor here to be under, so there is no reason to store for
    // being under it -- the field goes, and so does the value.
    expect(body.queryByTestId('exchange-s-floor-reason')).toBeNull()
    await waitFor(() => {
      expect((client.previewAuthoredExchange as any).mock.calls.at(-1)[0].floor_reason).toBeNull()
    })
  })

  it('reads a supplied verdict as "no floor", not as unfloored', async () => {
    ;(client.previewAuthoredExchange as any).mockResolvedValue(accepted('not_applicable', {
      basic_variance: 0.0083, basic_variance_source: 'supplied', floor_gsd2: null,
      uncertainty_basis: 'supplied', gsd2: 1.23,
      floor_detail: 'uncertainty supplied by the data owner; ecoinvent\'s per-flow median does not apply',
    }))
    const { body } = renderEditor()
    await addFlow(body, 's')
    fireEvent.click(body.getByTestId('exchange-s-basis-supplied'))
    fireEvent.change(body.getByTestId('exchange-s-pedigree-basic-required'), { target: { value: '0.0083' } })
    fireEvent.change(body.getByTestId('exchange-s-bv-reason'), { target: { value: 'Supplier PCF' } })
    await scoreAll(body, 's')
    await waitFor(() => body.getByTestId('exchange-s-basis-not-applicable'))
    expect(body.getByTestId('exchange-s-basis-not-applicable').textContent).toContain('does not apply')
    // 'unfloored' means the check could not run and warns; this is neither.
    expect(body.queryByTestId('exchange-s-unfloored')).toBeNull()
    expect(body.queryByTestId('activity-unfloored')).toBeNull()
  })

  it('reopens a stored supplied exchange on its own basis', async () => {
    ;(client.previewAuthoredExchange as any).mockResolvedValue(accepted('not_applicable', {
      basic_variance: 0.0083, basic_variance_source: 'supplied', floor_gsd2: null, uncertainty_basis: 'supplied',
    }))
    const stored: AuthoredActivity = {
      code: 'pcf123', name: 'Polycarbonate', reference_product: 'polycarbonate', unit: 'kilogram',
      location: 'GLO', comment: '', scope: 'partial', scope_note: 'PCF only', has_unfloored_exchange: false,
      complete_indicators: [GWT],
      exchanges: [{
        ...accepted('not_applicable').exchange,
        pedigree: { 'reliability': 3, 'completeness': 2, 'temporal correlation': 1,
          'geographical correlation': 1, 'further technological correlation': 1 },
        basic_variance: 0.0083, basic_variance_source: 'supplied',
        basic_variance_detail: 'Supplier PCF: no uncertainty reported',
        floor_gsd2: null, floor_reason: null, uncertainty_basis: 'supplied',
      } as any],
    }
    const { body } = renderEditor({ initial: stored })
    expect((body.getByTestId('exchange-s-basis') as HTMLDetailsElement).open).toBe(true)
    expect((body.getByTestId('exchange-s-basis-supplied') as HTMLInputElement).checked).toBe(true)
    await waitFor(() => body.getByTestId('exchange-s-pedigree-basic-required'))
    expect((body.getByTestId('exchange-s-pedigree-basic-required') as HTMLInputElement).value).toBe('0.0083')
    expect((body.getByTestId('exchange-s-bv-reason') as HTMLTextAreaElement).value).toBe('Supplier PCF: no uncertainty reported')
    await waitFor(() => {
      expect((client.previewAuthoredExchange as any).mock.calls.at(-1)[0].uncertainty_basis).toBe('supplied')
    })
  })
})
