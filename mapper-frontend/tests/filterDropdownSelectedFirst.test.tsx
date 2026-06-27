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
import { FilterDropdown, partitionSelectedFirst } from '../src/components/ui/FilterDropdown'

// Selected-first grouping in the canonical checkbox-list dropdown (app-wide:
// every FilterDropdown consumer — MultiItemSelector Location/Unit/Folder +
// Database Explorer — inherits this). Checked items float to a labelled group
// at the top, ABOVE the existing sort, preserving that sort within each group;
// live-updates on toggle.

const OPTS = ['AE', 'AL', 'AM', 'AO', 'AR', 'AT', 'AU', 'DE', 'DK', 'FR']  // sorted A→Z, > threshold
const T = 'f'

beforeEach(() => {
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
})

// DOM order of the rendered option values (selected group, then divider, then rest).
function optionOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(`[data-testid^="${T}-option-"]`))
    .map((el) => el.getAttribute('data-testid')!.replace(`${T}-option-`, ''))
}

function open(selected: string[], onChange = vi.fn()) {
  const r = render(<FilterDropdown label="Location" testId={T} options={OPTS} selected={selected} onChange={onChange} />)
  fireEvent.click(r.container.querySelector(`[data-testid="${T}-toggle"]`)!)
  return { ...r, onChange }
}

describe('partitionSelectedFirst (pure)', () => {
  it('puts selected first, preserving incoming order WITHIN each group', () => {
    // visible already sorted A→Z; selected = AT, DK (out of order on purpose)
    const { selectedGroup, restGroup } = partitionSelectedFirst(OPTS, ['DK', 'AT'])
    expect(selectedGroup).toEqual(['AT', 'DK'])         // sort preserved inside the selected group
    expect(restGroup).toEqual(['AE', 'AL', 'AM', 'AO', 'AR', 'AU', 'DE', 'FR'])
  })

  it('selected-first takes priority over the underlying sort', () => {
    // FR sorts last A→Z but, selected, must lead.
    const { selectedGroup } = partitionSelectedFirst(OPTS, ['FR'])
    expect(selectedGroup[0]).toBe('FR')
  })

  it('groups correctly within a search-narrowed subset', () => {
    const visible = OPTS.filter((o) => o.toLowerCase().includes('a'))  // AE,AL,AM,AO,AR,AT,AU
    const { selectedGroup, restGroup } = partitionSelectedFirst(visible, ['AT', 'DK'])
    expect(selectedGroup).toEqual(['AT'])               // DK not in the visible subset → ignored
    expect(restGroup).toEqual(['AE', 'AL', 'AM', 'AO', 'AR', 'AU'])
  })

  it('all-unique / none-selected → everything in restGroup', () => {
    expect(partitionSelectedFirst(OPTS, []).selectedGroup).toEqual([])
    expect(partitionSelectedFirst(OPTS, []).restGroup).toEqual(OPTS)
  })
})

describe('FilterDropdown — selected-first rendering', () => {
  it('renders selected options before unselected in DOM order', () => {
    const { container } = open(['AT', 'DK'])
    const order = optionOrder(container)
    expect(order.slice(0, 2)).toEqual(['AT', 'DK'])     // selected group leads
    // The rest keep A→Z.
    expect(order.slice(2)).toEqual(['AE', 'AL', 'AM', 'AO', 'AR', 'AU', 'DE', 'FR'])
  })

  it('shows a "Selected (N)" label and a group divider when both groups exist', () => {
    const { container } = open(['DK'])
    expect(container.querySelector(`[data-testid="${T}-selected-label"]`)?.textContent).toContain('Selected (1)')
    expect(container.querySelector(`[data-testid="${T}-group-divider"]`)).not.toBeNull()
  })

  it('no divider/label when nothing is selected', () => {
    const { container } = open([])
    expect(container.querySelector(`[data-testid="${T}-selected-label"]`)).toBeNull()
    expect(container.querySelector(`[data-testid="${T}-group-divider"]`)).toBeNull()
  })

  it('live re-sorts when the selection prop changes (no close/reopen)', () => {
    const { container, rerender } = open(['FR'])
    expect(optionOrder(container)[0]).toBe('FR')
    // Simulate the parent applying a new selection while the menu stays open.
    rerender(<FilterDropdown label="Location" testId={T} options={OPTS} selected={['FR', 'AE']} onChange={vi.fn()} />)
    expect(optionOrder(container).slice(0, 2)).toEqual(['AE', 'FR'])  // both lead, A→Z within group
  })

  it('groups within the search-filtered subset', () => {
    const { container } = open(['AT'])
    fireEvent.change(container.querySelector(`[data-testid="${T}-search"]`)!, { target: { value: 'a' } })
    const order = optionOrder(container)
    expect(order[0]).toBe('AT')                          // selected leads the filtered subset
    expect(order).not.toContain('DK')                    // filtered out
  })

  it('resets the listbox scroll to top on toggle (no mid-jump reflow)', () => {
    const onChange = vi.fn()
    const { container } = open(['DK'], onChange)
    const list = container.querySelector(`[data-testid="${T}-list"]`) as HTMLElement
    list.scrollTop = 120
    fireEvent.click(container.querySelector(`[data-testid="${T}-option-AE"]`)!)
    expect(list.scrollTop).toBe(0)
    expect(onChange).toHaveBeenCalled()                  // selection still toggled
  })
})
