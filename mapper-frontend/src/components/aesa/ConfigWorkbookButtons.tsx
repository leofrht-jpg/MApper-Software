/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { Button } from '../ui/Button'
import {
  downloadAESAConfigTemplate,
  exportAESAConfig,
  importAESAConfig,
  type AESAConfigBundle,
  type AESAConfigImportError,
  type AESAConfiguration,
} from '../../api/client'

/**
 * Template / Export / Import for the WHOLE of AESA section (2).
 *
 * These replace the preset-only trio that used to sit inside the "Sharing
 * preset" collapsible. They now cover the boundary set, method→PB mapping and
 * carbon budget as well, so they belong in the section header and are labelled
 * "configuration", not "preset" — the old labels understated what they touch.
 *
 * Import is destructive to the active configuration, so it goes through an
 * inline confirm dialog. `window.confirm` is a no-op in WKWebView, so the
 * packaged app would silently apply without asking.
 */
export function ConfigWorkbookButtons({
  config,
  onApply,
}: {
  /** The live configuration to export. */
  config: AESAConfiguration
  /** Apply an imported bundle to the active configuration. */
  onApply: (bundle: AESAConfigBundle) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'template' | 'export' | 'import' | null>(null)
  const [pending, setPending] = useState<{ bundle: AESAConfigBundle; filename: string } | null>(null)
  const [errors, setErrors] = useState<AESAConfigImportError[]>([])
  const [savePreset, setSavePreset] = useState(false)
  const [presetName, setPresetName] = useState('')

  const run = async (kind: 'template' | 'export', fn: () => Promise<void>) => {
    setBusy(kind)
    setErrors([])
    try { await fn() } finally { setBusy(null) }
  }

  const handleFile = async (file: File) => {
    setBusy('import')
    setErrors([])
    try {
      // Parse + validate only. Nothing is applied until the user confirms.
      const bundle = await importAESAConfig(file)
      setPresetName(bundle.sharing?.name ?? 'Imported configuration')
      setPending({ bundle, filename: file.name })
    } catch (e) {
      const err = e as Error & { errors?: AESAConfigImportError[] }
      setErrors(err.errors?.length ? err.errors : [{ sheet: '-', field: '-', error: err.message }])
    } finally {
      setBusy(null)
    }
  }

  const confirmApply = async () => {
    if (!pending) return
    setBusy('import')
    try {
      if (savePreset && presetName.trim()) {
        // Re-post so the server persists the preset half. method_mapping is
        // NOT written to it — that field is config-level only.
        const input = fileRef.current?.files?.[0]
        if (input) await importAESAConfig(input, presetName.trim())
      }
      onApply(pending.bundle)
      setPending(null)
      setSavePreset(false)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx"
        data-testid="aesa-config-file-input"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handleFile(f)
          e.target.value = '' // allow re-selecting the same file
        }}
      />

      <Button
        variant="secondary"
        onClick={() => void run('template', downloadAESAConfigTemplate)}
        disabled={busy !== null}
        data-testid="aesa-config-template"
        title="Blank workbook with every configurable field and a Reference sheet of valid values"
      >
        <Download size={14} /> Template
      </Button>

      <Button
        variant="secondary"
        onClick={() => void run('export', () => exportAESAConfig(config))}
        disabled={busy !== null}
        data-testid="aesa-config-export"
        title="Write the current AESA configuration out as .xlsx"
      >
        <Download size={14} /> Export settings
      </Button>

      <Button
        variant="secondary"
        onClick={() => fileRef.current?.click()}
        disabled={busy !== null}
        data-testid="aesa-config-import"
        title="Read a filled workbook back and replace the current configuration"
      >
        <Upload size={14} /> Import settings
      </Button>

      {errors.length > 0 && (
        <div
          data-testid="aesa-config-import-errors"
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            backgroundColor: 'color-mix(in srgb, black 55%, transparent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div style={{
            background: 'var(--bg-surface)', border: '1px solid var(--danger)',
            borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)',
            maxWidth: 620, maxHeight: '70vh', overflow: 'auto',
          }}>
            <h4 style={{ margin: 0, color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>
              Import rejected — nothing was changed
            </h4>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
              The whole workbook is rejected if any field is invalid, so your current
              configuration is untouched. Fix these and try again:
            </p>
            <table style={{ width: '100%', fontSize: 'var(--text-xs)', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={errTh}>Sheet</th><th style={errTh}>Field</th><th style={errTh}>Problem</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((e, i) => (
                  <tr key={i}>
                    <td style={errTd}>{e.sheet}</td>
                    <td style={errTd}>{e.field}</td>
                    <td style={errTd}>{e.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <Button variant="secondary" onClick={() => setErrors([])}>Close</Button>
            </div>
          </div>
        </div>
      )}

      {pending && (
        <div
          data-testid="aesa-config-import-confirm"
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            backgroundColor: 'color-mix(in srgb, black 55%, transparent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)', maxWidth: 560,
          }}>
            <h4 style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
              Replace the current AESA configuration?
            </h4>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              <b>{pending.filename}</b> validated cleanly. Applying it replaces the
              boundary set, method → PB mapping, sharing preset, downscaling chain,
              principles, category assignments and carbon budget of the configuration
              you are editing. Saved sessions are not affected.
            </p>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-xs)' }}>
              <input
                type="checkbox"
                checked={savePreset}
                data-testid="aesa-config-save-preset"
                onChange={(e) => setSavePreset(e.target.checked)}
              />
              Also save the sharing preset half as a reusable template
            </label>
            {savePreset && (
              <input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="Preset name"
                style={{
                  width: '100%', marginTop: 6, height: 28, padding: '0 8px',
                  background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)', color: 'var(--text-primary)',
                  fontSize: 'var(--text-sm)',
                }}
              />
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <Button
                variant="secondary"
                data-testid="aesa-config-confirm-cancel"
                onClick={() => { setPending(null); setSavePreset(false) }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                data-testid="aesa-config-confirm-apply"
                disabled={busy !== null}
                onClick={() => void confirmApply()}
              >
                Replace configuration
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const errTh: React.CSSProperties = {
  textAlign: 'left', padding: '4px 6px', color: 'var(--text-secondary)',
  borderBottom: '1px solid var(--border-subtle)', fontWeight: 600,
}
const errTd: React.CSSProperties = {
  padding: '4px 6px', color: 'var(--text-primary)',
  borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'top',
}
