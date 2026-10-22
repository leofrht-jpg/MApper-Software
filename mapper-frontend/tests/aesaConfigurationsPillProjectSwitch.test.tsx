/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
// The AESA Configurations pill after a project switch.
//
// Reported: switch project while on AESA and the pill disappears. Two causes,
// both covered here through the REAL client and stores -- only `fetch` is
// stubbed, answering per the X-Mapper-Project header the real client sends:
//   1. the pill was gated on an active DSM system and on N > 0 templates;
//   2. reset() on project change emptied the template list, and only the
//      sidebar's MOUNT effect reloads it -- the page stays mounted across a
//      switch, so the list stayed empty.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AESADashboard } from '../src/pages/AESADashboard'
import { useAESAStore } from '../src/stores/aesaStore'
import { useDSMStore } from '../src/stores/dsmStore'
import { useProjectStore } from '../src/stores/projectStore'
import { configureProjectGuard } from '../src/api/client'

// The same wiring App.tsx installs: the header names the current project.
configureProjectGuard(() => useProjectStore.getState().currentProject, () => undefined)

const TEMPLATES: Record<string, any[]> = {
  EVS40: [{ id: 'c-evs', name: 'Walk-AESA', mfa_system_id: null }],
  'MAp-test': [
    { id: 'c-wp5', name: 'WP5 template', mfa_system_id: 'sys-wp5' },
    { id: 'c-sp', name: 'Single-product template', mfa_system_id: null },
  ],
  empty: [],
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const headers = new Headers(init?.headers)
    const project = headers.get('X-Mapper-Project') ?? ''
    if (url.includes('/aesa/configurations')) {
      return json((TEMPLATES[project] ?? []).map((c) => ({
        ...c, boundary_set_id: 'Sala2020_EF', method_mapping: [], impact_mode: 'static',
      })))
    }
    if (url.includes('/aesa/sessions')) return json([])
    if (url.includes('/aesa/defaults')) return json({
      boundary_sets: [{ id: 'Sala2020_EF', name: 'Sala', source: '', boundaries: {} }],
      default_multi_d: { tiers: [] }, default_carbon_budget: null,
    })
    if (url.includes('/sharing-presets')) return json([])
    return json([])
  }))
  useProjectStore.setState({ currentProject: 'EVS40' } as any)
  useAESAStore.getState().reset()
  useDSMStore.setState({ systems: [], activeSystem: null, systemState: null } as any)
})
afterEach(() => { vi.unstubAllGlobals() })

const pillText = () => screen.getByTestId('aesa-configurations-toggle').textContent ?? ''

describe('AESA Configurations pill', () => {
  it('is visible with no DSM system, listing the project templates', async () => {
    render(<AESADashboard />)
    await waitFor(() => expect(pillText()).toContain('Configurations (1)'))
  })

  it('follows a project switch made while the page stays mounted', async () => {
    render(<AESADashboard />)
    await waitFor(() => expect(pillText()).toContain('Configurations (1)'))
    act(() => { useProjectStore.setState({ currentProject: 'MAp-test' } as any) })
    await waitFor(() => expect(pillText()).toContain('Configurations (2)'))
    fireEvent.click(screen.getByTestId('aesa-configurations-toggle'))
    expect(screen.getByTestId('aesa-configurations-row-c-wp5')).toBeTruthy()
    expect(screen.getByTestId('aesa-configurations-row-c-sp')).toBeTruthy()
    // Only the current project's templates.
    expect(screen.queryByTestId('aesa-configurations-row-c-evs')).toBeNull()
  })

  it('stays visible in a project with no templates, offering New configuration', async () => {
    useProjectStore.setState({ currentProject: 'empty' } as any)
    render(<AESADashboard />)
    await waitFor(() => expect(pillText()).toContain('Configurations (0)'))
    fireEvent.click(screen.getByTestId('aesa-configurations-toggle'))
    expect(screen.getByTestId('aesa-configurations-empty')).toBeTruthy()
    expect(screen.getByTestId('aesa-configurations-new')).toBeTruthy()
  })

  it('remembers the compute source per project', async () => {
    render(<AESADashboard />)
    act(() => { useAESAStore.getState().setSource('single_product') })
    act(() => { useProjectStore.setState({ currentProject: 'MAp-test' } as any) })
    expect(useAESAStore.getState().source).toBe('fleet')
    act(() => { useProjectStore.setState({ currentProject: 'EVS40' } as any) })
    expect(useAESAStore.getState().source).toBe('single_product')
  })
})

describe('deleting a template', () => {
  // window.confirm returns false in WKWebView, so the old confirm() made
  // deletion impossible in the packaged app. Two clicks, in place.
  it('asks with a second click and only then deletes', async () => {
    const del = vi.fn(async () => undefined)
    useAESAStore.setState({ deleteConfig: del } as any)
    render(<AESADashboard />)
    await waitFor(() => expect(pillText()).toContain('Configurations (1)'))
    fireEvent.click(screen.getByTestId('aesa-configurations-toggle'))
    fireEvent.click(screen.getByTestId('aesa-configurations-delete-c-evs'))
    expect(del).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('aesa-configurations-delete-confirm-c-evs'))
    expect(del).toHaveBeenCalledWith('c-evs')
  })
})
