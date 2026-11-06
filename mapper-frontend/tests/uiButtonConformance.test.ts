// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

/**
 * UI conformance ratchet: buttons follow the templates in components/ui/Button.tsx.
 *
 * It scans mapper-frontend/src for every raw <button> and for every <Button> labelled export,
 * discard, delete, remove or cancel that is not the template variant (see "UI templates" in
 * mapper-frontend/CLAUDE.md). Today's violations are recorded in
 * tests/uiButtonConformance.baseline.json. The test passes while nothing NEW appears and fails,
 * printing the list, for any new violation. Fixing one lowers the count and asks you to refresh
 * the baseline, so the ratchet only ever tightens.
 *
 *   UI_CONFORMANCE_REPORT=1 npx vitest run tests/uiButtonConformance.test.ts   # print every violation
 *   UI_CONFORMANCE_UPDATE=1 npx vitest run tests/uiButtonConformance.test.ts   # rewrite the baseline
 *
 * Source-level: it proves which element and variant are written, not how a button looks.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { countByKey, formatReport, scanFrontend, scanSource } from './helpers/uiConformanceScan'

const dir = dirname(fileURLToPath(import.meta.url))
const root = resolve(dir, '..')
const BASELINE = resolve(dir, 'uiButtonConformance.baseline.json')

const current = scanFrontend(root)
const now = countByKey(current)

if (process.env.UI_CONFORMANCE_UPDATE) writeFileSync(BASELINE, JSON.stringify(now, null, 2) + '\n')
const baseline: Record<string, number> = JSON.parse(readFileSync(BASELINE, 'utf8'))

describe('button conformance ratchet', () => {
  it('prints the list on request', () => {
    if (process.env.UI_CONFORMANCE_REPORT) process.stdout.write(`${formatReport(current)}\n`)
    expect(current.length).toBeGreaterThan(0)
  })

  it('no NEW button outside the templates', () => {
    const fresh = current.filter((v) => (now[v.key] ?? 0) > (baseline[v.key] ?? 0))
    const unique = [...new Map(fresh.map((v) => [v.key, v])).values()]
    const msg = unique.map((v) => `  ${v.file}:${v.line}  ${v.detail}`).join('\n')
    expect(unique, `New buttons outside the UI templates (use components/ui/Button.tsx with the template variant; ` +
      `icon-only controls get an aria-label and the Button primitive):\n${msg}`).toEqual([])
  })

  it('the baseline only shrinks: a fixed violation must be removed from it', () => {
    const stale = Object.keys(baseline).filter((k) => (now[k] ?? 0) < baseline[k])
    expect(stale, `These baseline entries no longer occur (good). Refresh with UI_CONFORMANCE_UPDATE=1:\n  ${stale.join('\n  ')}`).toEqual([])
  })

  it('the baseline covers every kind and is not empty by accident', () => {
    const kinds = new Set(current.map((v) => v.kind))
    expect(kinds).toEqual(new Set(['raw-button-labelled', 'template-variant', 'raw-button']))
  })
})

describe('the scanner itself catches each kind (anti-vacuity)', () => {
  const scan = (src: string) => scanSource('src/x.tsx', src)

  it('a raw <button> labelled Delete is raw-button-labelled', () => {
    const v = scan('const a = <button onClick={f}>Delete</button>')
    expect(v.map((x) => x.kind)).toEqual(['raw-button-labelled'])
  })
  it('an icon-only raw <button> is a raw-button', () => {
    expect(scan('<button aria-label="Close" onClick={f}><X /></button>').map((x) => x.kind)).toEqual(['raw-button'])
  })
  it('<Button> Discard/Delete/Remove must be danger; ghost is flagged, danger passes', () => {
    expect(scan('<Button variant="ghost" onClick={f}>Discard</Button>').map((x) => x.kind)).toEqual(['template-variant'])
    expect(scan('<Button onClick={f}>Delete</Button>').map((x) => x.kind)).toEqual(['template-variant'])
    expect(scan('<Button variant="danger" onClick={f}>Remove key</Button>')).toEqual([])
  })
  it('red text hand-set on a secondary Delete is flagged', () => {
    expect(scan('<Button variant="secondary" style={{ color: "var(--danger)" }}>Delete x</Button>')).toHaveLength(1)
  })
  it('Cancel is ghost: secondary is flagged', () => {
    expect(scan('<Button variant="secondary" onClick={f}>Cancel</Button>')).toHaveLength(1)
    expect(scan('<Button variant="ghost" onClick={f}>Cancel</Button>')).toEqual([])
  })
  it('Export is secondary with the download icon', () => {
    expect(scan('<Button variant="secondary"><Download size={14} /> Export to Excel</Button>')).toEqual([])
    expect(scan('<Button variant="secondary">Export to Excel</Button>')).toHaveLength(1)
    expect(scan('<Button variant="primary"><Download size={14} /> Export</Button>')).toHaveLength(1)
  })
  it('a conditional variant that names the template passes', () => {
    expect(scan("<Button variant={o.destructive ? 'danger' : 'primary'}>{o.destructive ? 'Delete' : 'OK'}</Button>")).toEqual([])
  })
  it('a label word buried in a sentence is not a template button', () => {
    expect(scan('<button>Importing… Or restore from a previous export</button>').map((x) => x.kind)).toEqual(['raw-button'])
  })
  it('an arrow function in an attribute does not end the tag early', () => {
    const v = scan('<Button variant="ghost" onClick={() => setX((p) => p > 1)}>Delete</Button>')
    expect(v.map((x) => x.kind)).toEqual(['template-variant'])
  })
})
