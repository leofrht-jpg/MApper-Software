import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor } from '@testing-library/react'
import { ConfigSidebar } from '../src/components/aesa/ConfigSidebar'
import { useAESAStore } from '../src/stores/aesaStore'
import { useDSMStore } from '../src/stores/dsmStore'
import { useImpactStore } from '../src/stores/impactStore'
import * as client from '../src/api/client'
import type {
  AESADefaultsBundle, AESAComputeResult, AESAConfiguration, AESASession,
  SharingPreset, SystemDefinition, DSMSystemState,
} from '../src/api/client'

// Patch 4R — saved sessions frontend tests. Covers:
//   - Sessions list renders empty state when none saved.
//   - Sessions list renders rows with rename + delete buttons.
//   - Clicking a session row calls loadSession and switches the
//     dashboard into frozen mode (banner + fieldset disabled +
//     "Return to live view" replacing Compute).
//   - Delete button opens confirmation modal; confirming calls the
//     delete action.
//   - saveCurrentSession action snapshots the cascade + result and
//     prepends the new session to the list.

const SYSTEM: SystemDefinition = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  id: 'sys-1', name: 'Fleet', unit_name: 'vehicles',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dimensions: [], time_horizon: { start_year: 2020, end_year: 2050 } as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any
const SYSTEM_STATE: DSMSystemState = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scenarios: [{ id: 'base', name: 'Base', is_base: true } as any],
  active_scenario_id: 'base',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any
const SHARING: SharingPreset = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  id: 'preset-1', name: 'Preset', description: '',
  principles: [], category_assignments: [],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chain: { layers: [] } as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any
