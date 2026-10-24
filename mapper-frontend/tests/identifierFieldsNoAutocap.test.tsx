// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

/**
 * Identifier fields do not auto-capitalise, autocorrect or spell-check.
 *
 * macOS capitalised the first letter of every new parameter name, which the
 * lowercase rule then refused. Rendered checks for the Add parameter field and
 * for promptDialog (identifier by default, prose on request); a source check
 * for the remaining identifier inputs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'

import { ParameterManagerPanel } from '../src/components/parameters/ParameterManagerPanel'
import { DialogHost, __resetDialogsForTests, promptDialog } from '../src/components/ui/dialogs'
import { useParameterStore } from '../src/stores/parameterStore'

function expectIdentifier(el: HTMLElement) {
  expect(el.getAttribute('autocapitalize')).toBe('off')
  expect(el.getAttribute('autocorrect')).toBe('off')
  expect(el.getAttribute('spellcheck')).toBe('false')
}

beforeEach(() => {
  __resetDialogsForTests()
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  try { localStorage.setItem('mapper.param-panel-open', '1') } catch { /* ignore */ }
  useParameterStore.setState({
    table: { parameters: { mass: { name: 'mass', base_value: 1, category: null, scenario_overrides: {} } }, scenarios: [], categories: [] },
    isSaving: false, error: null, fetchTable: vi.fn(async () => {}),
  } as never)
})
afterEach(() => { cleanup(); __resetDialogsForTests(); vi.unstubAllGlobals() })

describe('rendered identifier fields', () => {
  it('the Add parameter Name field', async () => {
    render(<><ParameterManagerPanel /><DialogHost /></>)
    await act(async () => { fireEvent.click(screen.getAllByText('Add parameter')[0].closest('button')!) })
    expectIdentifier(document.querySelector('input[placeholder="e.g. battery_mass_lfp"]') as HTMLElement)
  })

  it('promptDialog is an identifier field by default', async () => {
    render(<DialogHost />)
    act(() => { void promptDialog({ title: 'New sensitivity case', label: 'Case name' }) })
    expectIdentifier(screen.getByTestId('dialog-input'))
  })

  it('promptDialog with freeText allows normal text', async () => {
    render(<DialogHost />)
    act(() => { void promptDialog({ title: 'Note', freeText: true }) })
    const input = screen.getByTestId('dialog-input')
    expect(input.getAttribute('autocapitalize')).toBeNull()
    expect(input.getAttribute('spellcheck')).toBeNull()
  })
})

describe('other identifier inputs spread IDENTIFIER_INPUT_PROPS', () => {
  const SRC = path.resolve(__dirname, '../src')
  it.each([
    ['components/parameters/ParameterManagerPanel.tsx', 3],  // case rename, parameter rename, Add parameter name
    ['components/aesa/PrinciplesEditor.tsx', 1],             // principle id
    ['components/dsm/ScenarioManagerModal.tsx', 1],          // scenario rename
    ['components/dsm/DimensionsEditor.tsx', 1],              // machine name
    ['pages/Archetypes.tsx', 2],                             // folder rename, folder path
    ['components/authored/AuthoredDatabaseControls.tsx', 1], // authored database name
  ])('%s', (rel, n) => {
    const src = fs.readFileSync(path.join(SRC, rel), 'utf8')
    expect((src.match(/<input \{\.\.\.IDENTIFIER_INPUT_PROPS\}/g) ?? []).length).toBe(n)
  })
})
