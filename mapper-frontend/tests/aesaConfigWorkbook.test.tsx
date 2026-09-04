/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { relPosix } from './helpers/relPosix'

// Section (2)'s Template / Export settings / Import settings trio. Import
// replaces the ACTIVE configuration, so it is destructive and must go through
// an inline confirm — window.confirm is a no-op in WKWebView, so the packaged
// app would otherwise apply silently.

const importAESAConfig = vi.fn()
const exportAESAConfig = vi.fn(async () => {})

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return {
    ...actual,
    importAESAConfig: (...a: unknown[]) => importAESAConfig(...a),
    exportAESAConfig: (...a: unknown[]) => exportAESAConfig(...a),
  }
})

const BUNDLE = {
  boundary_set_id: 'Ryberg2018_PBLCIA',
  sharing_preset_id: null,
  sharing: { id: '', name: 'Imported', description: '', built_in: false,
             principles: [], category_assignments: [],
             chain: { layers: [] } },
  method_mapping: [{ method_tuple: ['EF v3.1', 'climate change'], pb_id: 'climate_change',
                     conversion_factor: 1.0 }],
  carbon_budget: null,
}

const CONFIG = { id: 'c1', name: 'Fleet AESA', boundary_set_id: 'Sala2020_EF',
                 method_mapping: [], created_at: '' }

async function renderButtons(onApply = vi.fn()) {
  const { ConfigWorkbookButtons } = await import('../src/components/aesa/ConfigWorkbookButtons')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = render(<ConfigWorkbookButtons config={CONFIG as any} onApply={onApply} />)
  return { ...r, onApply }
}

function pickFile(container: HTMLElement) {
  const input = container.querySelector('[data-testid="aesa-config-file-input"]') as HTMLInputElement
  const file = new File(['x'], 'aesa.xlsx', { type: 'application/vnd.ms-excel' })
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  fireEvent.change(input)
}

// The confirm dialog and the error list are PORTALLED to document.body — they
// have to be, or the AESA sidebar's stacking context paints the radar chart on
// top of them (see aesaModalsPortal.test.ts, and the rule in CLAUDE.md). So
// they are NOT inside `container`, which is only the render root. Query the
// document instead. Everything still in the sidebar itself keeps using
// `container`, so a testid moving out of the portal shows up as a failure here
// rather than silently passing against the wrong node.
const PORTALLED = (sel: string) => document.body.querySelector(sel)
const bodyText = () => document.body.textContent ?? ''

beforeEach(() => {
  importAESAConfig.mockReset()
  exportAESAConfig.mockClear()
})

