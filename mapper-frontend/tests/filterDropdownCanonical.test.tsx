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

// Patch 5AB — canonical shared FilterDropdown. Locks the unified features added
// when consolidating MultiItemSelector's FilterDropdown + Database Explorer's
// MultiSelectDropdown: count summary "Label (N)", Select all / Clear (on ALL
// filters), disabled, and the testid scheme. Search/threshold/selection-preserve
// are covered by the IA + DB Explorer suites.

const OPTS = ['AE', 'AL', 'AM', 'AO', 'AR', 'AT', 'AU', 'DE', 'DK', 'FR']  // 10 > threshold
const T = 'f'

beforeEach(() => {
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
})

function open(selected: string[] = [], onChange = vi.fn(), extra: any = {}) {
  const r = render(<FilterDropdown label="Location" testId={T} options={OPTS} selected={selected} onChange={onChange} {...extra} />)
  const toggle = r.container.querySelector(`[data-testid="${T}-toggle"]`) as HTMLButtonElement
  if (!toggle.disabled) fireEvent.click(toggle)
  return { ...r, toggle, onChange }
}

describe('Canonical FilterDropdown (Patch 5AB)', () => {
  it('trigger uses the count summary "Label (N)"', () => {
    const { toggle } = open(['DK', 'FR'])
    expect(toggle.textContent).toContain('Location (2)')
  })

  it('trigger shows just the label when nothing is selected', () => {
    const { toggle } = open([])
    expect(toggle.textContent).toContain('Location')
    expect(toggle.textContent).not.toMatch(/\(\d+\)/)
  })

  it('Select all selects every option; Clear deselects all', () => {
    const onChange = vi.fn()
    const { container } = open([], onChange)
    fireEvent.click(container.querySelector(`[data-testid="${T}-select-all"]`)!)
    expect(onChange).toHaveBeenCalledWith(OPTS)  // full option set, not the search-visible subset
  })

  it('Clear deselects all; disabled when nothing is selected', () => {
    const onChange = vi.fn()
    const { container } = open(['DK'], onChange)
    const clear = container.querySelector(`[data-testid="${T}-clear"]`) as HTMLButtonElement
    expect(clear.disabled).toBe(false)
    fireEvent.click(clear)
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('Select all is disabled once everything is selected', () => {
    const { container } = open([...OPTS])
    expect((container.querySelector(`[data-testid="${T}-select-all"]`) as HTMLButtonElement).disabled).toBe(true)
  })

  it('disabled prop blocks opening the menu', () => {
    const { container, toggle } = open([], vi.fn(), { disabled: true })
    expect(toggle.disabled).toBe(true)
    expect(container.querySelector(`[data-testid="${T}-menu"]`)).toBeNull()
  })
})