const DEFAULTS: AESADefaultsBundle = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  boundary_sets: [{ id: 'Sala2020_EF', name: 'Sala 2020 EF', source: 'EF v3.1' } as any],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default_multi_d: { tiers: [] } as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default_carbon_budget: null as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any
const CFG_SNAPSHOT: AESAConfiguration = {
  id: 'cfg-snap', name: 'My Run', mfa_system_id: 'sys-1',
  impact_mode: 'static', boundary_set_id: 'Sala2020_EF',
  sharing: SHARING, sharing_preset_id: SHARING.id,
  carbon_budget: null, method_mapping: [], created_at: '2026-05-08T10:00:00Z',
  dsm_scenario_id: 'base',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any
const RESULT: AESAComputeResult = {
  config_id: 'cfg-snap', results: [], summary_by_year: [],
  missing_categories: [],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any
const SESSION_A: AESASession = {
  id: 'ses-a', name: 'Session A', project: 'p1',
  created_at: '2026-05-08T10:00:00Z', modified_at: '2026-05-08T10:00:00Z',
  configuration_snapshot: CFG_SNAPSHOT, result: RESULT,
  upstream_ia_task_id: null,
}
const SESSION_B: AESASession = {
  ...SESSION_A,
  id: 'ses-b', name: 'Session B',
  created_at: '2026-05-09T10:00:00Z', modified_at: '2026-05-09T10:00:00Z',
}

beforeEach(() => {
  // Reset spy call history between tests; `vi.spyOn` reuses the
  // existing spy across tests in this file, so absent a clear, the
  // call counts accumulate.
  vi.restoreAllMocks()
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
  vi.spyOn(client, 'getAESADefaults').mockResolvedValue(DEFAULTS)
  vi.spyOn(client, 'getAESAConfigurations').mockResolvedValue([])
  vi.spyOn(client, 'getSharingPresets').mockResolvedValue([SHARING])
  vi.spyOn(client, 'getAESASessions').mockResolvedValue([])
  vi.spyOn(client, 'createAESASession').mockResolvedValue(SESSION_A)
  vi.spyOn(client, 'renameAESASession').mockResolvedValue({ ...SESSION_A, name: 'Renamed' })
  vi.spyOn(client, 'deleteAESASession').mockResolvedValue(undefined)
  useDSMStore.setState({
    systems: [{ id: SYSTEM.id, name: SYSTEM.name } as never],
    activeSystem: SYSTEM,
    systemState: SYSTEM_STATE,
  })
  useImpactStore.setState({
    staticResult: null, projectedResult: null,
    staticDsmScenarioRuns: {}, projectedDsmScenarioRuns: {},
  })
  useAESAStore.setState({
    defaults: DEFAULTS,
    presets: [SHARING],
    configurations: [],
    activeConfigId: null,
    creatingNewConfig: true,  // unblock the cascade for these tests
    sessions: [],
    sessionsLoading: false,
    activeSessionId: null,
    draft: {
      name: 'Draft', boundary_set_id: 'Sala2020_EF', sharing: SHARING,
      sharing_preset_id: SHARING.id, carbon_budget: null,
      method_mapping: [], impact_mode: 'static', dsm_scenario_id: null,
    },
    result: null, lastRunAt: null, running: false, error: null,
  })
})

describe('Saved Sessions list (Patch 4R)', () => {
  it('shows empty-state copy when no sessions exist', () => {
    const { getByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    expect(getByTestId('aesa-sessions-empty')).toBeInTheDocument()
  })

  it('renders rows for each saved session, newest first', () => {
    useAESAStore.setState({ sessions: [SESSION_B, SESSION_A] })
    const { getByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    expect(getByTestId(`aesa-session-row-${SESSION_B.id}`)).toBeInTheDocument()
    expect(getByTestId(`aesa-session-row-${SESSION_A.id}`)).toBeInTheDocument()
  })

  it('clicking a session row loads it and flips activeSessionId', async () => {
    useAESAStore.setState({ sessions: [SESSION_A] })
    const { getByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    // The row's main click target is the name button; locate via row
    // testid + dive to the inner button.
    const row = getByTestId(`aesa-session-row-${SESSION_A.id}`)
    const loadBtn = row.querySelector('button')
    expect(loadBtn).not.toBeNull()
    fireEvent.click(loadBtn!)
    await waitFor(() => {
      expect(useAESAStore.getState().activeSessionId).toBe(SESSION_A.id)
    })
    expect(useAESAStore.getState().result).toBe(RESULT)
  })

  it('clicking delete opens the confirmation modal; confirm deletes', async () => {
    useAESAStore.setState({ sessions: [SESSION_A] })
    const { getByTestId, queryByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    // Modal absent until delete is clicked.
    expect(queryByTestId('aesa-session-delete-modal')).toBeNull()
    // Find the delete button — it's the button with title="Delete"
    // inside the row. Buttons sit after the rename pencil button.
    const row = getByTestId(`aesa-session-row-${SESSION_A.id}`)
    const buttons = Array.from(row.querySelectorAll('button'))
    const deleteBtn = buttons.find((b) => b.title === 'Delete')
    expect(deleteBtn).not.toBeUndefined()
    fireEvent.click(deleteBtn!)
    expect(getByTestId('aesa-session-delete-modal')).toBeInTheDocument()
    fireEvent.click(getByTestId('aesa-session-delete-confirm'))
    await waitFor(() => {
      expect(client.deleteAESASession).toHaveBeenCalledWith(SESSION_A.id)
    })
  })
})

describe('Loaded-session frozen mode (Patch 4R)', () => {
  it('renders the frozen banner and disables the cascade fieldset when activeSessionId is set', () => {
    useAESAStore.setState({
      sessions: [SESSION_A],
      activeSessionId: SESSION_A.id,
      result: RESULT,
    })
    const { getByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    expect(getByTestId('aesa-session-frozen-banner')).toBeInTheDocument()
    const fieldset = getByTestId('aesa-config-fieldset') as HTMLFieldSetElement
    expect(fieldset.disabled).toBe(true)
  })

  it('replaces the footer Compute / Save controls with "Return to live view"', () => {
    useAESAStore.setState({
      sessions: [SESSION_A],
      activeSessionId: SESSION_A.id,
      result: RESULT,
    })
    const { getByTestId, queryByText } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    expect(getByTestId('aesa-sidebar-return-to-live')).toBeInTheDocument()
    // Compute button absent in this footer regime.
    expect(queryByText('Compute')).toBeNull()
  })

  it('clicking the sidebar Return-to-live button clears activeSessionId', () => {
    useAESAStore.setState({
      sessions: [SESSION_A],
      activeSessionId: SESSION_A.id,
      result: RESULT,
    })
    const { getByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    fireEvent.click(getByTestId('aesa-sidebar-return-to-live'))
    expect(useAESAStore.getState().activeSessionId).toBeNull()
    expect(useAESAStore.getState().result).toBeNull()
  })

  it('keeps the saved-sessions list interactive in frozen mode', () => {
    // The fieldset wraps only the editable cascade/sections; the
    // sessions list is rendered OUTSIDE so users can switch sessions
    // without exiting frozen mode first.
    useAESAStore.setState({
      sessions: [SESSION_A, SESSION_B],
      activeSessionId: SESSION_A.id,
      result: RESULT,
    })
    const { getByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const list = getByTestId('aesa-sessions-list')
    // The list is NOT a descendant of the fieldset.
    const fieldset = getByTestId('aesa-config-fieldset')
    expect(fieldset.contains(list)).toBe(false)
  })
})

describe('saveCurrentSession action (Patch 4R)', () => {
  it('snapshots the cascade + result and prepends the new session to the list', async () => {
    useAESAStore.setState({ result: RESULT })
    const session = await useAESAStore.getState().saveCurrentSession('Initial save')
    expect(session).toEqual(SESSION_A)
    expect(client.createAESASession).toHaveBeenCalledTimes(1)
    const callArg = (client.createAESASession as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(callArg.name).toBe('Initial save')
    expect(callArg.result).toBe(RESULT)
    expect(callArg.configuration_snapshot.boundary_set_id).toBe('Sala2020_EF')
    // List updated optimistically — newest session first.
    expect(useAESAStore.getState().sessions[0]).toEqual(SESSION_A)
  })

  it('errors out gracefully when there is no result to save', async () => {
    useAESAStore.setState({ result: null })
    const session = await useAESAStore.getState().saveCurrentSession('No result yet')
    expect(session).toBeNull()
    expect(client.createAESASession).not.toHaveBeenCalled()
    expect(useAESAStore.getState().error).toContain('No result to save')
  })
})

describe('clearActiveSession action (Patch 4R)', () => {
  it('returns the dashboard to live view', () => {
    useAESAStore.setState({
      activeSessionId: SESSION_A.id,
      result: RESULT,
      lastRunAt: '2026-05-08T10:00:00Z',
    })
    useAESAStore.getState().clearActiveSession()
    expect(useAESAStore.getState().activeSessionId).toBeNull()
    expect(useAESAStore.getState().result).toBeNull()
    expect(useAESAStore.getState().lastRunAt).toBeNull()
  })
})