describe('section (2) workbook buttons', () => {
  it('renders two, labelled for the whole configuration not just a preset', async () => {
    const { container } = await renderButtons()
    const text = container.textContent ?? ''
    expect(text).toContain('Export settings')
    expect(text).toContain('Import settings')
    // The old preset-only framing must be gone.
    expect(text).not.toContain('Export preset')
    expect(text).not.toContain('Import preset')
    // And the Template button with it: an export from a fresh draft IS the
    // template, so a third button would be a second artefact to keep in step.
    expect(text).not.toContain('Template')
    expect(container.querySelector('[data-testid="aesa-config-template"]')).toBeNull()
  })

  it('Export calls through without a confirm', async () => {
    const { container } = await renderButtons()
    fireEvent.click(container.querySelector('[data-testid="aesa-config-export"]')!)
    await waitFor(() => expect(exportAESAConfig).toHaveBeenCalledWith(CONFIG))
  })

  it('Export posts the live draft — no id, no created_at', async () => {
    // The endpoint takes AESAConfigurationCreate. It previously took
    // AESAConfiguration, which requires `id` and `created_at`, so every
    // unsaved configuration 422'd and the button looked dead. A frontend
    // `as unknown as AESAConfiguration` cast hid the mismatch from tsc; that
    // cast is gone, so this asserts the shape actually sent.
    const { ConfigWorkbookButtons } = await import('../src/components/aesa/ConfigWorkbookButtons')
    const draft = {
      name: 'Unsaved config',
      boundary_set_id: 'Sala2020_EF',
      sharing_preset_id: null,
      carbon_budget: null,
      method_mapping: [],
      impact_mode: 'static' as const,
      dsm_scenario_id: null,
    }
    const { container } = render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <ConfigWorkbookButtons config={draft as any} onApply={vi.fn()} />,
    )
    fireEvent.click(container.querySelector('[data-testid="aesa-config-export"]')!)
    await waitFor(() => expect(exportAESAConfig).toHaveBeenCalled())

    // Forwarded verbatim — no id/created_at synthesised, no cast, no reshaping.
    const sent = exportAESAConfig.mock.calls[0][0] as Record<string, unknown>
    expect(sent).toEqual(draft)
    expect(sent.id).toBeUndefined()
    expect(sent.created_at).toBeUndefined()
  })

  it('Export works with no sharing preset selected', async () => {
    const { ConfigWorkbookButtons } = await import('../src/components/aesa/ConfigWorkbookButtons')
    const draft = { name: 'Unsaved', boundary_set_id: 'Sala2020_EF',
                    sharing_preset_id: null, carbon_budget: null, method_mapping: [] }
    const { container } = render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <ConfigWorkbookButtons config={draft as any} onApply={vi.fn()} />,
    )
    fireEvent.click(container.querySelector('[data-testid="aesa-config-export"]')!)
    await waitFor(() => expect(exportAESAConfig).toHaveBeenCalledWith(draft))
  })

  it('a valid import asks before replacing anything', async () => {
    importAESAConfig.mockResolvedValue(BUNDLE)
    const { container, onApply } = await renderButtons()
    pickFile(container)
    await waitFor(() =>
      expect(PORTALLED('[data-testid="aesa-config-import-confirm"]')).not.toBeNull())
    // Nothing applied yet — the dialog is the gate.
    expect(onApply).not.toHaveBeenCalled()
  })

  it('cancelling leaves the configuration untouched', async () => {
    importAESAConfig.mockResolvedValue(BUNDLE)
    const { container, onApply } = await renderButtons()
    pickFile(container)
    await waitFor(() =>
      expect(PORTALLED('[data-testid="aesa-config-import-confirm"]')).not.toBeNull())
    fireEvent.click(PORTALLED('[data-testid="aesa-config-confirm-cancel"]')!)
    await waitFor(() =>
      expect(PORTALLED('[data-testid="aesa-config-import-confirm"]')).toBeNull())
    expect(onApply).not.toHaveBeenCalled()
  })

  it('confirming applies the whole bundle', async () => {
    importAESAConfig.mockResolvedValue(BUNDLE)
    const { container, onApply } = await renderButtons()
    pickFile(container)
    await waitFor(() =>
      expect(PORTALLED('[data-testid="aesa-config-import-confirm"]')).not.toBeNull())
    fireEvent.click(PORTALLED('[data-testid="aesa-config-confirm-apply"]')!)
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(BUNDLE))
  })

  it('a rejected import lists every failure and applies nothing', async () => {
    const err = new Error('Import rejected (2 problem(s))') as Error & { errors: unknown[] }
    err.errors = [
      { sheet: 'Configuration', field: 'boundary_set_id', error: "unknown boundary set 'bogus'" },
      { sheet: 'Carbon Budget', field: 'budget_basis', error: 'invalid value' },
    ]
    importAESAConfig.mockRejectedValue(err)
    const { container, onApply } = await renderButtons()
    pickFile(container)
    await waitFor(() =>
      expect(PORTALLED('[data-testid="aesa-config-import-errors"]')).not.toBeNull())
    const text = bodyText()
    expect(text).toContain('boundary_set_id')
    expect(text).toContain('budget_basis')
    expect(text).toContain('Nothing was changed')
    expect(onApply).not.toHaveBeenCalled()
    // no confirm dialog on a rejected import
    expect(PORTALLED('[data-testid="aesa-config-import-confirm"]')).toBeNull()
  })

  it('no longer offers to save a preset half — it would be unreachable', async () => {
    // The option persisted a SharingPreset server-side. With the selector
    // gone, nothing can ever select it again, so offering it would create
    // invisible state.
    importAESAConfig.mockResolvedValue(BUNDLE)
    const { container } = await renderButtons()
    pickFile(container)
    await waitFor(() =>
      expect(PORTALLED('[data-testid="aesa-config-confirm-apply"]')).not.toBeNull())
    expect(PORTALLED('[data-testid="aesa-config-save-preset"]')).toBeNull()
  })

  it('applies the import with a single argument — no save_as_preset', async () => {
    importAESAConfig.mockResolvedValue(BUNDLE)
    const { container } = await renderButtons()
    pickFile(container)
    await waitFor(() =>
      expect(PORTALLED('[data-testid="aesa-config-confirm-apply"]')).not.toBeNull())
    fireEvent.click(PORTALLED('[data-testid="aesa-config-confirm-apply"]')!)
    await waitFor(() => expect(importAESAConfig).toHaveBeenCalled())
    for (const call of importAESAConfig.mock.calls) {
      expect(call.length, 'importAESAConfig must be called with the file alone').toBe(1)
    }
  })
})

// ── the template route is gone, everywhere ──────────────────────────────────

describe('nothing references the removed template endpoint', () => {
  const SRC = resolve(process.cwd(), 'src')

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full, out)
      else if (/\.(ts|tsx)$/.test(name)) out.push(full)
    }
    return out
  }

  it('no client function or route string survives', () => {
    const offenders: string[] = []
    for (const f of walk(SRC)) {
      const src = readFileSync(f, 'utf-8')
      if (/downloadAESAConfigTemplate|aesa\/config\/template/.test(src)) {
        offenders.push(relPosix(SRC, f))
      }
    }
    expect(offenders, 'still reference GET /aesa/config/template, which no '
      + 'longer exists — an export from a fresh draft is the template now')
      .toEqual([])
  })

  it('importAESAConfig no longer accepts a save-as-preset argument', () => {
    // The server still accepts `?save_as_preset=` and that surface is tested
    // backend-side; the client simply stops offering it, because a preset
    // created that way would be unreachable.
    const src = readFileSync(join(SRC, 'api/client.ts'), 'utf-8')
    const body = src.slice(src.indexOf('export async function importAESAConfig'))
      .slice(0, 600)
      // Strip comments: the function documents WHY it stops passing the
      // parameter, and that prose must not read as a breach of the rule.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(body, 'the client must not take or send a save-as-preset argument')
      .not.toMatch(/saveAsPreset|save_as_preset/)
  })
})
