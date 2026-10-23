// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

/**
 * Method Library uninstall through the in-app dialog.
 *
 * Uninstall asked window.confirm, which answers false in the packaged
 * WKWebView, so a method could never be uninstalled there. The Method Library
 * is itself a modal that closes on Escape; Escape in the confirmation must
 * cancel the uninstall without also closing the library.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { MethodLibrary } from '../src/components/impact/MethodLibrary'
import { DialogHost, __resetDialogsForTests } from '../src/components/ui/dialogs'
import * as client from '../src/api/client'

const METHOD: client.LCIAMethodInfo = {
  id: 'iw', name: 'IMPACT World+ 2.2.1', description: 'IW+', long_description: null,
  source: 'downloadable', installed: true, category_count: 30, size_mb: 12,
  source_url: null, citation: null, installer: 'bw2package', notes: null,
  detected_ei_version: '3.10', available_variants: ['3.10'], unit: null,
}

let uninstall: ReturnType<typeof vi.spyOn>
let getLibrary: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  __resetDialogsForTests()
  getLibrary = vi.spyOn(client, 'getLcaMethodLibrary').mockResolvedValue({
    detected_ecoinvent_version: '3.10', supported_ecoinvent_versions: ['3.10'], methods: [METHOD],
  })
  uninstall = vi.spyOn(client, 'uninstallLcaMethod').mockResolvedValue(undefined as never)
})
afterEach(() => { cleanup(); __resetDialogsForTests(); vi.restoreAllMocks() })

const click = async (el: Element) => { await act(async () => { fireEvent.click(el) }) }

async function openUninstall() {
  const onClose = vi.fn()
  render(<><MethodLibrary onClose={onClose} /><DialogHost /></>)
  const btn = await screen.findByRole('button', { name: /Uninstall/ })
  await click(btn)
  return onClose
}

describe('uninstall a method', () => {
  it('asks in-app, and Uninstall removes it and reloads the library', async () => {
    await openUninstall()
    expect(screen.getByRole('alertdialog')).toHaveAccessibleName('Uninstall IMPACT World+ 2.2.1?')
    expect(uninstall).not.toHaveBeenCalled()
    const loadsBefore = getLibrary.mock.calls.length
    await click(screen.getByTestId('dialog-confirm'))
    expect(uninstall).toHaveBeenCalledWith('iw')
    await waitFor(() => expect(getLibrary.mock.calls.length).toBeGreaterThan(loadsBefore))
  })

  it('Cancel keeps it', async () => {
    await openUninstall()
    await click(screen.getByTestId('dialog-cancel'))
    expect(screen.queryByTestId('dialog')).toBeNull()
    expect(uninstall).not.toHaveBeenCalled()
  })

  it('Escape cancels the uninstall and leaves the library open', async () => {
    const onClose = await openUninstall()
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'Escape' }) })
    expect(screen.queryByTestId('dialog')).toBeNull()
    expect(uninstall).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a failed uninstall shows its error in the library (not a native alert)', async () => {
    uninstall.mockRejectedValue(new Error('method locked'))
    await openUninstall()
    await click(screen.getByTestId('dialog-confirm'))
    expect(await screen.findByText('method locked')).toBeInTheDocument()
  })
})
