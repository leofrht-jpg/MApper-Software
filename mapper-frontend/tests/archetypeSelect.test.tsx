/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ArchetypeSelect } from '../src/components/archetypes/ArchetypeSelect'
import type { ArchetypeSummary } from '../src/api/client'

const mk = (id: string, name: string, folder: string | null = null, errors = 0): ArchetypeSummary => ({
  id, name, folder,
  material_count: 10, unlinked_count: 0,
  stages: ['Manufacturing'],
  validation_error_rows: errors,
})

describe('ArchetypeSelect', () => {
  it('renders placeholder when no selection', () => {
    render(
      <ArchetypeSelect
        archetypes={[mk('a', 'A')]}
        selectedId={null}
        onChange={() => {}}
        placeholder="Pick one"
      />,
    )
    expect(screen.getByTestId('archetype-select-button')).toHaveTextContent('Pick one')
  })

  it('shows selected archetype name', () => {
    render(
      <ArchetypeSelect
        archetypes={[mk('a', 'BEV-LFP Small'), mk('b', 'ICEV Petrol')]}
        selectedId="b"
        onChange={() => {}}
      />,
    )
    expect(screen.getByTestId('archetype-select-button')).toHaveTextContent('ICEV Petrol')
  })

  it('opens listbox on click and groups by folder', () => {
    render(
      <ArchetypeSelect
        archetypes={[
          mk('a1', 'BEV-LFP', 'Vehicles'),
          mk('a2', 'BEV-NMC', 'Vehicles'),
          mk('a3', 'Wind 5MW', 'Energy'),
        ]}
        selectedId={null}
        onChange={() => {}}
      />,
    )
    fireEvent.click(screen.getByTestId('archetype-select-button'))
    const listbox = screen.getByTestId('archetype-select-listbox')
    expect(listbox).toHaveTextContent('Vehicles')
    expect(listbox).toHaveTextContent('Energy')
    // Folders sorted alphabetically (Energy before Vehicles); items
    // sorted alphabetically within each folder.
    const opts = screen.getAllByRole('option')
    expect(opts[0]).toHaveTextContent('Wind 5MW')
    expect(opts[1]).toHaveTextContent('BEV-LFP')
    expect(opts[2]).toHaveTextContent('BEV-NMC')
  })

  it('calls onChange and closes when option clicked', () => {
    const onChange = vi.fn()
    render(
      <ArchetypeSelect
        archetypes={[mk('a', 'A'), mk('b', 'B')]}
        selectedId={null}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByTestId('archetype-select-button'))
    fireEvent.click(screen.getByTestId('archetype-select-option-b'))
    expect(onChange).toHaveBeenCalledWith('b')
    expect(screen.queryByTestId('archetype-select-listbox')).toBeNull()
  })

  it('disables button when archetype list is empty', () => {
    render(<ArchetypeSelect archetypes={[]} selectedId={null} onChange={() => {}} />)
    const btn = screen.getByTestId('archetype-select-button')
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(screen.queryByTestId('archetype-select-listbox')).toBeNull()
  })

  it('disables options with validation errors and surfaces error count', () => {
    render(
      <ArchetypeSelect
        archetypes={[mk('a', 'Broken', null, 41), mk('b', 'OK')]}
        selectedId={null}
        onChange={() => {}}
      />,
    )
    fireEvent.click(screen.getByTestId('archetype-select-button'))
    const broken = screen.getByTestId('archetype-select-option-a')
    expect(broken).toBeDisabled()
    expect(broken).toHaveTextContent('41 err')
    expect(screen.getByTestId('archetype-select-option-b')).not.toBeDisabled()
  })

  it('does not open when disabled prop is set', () => {
    render(
      <ArchetypeSelect
        archetypes={[mk('a', 'A')]}
        selectedId={null}
        onChange={() => {}}
        disabled
      />,
    )
    fireEvent.click(screen.getByTestId('archetype-select-button'))
    expect(screen.queryByTestId('archetype-select-listbox')).toBeNull()
  })
})
