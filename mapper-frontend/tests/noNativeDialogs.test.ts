// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

/**
 * No window.confirm / prompt / alert anywhere under src.
 *
 * The packaged app is a WKWebView with no dialog delegate: confirm() answers
 * false, prompt() returns null and alert() shows nothing. 65 native calls had
 * shipped: deletes that never happened, names that could not be entered,
 * failures that showed nothing. src/components/ui/dialogs.tsx replaces them.
 *
 * The guard is absolute: there is no allow-list. Every file under src is
 * scanned (so a call in a new file fails here) and any native call fails,
 * except in components/ui/dialogs.tsx, the module that owns dialog UI.
 */
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { relPosix } from './helpers/relPosix'
import { stripComments } from './helpers/stripComments'

const SRC = path.resolve(__dirname, '../src')

/** The one module allowed to own dialog UI (it calls no native dialog either). */
const EXEMPT = new Set(['components/ui/dialogs.tsx'])

const CALL = /(?<![\w.$])(?:(?:window|globalThis|self)\s*\.\s*)?(?:confirm|prompt|alert)\s*\(/g
// A native dialog passed around or indexed instead of called directly.
const REF = /(?<![\w.$])(?:window|globalThis|self)\s*(?:\.\s*(?:confirm|prompt|alert)\b(?!\s*\()|\[\s*['"`](?:confirm|prompt|alert)['"`]\s*\])/g

/** Every native dialog use in a source text, as "file:line". */
export function nativeDialogs(name: string, source: string): string[] {
  const s = stripComments(source)
  const lineOf = (i: number) => s.slice(0, i).split('\n').length
  const hits: number[] = []
  for (const m of s.matchAll(CALL)) hits.push(m.index!)
  for (const m of s.matchAll(REF)) hits.push(m.index!)
  return hits.sort((a, b) => a - b).map((i) => `${name}:${lineOf(i)}`)
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...sourceFiles(p))
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
  }
  return out
}

/** Every native dialog use under src, outside EXEMPT, as "file:line". */
function allNativeDialogs(): string[] {
  const hits: string[] = []
  for (const f of sourceFiles(SRC)) {
    const rel = relPosix(SRC, f)
    if (EXEMPT.has(rel)) continue
    hits.push(...nativeDialogs(rel, fs.readFileSync(f, 'utf8')))
  }
  return hits
}

describe('no native dialogs under src', () => {
  it('no native confirm, prompt or alert anywhere under src', () => {
    expect(allNativeDialogs(), 'use confirmDialog / promptDialog / choose / messageDialog / notify from components/ui/dialogs').toEqual([])
  })

  it('the scan really walks src (so [] above is not an empty walk)', () => {
    const files = sourceFiles(SRC).map((f) => relPosix(SRC, f))
    expect(files.length).toBeGreaterThan(100)
    for (const f of ['App.tsx', 'pages/Archetypes.tsx', 'components/ui/dialogs.tsx']) expect(files).toContain(f)
  })

  it('the dialog module itself calls no native dialog', () => {
    const f = 'components/ui/dialogs.tsx'
    expect(nativeDialogs(f, fs.readFileSync(path.join(SRC, f), 'utf8'))).toEqual([])
  })

  it('App mounts one DialogHost, after <Shell> and so outside the per-tab ErrorBoundary', () => {
    const app = stripComments(fs.readFileSync(path.join(SRC, 'App.tsx'), 'utf8'))
    expect(app.match(/<DialogHost\s*\/>/g)).toHaveLength(1)
    expect(app.indexOf('<DialogHost')).toBeGreaterThan(app.indexOf('</Shell>'))
  })

  it('the scanner flags the shapes that shipped', () => {
    // Anti-vacuity: [] above must mean "none left", not "stopped matching".
    const src = [
      "if (!confirm('Delete?')) return",
      "const name = window.prompt('New scenario name:')",
      "onClick={() => { if (confirm(`Delete ${n}?`)) onDelete() }}",
      'alert(',
      "  'multi-line',",
      ')',
      "catch((e) => alert(e))",
      "globalThis.alert('x')",
      'const ask = window.confirm',
      "window['alert']('x')",
      "const ok = window . confirm ('spaced')",
    ].join('\n')
    expect(nativeDialogs('f.ts', src)).toEqual([
      'f.ts:1', 'f.ts:2', 'f.ts:3', 'f.ts:4', 'f.ts:7', 'f.ts:8', 'f.ts:9', 'f.ts:10', 'f.ts:11',
    ])
  })

  it('the scanner ignores the helpers, look-alike names and comments', () => {
    const src = [
      "if (!(await confirmDialog({ title: 'x' }))) return",
      'onConfirm(); handleConfirm(); setConfirmReset(true)',
      'dialog.confirm(); store.alert(); self.prompting = 1',
      "// a comment saying confirm('x') was the old way",
      "/* window.alert('x') */",
      "await promptDialog('x'); await messageDialog('x'); notify('x')",
    ].join('\n')
    expect(nativeDialogs('f.ts', src)).toEqual([])
  })
})
