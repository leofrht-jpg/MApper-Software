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
import { FilterDropdown } from '../src/components/ui/FilterDropdown'

// Patch 5Y — parity with Patch 5T: Database Explorer's MultiSelectDropdown
// gets the same threshold-gated, view-only option search via the shared
// useOptionSearch hook. Mirrors 5T's six FilterDropdown tests.

const MANY = ['AE', 'AL', 'AM', 'AO', 'AR', 'AT', 'AU', 'CH', 'DE', 'DK', 'FR', 'IT'] // 12 > 8
const FEW = ['kWh', 'm3']
const LOC = 'db-location-filter'
const UNIT = 'db-unit-filter'

beforeEach(() => {
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
})

function renderLocation(onChange = vi.fn(), selected: string[] = []) {
  const r = render(
    <FilterDropdown label="Location" testId={LOC} options={MANY} selected={selected} onChange={onChange} />,
  )
  fireEvent.click(r.container.querySelector(`[data-testid="${LOC}-toggle"]`)!)  // open
  return r
}

describe('Database Explorer FilterDropdown (Database Explorer) — option search (Patch 5Y)', () => {
  it('typing filters the visible options (case-insensitive); clearing restores all', () => {
    const { container } = renderLocation()
    const search = container.querySelector(`[data-testid="${LOC}-search"]`) as HTMLInputElement
    expect(search).not.toBeNull()
    fireEvent.change(search, { target: { value: 'd' } })
    expect(container.querySelector(`[data-testid="${LOC}-option-DK"]`)).not.toBeNull()
    expect(container.querySelector(`[data-testid="${LOC}-option-DE"]`)).not.toBeNull()
    expect(container.querySelector(`[data-testid="${LOC}-option-FR"]`)).toBeNull()
    fireEvent.change(search, { target: { value: '' } })
    expect(container.querySelector(`[data-testid="${LOC}-option-FR"]`)).not.toBeNull()
  })

  it('a selected option stays selected when filtered out and after clear; typing fires no onChange', () => {
    const onChange = vi.fn()
    const { container } = renderLocation(onChange, ['DK'])
    expect((container.querySelector(`[data-testid="${LOC}-option-DK"]`) as HTMLElement)).not.toBeNull()
    const search = container.querySelector(`[data-testid="${LOC}-search"]`) as HTMLInputElement
    fireEvent.change(search, { target: { value: 'fr' } })
    expect(container.querySelector(`[data-testid="${LOC}-option-DK"]`)).toBeNull()  // out of view
    expect(onChange).not.toHaveBeenCalled()  // search never touches the selection
    fireEvent.change(search, { target: { value: '' } })
    // DK reappears; still in the selected set (controlled — onChange would have
    // been the only way to drop it, and it wasn't called).
    expect(container.querySelector(`[data-testid="${LOC}-option-DK"]`)).not.toBeNull()
  })

  it('search input hidden when options ≤ threshold (Unit=2), shown when > threshold (Location=12)', () => {
    const u = render(<FilterDropdown label="Unit" testId={UNIT} options={FEW} selected={[]} onChange={vi.fn()} />)
    fireEvent.click(u.container.querySelector(`[data-testid="${UNIT}-toggle"]`)!)
    expect(u.container.querySelector(`[data-testid="${UNIT}-search"]`)).toBeNull()
    const { container } = renderLocation()
    expect(container.querySelector(`[data-testid="${LOC}-search"]`)).not.toBeNull()
  })

  it('renders "No matches" when nothing matches', () => {
    const { container } = renderLocation()
    const search = container.querySelector(`[data-testid="${LOC}-search"]`) as HTMLInputElement
    fireEvent.change(search, { target: { value: 'zzzz' } })
    expect(container.querySelector(`[data-testid="${LOC}-no-matches"]`)).not.toBeNull()
    expect(container.querySelector(`[data-testid="${LOC}-option-DK"]`)).toBeNull()
  })

  it('autofocuses the search on open and resets the text on close (fresh each open)', () => {
    const { container } = renderLocation()
    const search = container.querySelector(`[data-testid="${LOC}-search"]`) as HTMLInputElement
    expect(document.activeElement).toBe(search)
    fireEvent.change(search, { target: { value: 'dk' } })
    const toggle = container.querySelector(`[data-testid="${LOC}-toggle"]`)!
    fireEvent.click(toggle)  // close
    fireEvent.click(toggle)  // reopen
    const reopened = container.querySelector(`[data-testid="${LOC}-search"]`) as HTMLInputElement
    expect(reopened.value).toBe('')
  })

  it('regression: selecting an option still fires onChange (search is view-only, not selection)', () => {
    const onChange = vi.fn()
    const { container } = renderLocation(onChange)
    const search = container.querySelector(`[data-testid="${LOC}-search"]`) as HTMLInputElement
    fireEvent.change(search, { target: { value: 'dk' } })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(container.querySelector(`[data-testid="${LOC}-option-DK"]`) as HTMLElement)
    expect(onChange).toHaveBeenCalledWith(['DK'])
  })
})
