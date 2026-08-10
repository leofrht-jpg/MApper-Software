/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, cleanup, fireEvent, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ConfigSidebar } from '../src/components/aesa/ConfigSidebar'
import { PrinciplesEditor } from '../src/components/aesa/PrinciplesEditor'
import { useAESAStore } from '../src/stores/aesaStore'
import { useDSMStore } from '../src/stores/dsmStore'
import { useImpactStore } from '../src/stores/impactStore'
import * as client from '../src/api/client'

// The pen in SHARING PRINCIPLES did nothing when clicked. It was not a wiring
// bug: the button was `disabled={readOnly}` with
// `readOnly = !!draft?.sharing.built_in`, and every fresh draft is seeded from
// the shipped built-in template — so the control was disabled by design, while
// its title said "Edit" unconditionally and gave no reason. The same gate sat
// on the chain editor and the category-assignments table.
//
// Removing the sharing-preset section removes the gate: the sharing snapshot
// belongs to the configuration and is directly editable, with the shipped
// defaults reachable through Reset.
//
// These tests assert the control OPENS THE EDITOR — not merely that it
// renders. A test that only checks presence passes against the bug.

const BUILT_IN: any = {
  id: 'ferhati_2026_multi_d',
  name: 'Multi-D allocation (default)',
  description: 'shipped',
  built_in: true,                       // ← the flag that used to disable everything
  principles: [
    { id: 'EpC', name: 'Equal per capita', description: 'population share' },
    { id: 'AGR', name: 'Agricultural land', description: 'agri share' },
  ],
  category_assignments: [
    { pb_id: 'climate_change', principle_id: 'EpC' },
    { pb_id: 'acidification', principle_id: 'AGR' },
  ],
  chain: {
    layers: [
      { layer_number: 1, principle_mode: 'category_specific', fixed_principle: null, data: {} },
    ],
  },
}

const SALA: any = {
  id: 'Sala2020_EF', name: 'Sala 2020 EF', source: 'EF v3.1',
  boundaries: {
    climate_change: { id: 'climate_change', name: 'Climate change', unit: 'kg CO2 eq/yr', boundary_type: 'cumulative', control_variable: 'CO2' },
    acidification: { id: 'acidification', name: 'Acidification', unit: 'mol H+ eq/yr', boundary_type: 'flow', control_variable: 'AE' },
  },
}

const DEFAULTS: any = {
  boundary_sets: [SALA], multi_d_defaults: [], sharing_data: {},
  ssp_trajectories: [], carbon_budget_options: [],
  default_multi_d: { tiers: [] }, default_carbon_budget: null,
}

const SYSTEM: any = { id: 'sys-1', name: 'Fleet', dimensions: [], time_horizon: { start_year: 2020, end_year: 2050 } }
const SYSTEM_STATE: any = { scenarios: [{ id: 'base', name: 'Base', is_base: true }], active_scenario_id: 'base' }

function seedDraft(overrides: any = {}) {
  useAESAStore.setState({
    defaults: DEFAULTS, defaultsLoading: false, presets: [BUILT_IN],
    draft: {
      name: 'Cfg', mfa_system_id: 'sys-1', impact_mode: 'static',
      boundary_set_id: 'Sala2020_EF', sharing_preset_id: BUILT_IN.id,
      sharing: { ...BUILT_IN, built_in: false }, carbon_budget: null,
      method_mapping: [], dsm_scenario_id: null,
      ...overrides,
    } as any,
    configurations: [], activeConfigId: null, creatingNewConfig: true,
    activeSessionId: null, configLoadError: null, error: null, result: null,
    lastComputeArgs: null,
  } as any)
}

beforeEach(() => {
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  vi.restoreAllMocks()
  vi.spyOn(client, 'getAESADefaults').mockResolvedValue(DEFAULTS)
  vi.spyOn(client, 'getSharingPresets').mockResolvedValue([BUILT_IN])
  vi.spyOn(client, 'getAESAConfigurations').mockResolvedValue([])
  vi.spyOn(client, 'getAESASessions').mockResolvedValue([])
  useDSMStore.setState({ systems: [{ id: SYSTEM.id, name: SYSTEM.name } as never], activeSystem: SYSTEM, systemState: SYSTEM_STATE })
  useImpactStore.setState({ staticResult: null, projectedResult: null })
  seedDraft()
})

afterEach(cleanup)

// ── the reported bug ────────────────────────────────────────────────────────

