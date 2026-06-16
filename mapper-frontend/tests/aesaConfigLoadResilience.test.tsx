/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { ConfigSidebar } from '../src/components/aesa/ConfigSidebar'
import { useAESAStore } from '../src/stores/aesaStore'
import { useDSMStore } from '../src/stores/dsmStore'
import * as client from '../src/api/client'
import { withTransientRetry, isTransientNetworkError, HttpError } from '../src/api/client'

// Patch 5AM — AESA config-panel fetch resilience + the named retry banner.
// Root cause: the config panel's mount loads (defaults / presets /
// configurations / sessions) fired eagerly with no ready-gate and no retry,
// so a first-paint network race surfaced a bare "Failed to fetch". Fix:
// withTransientRetry (network-only) + a dedicated configLoadError slot driving
// a named, dismissible Retry banner.

const SYSTEM: any = { id: 'sys-1', name: 'Fleet', dimensions: [], time_horizon: { start_year: 2020, end_year: 2050 } }
const SHARING: any = { id: 'preset-1', name: 'Preset', description: '', principles: [], category_assignments: [], chain: { layers: [] } }
const DEFAULTS: any = { boundary_sets: [{ id: 'Sala2020_EF', name: 'Sala 2020 EF', source: 'EF v3.1' }], default_multi_d: { tiers: [] }, default_carbon_budget: null }

beforeEach(() => {
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
  vi.restoreAllMocks()
  useDSMStore.setState({ systems: [{ id: SYSTEM.id, name: SYSTEM.name } as never], activeSystem: SYSTEM, systemState: { scenarios: [], active_scenario_id: null } as never })
  useAESAStore.setState({
    defaults: DEFAULTS, defaultsLoading: false, presets: [SHARING], presetsLoading: false,
    configurations: [], activeConfigId: null, creatingNewConfig: true,
    activeSessionId: null, configLoadError: null, error: null, draft: null,
  })
})

afterEach(cleanup)

describe('Part A — transient retry primitive', () => {
  it('isTransientNetworkError: TypeError / "Failed to fetch" yes, HttpError no', () => {
    expect(isTransientNetworkError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isTransientNetworkError(new Error('NetworkError when attempting to fetch'))).toBe(true)
    expect(isTransientNetworkError(new HttpError(500, 'boom'))).toBe(false)
    expect(isTransientNetworkError(new HttpError(404, 'nope'))).toBe(false)
  })

  it('retries a first-failure-then-success and resolves', async () => {
    const fn = vi.fn<() => Promise<string>>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue('ok')
    await expect(withTransientRetry(fn, { baseDelayMs: 1 })).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('does NOT retry a genuine HttpError (rethrows immediately)', async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new HttpError(500, 'server error'))
    await expect(withTransientRetry(fn, { baseDelayMs: 1 })).rejects.toBeInstanceOf(HttpError)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('Part A — store self-recovers without surfacing the banner', () => {
  it('loadDefaults recovers from a first-failure-then-success, leaving configLoadError null', async () => {
    useAESAStore.setState({ defaults: null, defaultsLoading: false, presets: [], presetsLoading: false, configLoadError: null })
    vi.spyOn(client, 'getSharingPresets').mockResolvedValue([SHARING])
    const spy = vi.spyOn(client, 'getAESADefaults')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(DEFAULTS)

    await act(async () => { await useAESAStore.getState().loadDefaults() })

    expect(spy).toHaveBeenCalledTimes(2)
    expect(useAESAStore.getState().defaults).toBeTruthy()
    expect(useAESAStore.getState().configLoadError).toBeNull()
  })
})

describe('Part B — named retry banner', () => {
  beforeEach(() => {
    vi.spyOn(client, 'getAESADefaults').mockResolvedValue(DEFAULTS)
    vi.spyOn(client, 'getSharingPresets').mockResolvedValue([SHARING])
    vi.spyOn(client, 'getAESAConfigurations').mockResolvedValue([])
    vi.spyOn(client, 'getAESASessions').mockResolvedValue([])
  })

  it('renders a human label + Retry that re-invokes the failed load', async () => {
    const { container, getByTestId, queryByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(queryByTestId('aesa-config-load-error')).toBeNull())

    // Simulate a configurations load that failed (e.g. transient that exhausted retries).
    act(() => { useAESAStore.setState({ configLoadError: { kind: 'configurations', message: 'Failed to fetch' } }) })

    const banner = getByTestId('aesa-config-load-error')
    expect(banner.textContent).toContain('Couldn’t load saved configurations')
    // Human label, NOT the raw error string.
    expect(banner.textContent).not.toContain('Failed to fetch')

    const calls = (client.getAESAConfigurations as any).mock.calls.length
    await act(async () => { fireEvent.click(getByTestId('aesa-config-load-retry')) })
    expect((client.getAESAConfigurations as any).mock.calls.length).toBe(calls + 1)
    // Successful retry clears the banner.
    await waitFor(() => expect(queryByTestId('aesa-config-load-error')).toBeNull())
    void container
  })

  it('Dismiss clears the banner (non-blocking)', async () => {
    const { getByTestId, queryByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(queryByTestId('aesa-config-load-error')).toBeNull())
    act(() => { useAESAStore.setState({ configLoadError: { kind: 'defaults', message: 'Failed to fetch' } }) })
    expect(getByTestId('aesa-config-load-error').textContent).toContain('Couldn’t load AESA defaults')
    await act(async () => { fireEvent.click(getByTestId('aesa-config-load-dismiss')) })
    expect(queryByTestId('aesa-config-load-error')).toBeNull()
  })
})

describe('Part C — σ control accessible label/tooltip', () => {
  beforeEach(() => {
    vi.spyOn(client, 'getAESADefaults').mockResolvedValue(DEFAULTS)
    vi.spyOn(client, 'getSharingPresets').mockResolvedValue([SHARING])
    vi.spyOn(client, 'getAESAConfigurations').mockResolvedValue([])
    vi.spyOn(client, 'getAESASessions').mockResolvedValue([])
  })

  it('the run-sensitivity (σ) toggle exposes a descriptive title + aria-label', async () => {
    const { getByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const toggle = getByTestId('aesa-run-sensitivity-toggle')
    const title = toggle.getAttribute('title') ?? ''
    const aria = toggle.getAttribute('aria-label') ?? ''
    expect(title.toLowerCase()).toContain('sensitivity')
    expect(title.toLowerCase()).toContain('sharing principles')
    expect(aria.toLowerCase()).toContain('sensitivity')
    // One control: the checkbox lives inside the labelled toggle.
    expect(toggle.querySelector('input[type="checkbox"]')).toBeTruthy()
  })
})
