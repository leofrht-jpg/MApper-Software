/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ImportWizard } from '../src/components/ImportWizard'
import { Button } from '../src/components/ui/Button'

/**
 * A primary button that cannot act must LOOK disabled. `Button` had no disabled styling at all,
 * so Continue looked active after a failed Verify and did nothing when clicked.
 *
 * jsdom cannot show the colour or the cursor the user sees (no layout, no real :hover). It
 * proves the `disabled` attribute and the inline style the primitive sets.
 */
const mocks = vi.hoisted(() => ({ browse: vi.fn() }))

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, browseEcoinventFolder: mocks.browse }
})
vi.mock('../src/stores/projectStore', () => ({ useProjectStore: () => ({ fetchDatabases: vi.fn() }) }))

const NOT_FOUND = "No .spold files found. Point to the 'datasets' folder inside the extracted ecospold archive."

beforeEach(() => mocks.browse.mockReset())
afterEach(() => cleanup())

const isDisabledLook = (el: HTMLElement) => (el as HTMLButtonElement).disabled && el.style.opacity === '0.5' && el.style.cursor === 'not-allowed'
const isEnabledLook = (el: HTMLElement) => !(el as HTMLButtonElement).disabled && el.style.opacity === '' && el.style.cursor === 'pointer'

function openLocal() {
  render(<ImportWizard onClose={() => {}} />)
  fireEvent.click(screen.getAllByText('Import from local files')[0])
}
const path = (v: string) => fireEvent.change(screen.getByPlaceholderText(/datasets$/), { target: { value: v } })
const verify = async () => { await act(async () => { fireEvent.click(screen.getByText('Verify')) }) }
const cont = () => screen.getByText('Continue').closest('button') as HTMLButtonElement

describe('Button', () => {
  it('has the standard disabled look, and none when enabled', () => {
    render(<><Button disabled>Off</Button><Button>On</Button></>)
    expect(isDisabledLook(screen.getByText('Off'))).toBe(true)
    expect(isEnabledLook(screen.getByText('On'))).toBe(true)
  })
})

describe('ImportWizard step 1 (local folder): Continue', () => {
  it('is disabled before any verification', () => {
    openLocal()
    expect(isDisabledLook(cont())).toBe(true)
    path('/x/datasets')
    expect(isDisabledLook(cont())).toBe(true)
  })

  it('stays disabled after a failed verification, with the message shown', async () => {
    mocks.browse.mockResolvedValue({ valid: false, spold_count: 0, path: '/x/datasets', message: NOT_FOUND })
    openLocal()
    path('/x/datasets')
    await verify()
    expect(screen.getByText(NOT_FOUND)).toBeInTheDocument()
    expect(isDisabledLook(cont())).toBe(true)
    fireEvent.click(cont())
    expect(screen.queryByText('Database name')).toBeNull()       // clicking it goes nowhere
  })

  it('is enabled after a successful verification, and goes to step 2', async () => {
    mocks.browse.mockResolvedValue({ valid: true, spold_count: 3, path: '/x/datasets', message: 'ok' })
    openLocal()
    path('/x/datasets')
    await verify()
    expect(isEnabledLook(cont())).toBe(true)
    fireEvent.click(cont())
    expect(screen.getByText('Database name')).toBeInTheDocument()
  })

  it('is disabled again as soon as the path text changes', async () => {
    mocks.browse.mockResolvedValue({ valid: true, spold_count: 3, path: '/x/datasets', message: 'ok' })
    openLocal()
    path('/x/datasets')
    await verify()
    expect(isEnabledLook(cont())).toBe(true)
    path('/x/datasets2')
    expect(isDisabledLook(cont())).toBe(true)
  })
})

describe('the other primary buttons of the wizard', () => {
  it('"Validate & Continue" looks disabled until both credentials are typed', () => {
    render(<ImportWizard onClose={() => {}} />)
    fireEvent.click(screen.getAllByText('Log in with ecoinvent account')[0])
    const btn = () => screen.getByText('Validate & Continue').closest('button') as HTMLButtonElement
    expect(isDisabledLook(btn())).toBe(true)
    const [user, pass] = Array.from(document.querySelectorAll('input'))
    fireEvent.change(user, { target: { value: 'u' } })
    expect(isDisabledLook(btn())).toBe(true)
    fireEvent.change(pass, { target: { value: 'p' } })
    expect(isEnabledLook(btn())).toBe(true)
  })

  it('"Import N datasets" (step 2) looks disabled while the database name is empty', async () => {
    mocks.browse.mockResolvedValue({ valid: true, spold_count: 3, path: '/x/datasets', message: 'ok' })
    openLocal()
    path('/x/datasets')
    await verify()
    fireEvent.click(cont())
    const btn = () => screen.getByText(/^Import 3 datasets$/).closest('button') as HTMLButtonElement
    expect(isEnabledLook(btn())).toBe(true)
    fireEvent.change(screen.getByPlaceholderText('ecoinvent-3.10-cutoff'), { target: { value: '  ' } })
    expect(isDisabledLook(btn())).toBe(true)
  })
})
