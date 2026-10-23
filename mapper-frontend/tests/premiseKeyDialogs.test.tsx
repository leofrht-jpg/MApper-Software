// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

/**
 * Removing the premise key through the in-app dialog.
 *
 * PremiseKeyManager is mounted in two places: Settings (variant "panel") and
 * the pLCA Developer page (variant "banner"). Remove asked window.confirm,
 * which answers false in the packaged WKWebView, so the key could never be
 * removed. The confirmation lives in the shared handler, so it works from
 * wherever the component is mounted; the Remove button itself is only offered
 * by the panel variant (the banner shows only while no key is configured).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

import { PremiseKeyManager } from '../src/components/PremiseKeyManager'
import { SettingsPage } from '../src/pages/SettingsPage'
import { PLCADeveloper } from '../src/pages/PLCADeveloper'
import { DialogHost, __resetDialogsForTests } from '../src/components/ui/dialogs'
import { usePLCAStore } from '../src/stores/plcaStore'
import { useProjectStore } from '../src/stores/projectStore'
import * as client from '../src/api/client'

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return {
    ...actual,
    getHealth: vi.fn(async () => ({ status: 'ok' })),
    getPremiseKeyStatus: vi.fn(async () => ({ configured: true, path: '~/.premise/premise_key' })),
    deletePremiseKey: vi.fn(async () => ({})),
    getGridIntensities: vi.fn(async () => []),
    getSystemLogs: vi.fn(async () => ({ lines: [], log_path: '' })),
  }
})

beforeEach(() => {
  __resetDialogsForTests()
  vi.mocked(client.deletePremiseKey).mockReset().mockResolvedValue({} as never)
  vi.mocked(client.getPremiseKeyStatus).mockReset()
    .mockResolvedValue({ configured: true, path: '~/.premise/premise_key' } as never)
  // @ts-expect-error minimal stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
})
afterEach(() => { cleanup(); __resetDialogsForTests() })

const click = async (el: Element) => { await act(async () => { fireEvent.click(el) }) }

describe('Remove key from Settings', () => {
  const openRemove = async () => {
    render(<><SettingsPage /><DialogHost /></>)
    await click(await screen.findByRole('button', { name: /Remove key/ }))
  }

  it('asks in-app, and Remove deletes the key', async () => {
    await openRemove()
    expect(screen.getByRole('alertdialog')).toHaveAccessibleName('Remove the saved premise key?')
    expect(client.deletePremiseKey).not.toHaveBeenCalled()
    await click(screen.getByTestId('dialog-confirm'))
    expect(client.deletePremiseKey).toHaveBeenCalledTimes(1)
  })

  it('Cancel keeps the key', async () => {
    await openRemove()
    await click(screen.getByTestId('dialog-cancel'))
    expect(screen.queryByTestId('dialog')).toBeNull()
    expect(client.deletePremiseKey).not.toHaveBeenCalled()
  })

  it('a failed removal shows its error in the panel (not a native alert)', async () => {
    vi.mocked(client.deletePremiseKey).mockRejectedValue(new Error('permission denied'))
    await openRemove()
    await click(screen.getByTestId('dialog-confirm'))
    expect(await screen.findByText('permission denied')).toBeInTheDocument()
  })
})

describe('the pLCA Developer mount', () => {
  it('mounts the same component (banner variant) and opens no native dialog', async () => {
    vi.mocked(client.getPremiseKeyStatus).mockResolvedValue({ configured: false, path: '' } as never)
    useProjectStore.setState({ databases: [], currentProject: 'p' } as never)
    usePLCAStore.setState({
      databases: [], isLoading: false, error: null,
      scenarios: { key_configured: false, iams: [], ssps: [], ssps_by_iam: {}, years: [] },
      fetchScenarios: vi.fn(async () => {}), fetchDatabases: vi.fn(async () => {}),
    } as never)
    render(<><PLCADeveloper /><DialogHost /></>)
    expect(await screen.findByText('Premise key not configured')).toBeInTheDocument()
  })

  it('the shared Remove handler confirms in-app in any mount (component level)', async () => {
    render(<><PremiseKeyManager variant="panel" /><DialogHost /></>)
    await click(await screen.findByRole('button', { name: /Remove key/ }))
    await click(screen.getByTestId('dialog-confirm'))
    expect(client.deletePremiseKey).toHaveBeenCalledTimes(1)
  })
})
