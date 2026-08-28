/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent, waitFor } from '@testing-library/react'
import { ProjectSwitcher } from '../src/components/ProjectSwitcher'
import { useProjectStore } from '../src/stores/projectStore'

// Rename reuses the switcher's existing inline-form pattern (the one behind
// "New project" and "Duplicate current") rather than a modal — `window.prompt`
// is a no-op in WKWebView, so the packaged desktop app would silently do
// nothing. These tests pin that it is a real input driven by standard events,
// and that the switcher re-reads the project list afterwards.

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return {
    ...actual,
    getProjects: vi.fn(),
    getDatabases: vi.fn(),
    renameProject: vi.fn(),
  }
})

const BEFORE = [
  { name: 'OldName', is_current: true },
  { name: 'Other', is_current: false },
]
const AFTER = [
  { name: 'NewName', is_current: true },
  { name: 'Other', is_current: false },
]

beforeEach(() => {
  vi.clearAllMocks()
  useProjectStore.setState({
    projects: BEFORE as never,
    currentProject: 'OldName',
    databases: [],
    isLoading: false,
  })
})

async function openMenu(container: HTMLElement) {
  const client = await import('../src/api/client')
  vi.mocked(client.getProjects).mockResolvedValue(BEFORE as never)
  vi.mocked(client.getDatabases).mockResolvedValue([] as never)
  fireEvent.click(container.querySelector('button')!)
  return client
}

describe('project rename', () => {
  it('renames through a standard text input, not window.prompt', async () => {
    const promptSpy = vi.fn()
    vi.stubGlobal('prompt', promptSpy)

    const { container, getByTestId } = render(<ProjectSwitcher />)
    const client = await openMenu(container)
    vi.mocked(client.renameProject).mockResolvedValue({ name: 'NewName', is_current: true } as never)
    vi.mocked(client.getProjects).mockResolvedValue(AFTER as never)

    fireEvent.click(getByTestId('project-rename-open'))

    const input = getByTestId('project-rename-input') as HTMLInputElement
    // Prefilled with the current name so the common case is an edit, not a retype.
    expect(input.value).toBe('OldName')

    fireEvent.change(input, { target: { value: 'NewName' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(client.renameProject).toHaveBeenCalledWith('OldName', 'NewName'))
    expect(promptSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('re-reads the project list, so the sidebar shows the new name without a reload', async () => {
    const { container, getByTestId } = render(<ProjectSwitcher />)
    const client = await openMenu(container)
    vi.mocked(client.renameProject).mockResolvedValue({ name: 'NewName', is_current: true } as never)

    fireEvent.click(getByTestId('project-rename-open'))
    fireEvent.change(getByTestId('project-rename-input'), { target: { value: 'NewName' } })
    vi.mocked(client.getProjects).mockResolvedValue(AFTER as never)
    fireEvent.click(getByTestId('project-rename-confirm'))

    await waitFor(() => expect(useProjectStore.getState().currentProject).toBe('NewName'))
    expect(useProjectStore.getState().projects.map((p) => p.name)).toEqual(['NewName', 'Other'])
  })

  it('surfaces a rejected rename in place and keeps the current name', async () => {
    const { container, getByTestId, findByText } = render(<ProjectSwitcher />)
    const client = await openMenu(container)
    // The backend 409s when two names share one storage directory.
    vi.mocked(client.renameProject).mockRejectedValue(
      new Error("Project names 'My/Project' and 'My_Project' both map to the storage directory"),
    )

    fireEvent.click(getByTestId('project-rename-open'))
    fireEvent.change(getByTestId('project-rename-input'), { target: { value: 'My_Project' } })
    fireEvent.click(getByTestId('project-rename-confirm'))

    expect(await findByText(/both map to the storage directory/)).toBeTruthy()
    expect(useProjectStore.getState().currentProject).toBe('OldName')
  })

  it('renaming to the unchanged name closes the form without calling the backend', async () => {
    const { container, getByTestId } = render(<ProjectSwitcher />)
    const client = await openMenu(container)

    fireEvent.click(getByTestId('project-rename-open'))
    fireEvent.click(getByTestId('project-rename-confirm'))

    await waitFor(() => expect(client.renameProject).not.toHaveBeenCalled())
  })
})