describe('the pen in SHARING PRINCIPLES opens the editor', () => {
  function openPrinciples() {
    const utils = render(<PrinciplesEditor />)
    // The list is behind its own expander.
    fireEvent.click(utils.getByRole('button', { name: /principle/i }))
    return utils
  }

  it('is not disabled', () => {
    const utils = openPrinciples()
    const pen = utils.getAllByTitle('Edit')[0] as HTMLButtonElement
    expect(pen.disabled).toBe(false)
  })

  it('opens the edit modal when clicked — the actual reported failure', () => {
    const utils = openPrinciples()
    expect(utils.queryByText(/Edit principle|principle id/i)).toBeNull()
    fireEvent.click(utils.getAllByTitle('Edit')[0])
    // The modal is identified by a control only it renders.
    expect(document.body.textContent).toMatch(/Equal per capita/)
    expect(utils.getAllByRole('button', { name: /save|apply/i }).length).toBeGreaterThan(0)
  })

  it('opens even when the snapshot still claims to be the built-in template', () => {
    // A config saved before this patch can carry `built_in: true`. The editors
    // must not consult it at all — this is the exact state that produced the
    // dead pen.
    seedDraft({ sharing: { ...BUILT_IN, built_in: true } })
    const utils = openPrinciples()
    const pen = utils.getAllByTitle('Edit')[0] as HTMLButtonElement
    expect(pen.disabled).toBe(false)
    fireEvent.click(pen)
    expect(document.body.textContent).toMatch(/Equal per capita/)
  })

  it('still refuses to delete a principle that is in use', () => {
    // The gate that SHOULD remain: referential integrity, not template
    // ownership. EpC is assigned to climate_change in the fixture.
    const utils = openPrinciples()
    const del = utils.getAllByTitle(/In use/i)[0] as HTMLButtonElement
    expect(del.disabled).toBe(true)
  })
})

// ── no control lies about being disabled ────────────────────────────────────

describe('no editor control claims an action it cannot perform', () => {
  it('the three editors no longer read sharing.built_in', () => {
    for (const rel of [
      'src/components/aesa/PrinciplesEditor.tsx',
      'src/components/aesa/CategoryAssignmentsTable.tsx',
      'src/components/aesa/DownscalingChainEditor.tsx',
      'src/components/aesa/LayerEditModal.tsx',
    ]) {
      const src = readFileSync(resolve(process.cwd(), rel), 'utf-8')
      expect(src, `${rel} still gates on built_in`).not.toMatch(/sharing\.built_in/)
      expect(src, `${rel} still carries a readOnly gate`).not.toMatch(/\breadOnly\b/)
    }
  })

  it('every remaining disabled control in them explains itself', () => {
    // The pen read as broken because it was conditionally disabled while its
    // title was the constant "Edit". Anything still conditionally disabled in
    // these editors must vary its title with the same condition, so the user
    // is told why.
    for (const rel of [
      'src/components/aesa/PrinciplesEditor.tsx',
      'src/components/aesa/DownscalingChainEditor.tsx',
    ]) {
      const src = readFileSync(resolve(process.cwd(), rel), 'utf-8')
      const elements = src.match(/<button[^>]*>/g) ?? []
      for (const el of elements) {
        const conditionallyDisabled = /disabled=\{(?!true\}|false\})/.test(el)
        const constantTitle = /title="[^"]*"/.test(el)
        expect(
          conditionallyDisabled && constantTitle,
          `${rel}: this control is conditionally disabled but its title is a `
          + `constant, so a disabled state looks like a broken one — ${el}`,
        ).toBe(false)
      }
    }
  })
})

// ── the sharing preset section is gone ──────────────────────────────────────

describe('the Sharing preset section is removed', () => {
  it('renders no preset selector', async () => {
    const { queryByTestId, container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(queryByTestId('aesa-collapsible-downscaling-chain')).not.toBeNull())
    expect(queryByTestId('aesa-collapsible-sharing-preset')).toBeNull()
    expect(container.textContent).not.toMatch(/Duplicate to customize/i)
  })

  it('PresetSelector no longer exists in the source tree', () => {
    let found = true
    try { readFileSync(resolve(process.cwd(), 'src/components/aesa/PresetSelector.tsx')) }
    catch { found = false }
    expect(found).toBe(false)
  })
})

// ── Reset is the only route back, so it must be safe and legible ────────────

