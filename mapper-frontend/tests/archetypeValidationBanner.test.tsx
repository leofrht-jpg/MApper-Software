/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/**
 * The banner "This archetype has N validation warning(s)", its "View report" panel and the tree icon
 * all follow the archetype the store holds, and every edit re-reads it from the backend (which now
 * refreshes the stored report: tests/test_bom_report_refresh.py). Real page, real store actions;
 * only the network is a stub.
 *
 * jsdom cannot show how the banner or the report look, or that the icon and the banner change
 * together on screen: it proves they are fed by the same refreshed object.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { Archetypes } from '../src/pages/Archetypes'
import { DialogHost, __resetDialogsForTests } from '../src/components/ui/dialogs'
import { useBOMStore } from '../src/stores/bomStore'
import type { Archetype, BOMNode, ValidationReport } from '../src/api/client'

const api = vi.hoisted(() => ({
  getArchetype: vi.fn(), updateBOMNode: vi.fn(), addBOMNode: vi.fn(), deleteBOMNode: vi.fn(),
}))
vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, ...api }
})

const clean = (n = 1): ValidationReport => ({ total_rows: n, valid_rows: n, error_rows: 0, warning_rows: 0, issues: [], groups: [] }) as ValidationReport
const warned = (value: string, row = 4): ValidationReport => ({
  total_rows: 1, valid_rows: 0, error_rows: 0, warning_rows: 1,
  issues: [{ severity: 'warning', error_type: 'waste_sign', archetype: 'Sedan', stage: 'Manufacturing', row_idx: row, name: 'Scrap', bad_value: value,
             message: `Row ${row} (Sedan, Manufacturing, Scrap), column 'Quantity' (${value}): positive on a waste treatment` }],
  groups: [{ severity: 'warning', error_type: 'waste_sign', bad_value: value, bom_name: '', count: 1,
             affected: [{ archetype: 'Sedan', stage: 'Manufacturing', row_idx: row, name: 'Scrap' }] }],
}) as ValidationReport

function arc(report: ValidationReport | null, qty: number, status: 'ok' | 'warning'): Archetype {
  const mat: BOMNode = {
    id: 'm1', name: 'Scrap', node_type: 'material', quantity: qty, unit: 'kg', children: [],
    validation_status: status, validation_message: status === 'warning' ? 'Row 4: positive on a waste treatment' : undefined,
    ecoinvent_activity: { database: 'fg', code: '2'.repeat(32), name: 'treatment of waste', location: 'GLO' },
  } as BOMNode
  return {
    id: 'a1', name: 'Sedan', folder: null, category: '', description: '', created_at: '', updated_at: '',
    bom: [{ id: 's1', name: 'Manufacturing', node_type: 'component', quantity: 1, unit: 'piece', scope: 'inflows', children: [mat] }],
    validation_report: report,
  } as unknown as Archetype
}

beforeEach(() => {
  __resetDialogsForTests()
  for (const f of Object.values(api)) f.mockReset()
  try { localStorage.clear() } catch { /* ignore */ }
  useBOMStore.setState({
    archetypes: [{ id: 'a1', name: 'Sedan', folder: null, category: '', description: '' }] as never,
    folders: [], active: arc(warned('0.5'), 0.5, 'warning'), isLoading: false, error: null,
    fetchArchetypes: vi.fn(async () => {}),
  } as never)
})
afterEach(() => { cleanup(); __resetDialogsForTests() })

const show = () => render(<><Archetypes /><DialogHost /></>)
const banner = () => screen.queryByText(/This archetype has \d+ validation warning/)

describe('the banner follows every edit that can change the report', () => {
  it('shows the warning the import left', () => {
    show()
    expect(banner()!.textContent).toBe('This archetype has 1 validation warning.')
  })

  it('an edit that clears the warning removes the banner (and its report) once the archetype is re-read', async () => {
    show()
    expect(banner()).not.toBeNull()
    api.updateBOMNode.mockResolvedValue({})
    api.getArchetype.mockResolvedValue(arc(clean(), -0.5, 'ok'))          // the backend's refreshed report
    await act(async () => { await useBOMStore.getState().patchNode('m1', { quantity: -0.5 }) })
    await waitFor(() => expect(banner()).toBeNull())
    expect(screen.queryByText('View report')).toBeNull()
    expect(api.getArchetype).toHaveBeenCalledWith('a1')                    // one re-read of the edited archetype only
  })

  it('the banner stays, with the new content, when the warning still applies', async () => {
    show()
    api.updateBOMNode.mockResolvedValue({})
    api.getArchetype.mockResolvedValue(arc(warned('0.7'), 0.7, 'warning'))
    await act(async () => { await useBOMStore.getState().patchNode('m1', { quantity: 0.7 }) })
    expect(banner()!.textContent).toBe('This archetype has 1 validation warning.')
    fireEvent.click(screen.getByText('View report'))
    expect(screen.getByTestId('validation-group-summary')).toHaveTextContent('Positive quantity on a waste treatment')
    fireEvent.click(screen.getByTestId('validation-group-details-toggle'))
    expect(screen.getByTestId('validation-group-message').textContent).toContain('(0.7)')
  })

  it('an edit that introduces a warning makes the banner appear', async () => {
    useBOMStore.setState({ active: arc(clean(), -0.5, 'ok') } as never)
    show()
    expect(banner()).toBeNull()
    api.updateBOMNode.mockResolvedValue({})
    api.getArchetype.mockResolvedValue(arc(warned('0.5'), 0.5, 'warning'))
    await act(async () => { await useBOMStore.getState().patchNode('m1', { quantity: 0.5 }) })
    expect(banner()!.textContent).toBe('This archetype has 1 validation warning.')
  })

  it('deleting the warned row and adding a warned row update the banner from the archetype the backend returns', async () => {
    show()
    api.deleteBOMNode.mockResolvedValue(arc(clean(0), 0.5, 'ok'))
    await act(async () => { await useBOMStore.getState().removeNode('m1') })
    expect(banner()).toBeNull()
    api.addBOMNode.mockResolvedValue(arc(warned('0.5', 7), 0.5, 'warning'))
    await act(async () => { await useBOMStore.getState().addNode('s1', { name: 'Scrap', node_type: 'material', quantity: 0.5, unit: 'kg' } as never) })
    expect(banner()).not.toBeNull()
  })
})
