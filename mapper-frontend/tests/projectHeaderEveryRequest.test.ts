/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/**
 * Every request to the backend carries `X-Mapper-Project`.
 *
 * The backend's project guard can only refuse a write aimed at the wrong
 * project if the request says which project it means. `request()` and
 * `uploadFile()` always sent the header, but 46 direct `fetch` calls in
 * client.ts did not: imports (BOM, parameters, cohort mappings, AESA config),
 * pLCA generate/delete, impact calculate, every Excel export. A request with
 * no header is not checked at all.
 *
 *  - STRUCTURAL: every `fetch(` under src/ is in client.ts and passes its
 *    options through `_withProjectHeader(`. No XMLHttpRequest, no axios. Found
 *    by scanning, so a new direct call fails here.
 *  - BEHAVIOURAL: functions that used to skip the header, driven for real
 *    with a spy on `fetch`, send it, and blob downloads still get a blob.
 */
import fs from 'node:fs'
import path from 'node:path'

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import * as client from '../src/api/client'

const SRC = path.resolve(__dirname, '../src')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...sourceFiles(p))
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
  }
  return out
}

/** Index just past the `)` that closes the `(` at `open`, skipping strings. */
function closeParen(s: string, open: number): number {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    const c = s[i]
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < s.length && s[i] !== c; i++) {
        if (s[i] === '\\') i++
        else if (c === '`' && s[i] === '$' && s[i + 1] === '{') {
          let d = 1
          for (i += 2; d > 0; i++) { if (s[i] === '{') d++; else if (s[i] === '}') d-- }
          i--
        }
      }
    } else if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) return i + 1 }
  }
  return s.length
}

/** Strip comments so prose that mentions fetch( is not counted. */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, (m, p) => p + ' '.repeat(m.length - p.length))
}

/** Every direct call that bypasses the project header, as "file:line". */
export function bareRequests(name: string, source: string): string[] {
  const s = stripComments(source)
  const bad: string[] = []
  const lineOf = (i: number) => s.slice(0, i).split('\n').length
  for (const m of s.matchAll(/(?<![\w.$])fetch\s*\(/g)) {
    const open = m.index! + m[0].length - 1
    const call = s.slice(m.index!, closeParen(s, open))
    if (!/_withProjectHeader\s*\(/.test(call)) bad.push(`${name}:${lineOf(m.index!)}`)
  }
  for (const m of s.matchAll(/\bnew\s+XMLHttpRequest\b|\baxios\b/g)) bad.push(`${name}:${lineOf(m.index!)}`)
  return bad
}

describe('no request bypasses the project header', () => {
  it('every fetch under src/ goes through _withProjectHeader', () => {
    const bad = sourceFiles(SRC).flatMap((f) =>
      bareRequests(path.relative(SRC, f), fs.readFileSync(f, 'utf8')))
    expect(bad, 'route these through request()/uploadFile() or wrap the options in _withProjectHeader()')
      .toEqual([])
  })

  it('fetch is only called from the API client', () => {
    const outside = sourceFiles(SRC)
      .filter((f) => !f.endsWith(path.join('api', 'client.ts')))
      .filter((f) => /(?<![\w.$])fetch\s*\(/.test(stripComments(fs.readFileSync(f, 'utf8'))))
      .map((f) => path.relative(SRC, f))
    expect(outside, 'call the backend through src/api/client.ts').toEqual([])
  })

  it('the scanner flags the shapes that shipped', () => {
    // Anti-vacuity: [] above must mean "none left", not "stopped matching".
    const src = [
      'const a = await fetch(`${API_BASE}/bom/template`)',
      'const b = await fetch(`${API_BASE}/x`, { method: "DELETE" })',
      'const c = await fetch(url)',
      'const d = await fetch(',
      '  `${API_BASE}/y`,',
      '  { method: "POST", body: form },',
      ')',
      'const x = new XMLHttpRequest()',
    ].join('\n')
    expect(bareRequests('f.ts', src)).toEqual(['f.ts:1', 'f.ts:2', 'f.ts:3', 'f.ts:4', 'f.ts:8'])
  })

  it('the scanner accepts the fixed forms and ignores comments and fetchX names', () => {
    const src = [
      '// a comment saying fetch(url) is fine',
      'const a = await fetch(`${API_BASE}/x`, _withProjectHeader())',
      'const b = await fetch(`${API_BASE}/x?a=${f(1)}`, _withProjectHeader({ method: "POST" }))',
      'await fetchProjects(); store.fetchArchetypes()',
    ].join('\n')
    expect(bareRequests('f.ts', src)).toEqual([])
  })
})

// ── Behavioural ──────────────────────────────────────────────────────────────

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchSpy = vi.fn(async () => ({
    ok: true, status: 200, headers: new Headers(),
    json: async () => ({}), text: async () => '{}', blob: async () => new Blob(['x']),
  }) as unknown as Response)
  vi.stubGlobal('fetch', fetchSpy)
  client.configureProjectGuard(() => 'MAp-test', () => {})
  // jsdom has no object URLs; the blob path calls them.
  URL.createObjectURL = vi.fn(() => 'blob:x') as never
  URL.revokeObjectURL = vi.fn() as never
})
afterEach(() => {
  client.configureProjectGuard(() => null, () => {})
  vi.unstubAllGlobals()
})

const file = () => new File(['x'], 'x.xlsx')

// Formerly direct calls: writes first, then reads/downloads.
const CALLS: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
  ['importArchetype', () => client.importArchetype(file(), 'merge')],
  ['importParameterTable', () => client.importParameterTable(file(), 'merge')],
  ['uploadCohortMappings', () => client.uploadCohortMappings('sys', file())],
  ['importAESAConfig', () => client.importAESAConfig(file())],
  ['deletePLCADatabase', () => client.deletePLCADatabase('db')],
  ['deleteAESASession', () => client.deleteAESASession('s')],
  ['cancelTask', () => client.cancelTask('t')],
  ['exportArchetype', () => client.exportArchetype('a', 'a.xlsx')],
  ['downloadBOMTemplate', () => client.downloadBOMTemplate()],
  ['getPLCADatabases', () => client.getPLCADatabases()],
]

describe('formerly direct calls send the project header', () => {
  for (const [name, call] of CALLS) {
    it(name, async () => {
      await call().catch(() => undefined) // response shape is not what is under test
      expect(fetchSpy, `${name} made no request`).toHaveBeenCalled()
      const init = fetchSpy.mock.calls[0][1] as RequestInit | undefined
      expect(new Headers(init?.headers).get('X-Mapper-Project'), `${name} sent no project header`)
        .toBe('MAp-test')
    })
  }

  it('a FormData upload keeps its body and gets no JSON Content-Type', async () => {
    await client.importArchetype(file(), 'merge').catch(() => undefined)
    const init = fetchSpy.mock.calls[0][1] as RequestInit
    expect(init.body).toBeInstanceOf(FormData)
    expect(new Headers(init.headers).get('Content-Type')).toBeNull()
  })

  it('a blob download still saves through an object URL', async () => {
    await client.exportArchetype('a', 'a.xlsx')
    expect(URL.createObjectURL).toHaveBeenCalled()
  })
})