describe('Reset names what it restores and asks first', () => {
  it('lives in the Configuration header', async () => {
    const { queryByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(queryByTestId('aesa-reset-defaults')).not.toBeNull())
  })

  it('names the four things it replaces, not just "Reset"', async () => {
    const { getByTestId, queryByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(queryByTestId('aesa-reset-defaults')).not.toBeNull())
    const title = getByTestId('aesa-reset-defaults').getAttribute('title') ?? ''
    for (const word of ['chain', 'principles', 'assignments', 'budget']) {
      expect(title.toLowerCase(), `tooltip should name the ${word}`).toContain(word)
    }
    expect(getByTestId('aesa-reset-defaults').getAttribute('aria-label')).toMatch(/reset/i)
  })

  it('does not reset on the first click — it asks', async () => {
    const { getByTestId, queryByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(queryByTestId('aesa-reset-defaults')).not.toBeNull())
    const before = useAESAStore.getState().draft
    fireEvent.click(getByTestId('aesa-reset-defaults'))
    expect(useAESAStore.getState().draft).toBe(before)          // untouched
    expect(screen.getByTestId('aesa-reset-confirm')).toBeTruthy()
  })

  it('cancelling leaves the draft alone', async () => {
    const { getByTestId, queryByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(queryByTestId('aesa-reset-defaults')).not.toBeNull())
    const before = useAESAStore.getState().draft
    fireEvent.click(getByTestId('aesa-reset-defaults'))
    fireEvent.click(screen.getByTestId('aesa-reset-cancel'))
    expect(useAESAStore.getState().draft).toBe(before)
    expect(screen.queryByTestId('aesa-reset-confirm')).toBeNull()
  })

  it('confirming restores the shipped defaults', async () => {
    const { getByTestId, queryByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(queryByTestId('aesa-reset-defaults')).not.toBeNull())
    useAESAStore.setState({
      draft: { ...useAESAStore.getState().draft!, name: 'edited by hand' } as any,
    })
    fireEvent.click(getByTestId('aesa-reset-defaults'))
    fireEvent.click(screen.getByTestId('aesa-reset-confirm-btn'))
    expect(useAESAStore.getState().draft?.name).not.toBe('edited by hand')
  })
})

// ── the flag must not lie ───────────────────────────────────────────────────

describe('a draft never claims to be the shipped template', () => {
  it('seeding from the built-in yields an editable snapshot', async () => {
    useAESAStore.setState({ draft: null } as any)
    render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(useAESAStore.getState().draft).not.toBeNull())
    expect(useAESAStore.getState().draft?.sharing.built_in).toBe(false)
    // Provenance is kept.
    expect(useAESAStore.getState().draft?.sharing_preset_id).toBe(BUILT_IN.id)
  })
})

// ── legacy configurations ───────────────────────────────────────────────────

describe('a configuration saved under the old model loads AND is editable', () => {
  // The real shape on disk (MAp-test / "PB-EF - 1,5C 50th - 250 Gt"):
  // `sharing: null`, `multi_d: null`, `sharing_preset_id: null`. It predates
  // the inline sharing snapshot entirely, so `draftFromConfig` resolves it
  // through the built-in preset fallback — which is exactly why the preset
  // STORE is kept even though the preset SECTION is gone. Removing the
  // endpoint would have made this config unloadable.
  const LEGACY: any = {
    id: 'cfg-legacy', name: 'PB-EF - 1,5C 50th - 250 Gt',
    mfa_system_id: 'sys-1', dsm_scenario_id: null, impact_mode: 'static',
    boundary_set_id: 'Sala2020_EF',
    multi_d: null, sharing: null, sharing_preset_id: null,
    carbon_budget: null, method_mapping: [], created_at: '2026-05-01T00:00:00Z',
  }

  beforeEach(() => {
    vi.spyOn(client, 'getAESAConfigurations').mockResolvedValue([LEGACY])
  })

  it('loads — the draft resolves through the built-in fallback', async () => {
    render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(useAESAStore.getState().configurations.length).toBe(1))
    await useAESAStore.getState().setActiveConfig('cfg-legacy')
    const draft = useAESAStore.getState().draft
    expect(draft, 'a legacy config must still produce a draft').not.toBeNull()
    expect(draft!.name).toBe('PB-EF - 1,5C 50th - 250 Gt')
    expect(draft!.sharing.principles.length).toBeGreaterThan(0)
  })

  it('and is EDITABLE afterwards — not merely loadable', async () => {
    render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(useAESAStore.getState().configurations.length).toBe(1))
    await useAESAStore.getState().setActiveConfig('cfg-legacy')
    // The flag is normalised on the way in, so the editors cannot be gated.
    expect(useAESAStore.getState().draft!.sharing.built_in).toBe(false)

    cleanup()
    const utils = render(<PrinciplesEditor />)
    fireEvent.click(utils.getByRole('button', { name: /principle/i }))
    const pen = utils.getAllByTitle('Edit')[0] as HTMLButtonElement
    expect(pen.disabled).toBe(false)
    fireEvent.click(pen)
    expect(document.body.textContent).toMatch(/Equal per capita/)
  })

  it('keeps sharing_preset_id as written — provenance is not invented', async () => {
    render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(useAESAStore.getState().configurations.length).toBe(1))
    await useAESAStore.getState().setActiveConfig('cfg-legacy')
    // The legacy config recorded no preset; loading it must not fabricate one.
    expect(useAESAStore.getState().draft!.sharing_preset_id).toBeNull()
  })
})
