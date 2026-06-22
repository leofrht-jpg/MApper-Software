/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { ScenarioYearPicker, type ScenarioGroup } from '../src/components/impact/ScenarioYearPicker'

// Patch 5Z — shared grouped scenario-year picker (extracted from the single-item
// LCI scenarios picker; reused by the multi-item ActivityVintagePicker). Lock:
// grouping, per-group ALL YEARS / CLEAR scoped to that group, disabled years.

const GROUPS: ScenarioGroup[] = [
  { key: 'ei|remind|SSP1-PkBudg1150', label: 'remind · SSP1-PkBudg1150', years: [
    { id: 's1-2030', year: 2030 }, { id: 's1-2040', year: 2040 },
  ] },
  { key: 'ei|remind|SSP2', label: 'remind · SSP2', years: [
    { id: 's2-2030', year: 2030 }, { id: 's2-2040', year: 2040 },
  ] },
]

beforeEach(() => {
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
})

function renderPicker(selected: Set<string>, handlers: any = {}) {
  return render(
    <ScenarioYearPicker
      groups={GROUPS}
      selected={selected}
      onToggleYear={handlers.onToggleYear ?? vi.fn()}
      onSetGroup={handlers.onSetGroup ?? vi.fn()}
      testIds={{
        allYears: (k) => `all-${k}`, clear: (k) => `clear-${k}`,
        yearItem: (id) => `yr-${id}`, groupHeader: (k) => `hdr-${k}`,
      }}
    />,
  )
}

describe('ScenarioYearPicker (Patch 5Z)', () => {
  it('renders one group per scenario with its full label and year checkboxes', () => {
    const { getByTestId } = renderPicker(new Set())
    expect(getByTestId('hdr-ei|remind|SSP1-PkBudg1150').textContent).toBe('remind · SSP1-PkBudg1150')
    expect(getByTestId('yr-s1-2030')).toBeInTheDocument()
    expect(getByTestId('yr-s1-2040')).toBeInTheDocument()
    expect(getByTestId('yr-s2-2030')).toBeInTheDocument()
  })

  it('ALL YEARS selects every year in THAT group only', () => {
    const onSetGroup = vi.fn()
    const { getByTestId } = renderPicker(new Set(), { onSetGroup })
    fireEvent.click(getByTestId('all-ei|remind|SSP1-PkBudg1150'))
    expect(onSetGroup).toHaveBeenCalledWith(['s1-2030', 's1-2040'], true)  // only group 1's ids
  })

  it('CLEAR deselects only that group', () => {
    const onSetGroup = vi.fn()
    const { getByTestId } = renderPicker(new Set(['s2-2030', 's2-2040']), { onSetGroup })
    fireEvent.click(getByTestId('clear-ei|remind|SSP2'))
    expect(onSetGroup).toHaveBeenCalledWith(['s2-2030', 's2-2040'], false)
  })

  it('toggling a year checkbox calls onToggleYear with the explicit on-state', () => {
    const onToggleYear = vi.fn()
    const { getByTestId } = renderPicker(new Set(), { onToggleYear })
    fireEvent.click(getByTestId('yr-s1-2040'))
    expect(onToggleYear).toHaveBeenCalledWith('s1-2040', true)
  })

  it('disabled years cannot be toggled and are excluded from ALL YEARS', () => {
    const onToggleYear = vi.fn()
    const onSetGroup = vi.fn()
    const groups: ScenarioGroup[] = [{
      key: 'g', label: 'remind · SSP2', years: [
        { id: 'a', year: 2030 }, { id: 'sup', year: null, disabled: true, title: 'super' },
      ],
    }]
    const { getByTestId } = render(
      <ScenarioYearPicker groups={groups} selected={new Set()} onToggleYear={onToggleYear} onSetGroup={onSetGroup}
        testIds={{ allYears: (k) => `all-${k}`, yearItem: (id) => `yr-${id}` }} />,
    )
    expect((getByTestId('yr-sup') as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(getByTestId('yr-sup'))
    expect(onToggleYear).not.toHaveBeenCalled()
    // ALL YEARS only batches the selectable (non-disabled) ids.
    fireEvent.click(getByTestId('all-g'))
    expect(onSetGroup).toHaveBeenCalledWith(['a'], true)
  })
})
