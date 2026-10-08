/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/**
 * A string body is JSON, and `fetch` will not say so unless asked.
 *
 * Found walking v0.3.0 by hand: the whole authoring UI was dead — in `npm run
 * dev` as much as in the packaged app, because `fetch` behaves the same in
 * both. Settings › Logs showed 422 `model_attributes_type` —
 * "Input should be a valid dictionary or object to extract fields from" — with
 * the request body quoted back AS A STRING. That reads like a schema bug. It
 * was five call sites sending `JSON.stringify(...)` with no
 * `Content-Type: application/json`, so Starlette handed FastAPI raw text and
 * every model-bodied route rejected it.
 *
 * Two tests, because one alone is vacuous:
 *
 *  - BEHAVIOURAL: drive the REAL exported client functions through the REAL
 *    `request()` with a spy on `fetch`. Mocking `request` would assert nothing
 *    about the thing that was broken.
 *  - STRUCTURAL: a source scan, so a NEW raw `fetch` with a string body and no
 *    header fails here instead of shipping. Discovery, not a hand-kept list —
 *    the five that broke were a contiguous block someone added together, and
 *    the next block will be too.
 */
import fs from 'node:fs'
import path from 'node:path'

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import * as client from '../src/api/client'

const CLIENT = path.resolve(__dirname, '../src/api/client.ts')

function okJson(body: unknown = {}) {
  return {
    ok: true, status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchSpy = vi.fn(async () => okJson({}))
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => vi.unstubAllGlobals())

/** The Content-Type the spy actually saw, however the init built its headers. */
function sentContentType(call: unknown[]): string | null {
  const init = call[1] as RequestInit | undefined
  if (!init?.headers) return null
  return new Headers(init.headers).get('Content-Type')
}

// ── Behavioural: the five routes that were dead, through the real request() ──

const AUTHORED: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
  ['createAuthoredDatabase', () => client.createAuthoredDatabase('db', 'desc')],
  ['addAuthoredActivity', () => client.addAuthoredActivity('db', { name: 'a' } as never)],
  ['updateAuthoredActivity', () => client.updateAuthoredActivity('db', 'code', { name: 'a' } as never)],
  ['fetchReachedIndicators', () => client.fetchReachedIndicators([{ database: 'b', code: 'c' }])],
  ['previewAuthoredExchange', () => client.previewAuthoredExchange({ flow_database: 'b' } as never)],
]

describe('the authored-database routes send JSON as JSON', () => {
  for (const [name, call] of AUTHORED) {
    it(`${name} sets Content-Type: application/json`, async () => {
      await call()
      expect(fetchSpy).toHaveBeenCalledOnce()
      const args = fetchSpy.mock.calls[0]
      expect(typeof (args[1] as RequestInit).body,
        'fixture no longer sends a string body, so it cannot test this').toBe('string')
      expect(sentContentType(args), `${name} sent a string body with no Content-Type`)
        .toBe('application/json')
    })
  }
})

describe('the rule is about STRING bodies only', () => {
  it('leaves a FormData body alone, so the browser can set the boundary', async () => {
    // importDSMSystem posts FormData through the same header builder.
    await client.importDSMSystem(new File(['x'], 'x.xlsx')).catch(() => undefined)
    const args = fetchSpy.mock.calls[0]
    expect(sentContentType(args),
      'a multipart body must NOT be labelled application/json').not.toBe('application/json')
  })

  it("does not override a caller's own Content-Type", async () => {
    // A caller that already sets the header keeps it; the rule only fills gaps.
    await client.createProject('p')
    const args = fetchSpy.mock.calls[0]
    expect(sentContentType(args)).toBe('application/json')
  })

  it('still sends the project header alongside it', async () => {
    client.configureProjectGuard(() => 'MAp-test', () => {})
    await client.createAuthoredDatabase('db', 'd')
    const init = fetchSpy.mock.calls[0][1] as RequestInit
    const h = new Headers(init.headers)
    expect(h.get('X-Mapper-Project')).toBe('MAp-test')
    expect(h.get('Content-Type')).toBe('application/json')
    client.configureProjectGuard(() => null, () => {})
  })
})

// ── Structural: no NEW caller may send a string body bare ────────────────────

/**
 * Every site in client.ts that sends a string body, and how it gets a header.
 *
 * A site is compliant when it either sets Content-Type in its own options
 * object, or goes through `request()` / `_withProjectHeader()` — the one place
 * that now fills it in. Anything else is a raw `fetch` that will be handed to
 * the backend as text.
 */
function nonCompliantStringBodies(file: string = CLIENT): string[] {
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  const bad: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!/body:\s*(JSON\.stringify|['"`])/.test(lines[i])) continue
    let start = Math.max(0, i - 25)
    for (let j = i; j >= Math.max(0, i - 25); j--) {
      if (/\b(request|fetch|_withProjectHeader)\s*[<(]/.test(lines[j])) { start = j; break }
    }
    let end = i
    for (let j = i; j < Math.min(lines.length, i + 12); j++) {
      end = j
      if (/^\s*\}\)/.test(lines[j])) break
    }
    const block = lines.slice(start, end + 1).join('\n')
    const viaChokepoint = /\b(request\s*[<(]|_withProjectHeader\s*\()/.test(block)
    if (!/content-type/i.test(block) && !viaChokepoint) {
      let fn = '<unknown>'
      for (let j = start; j >= Math.max(0, start - 30); j--) {
        const m = /export async function (\w+)/.exec(lines[j])
        if (m) { fn = m[1]; break }
      }
      bad.push(`${path.basename(file)}:${i + 1} ${fn}`)
    }
  }
  return bad
}

describe('no client function sends a string body bare', () => {
  it('every string-body site sets the header or routes through the chokepoint', () => {
    expect(nonCompliantStringBodies(),
      'a raw fetch sends JSON as text; it will 422 with model_attributes_type')
      .toEqual([])
  })

  it('the scanner can actually find a violation', () => {
    // Anti-vacuity, run through the REAL scanner rather than a re-implementation
    // of it: [] above must mean "none left", not "the pattern stopped matching".
    // Narrowing nonCompliantStringBodies now fails HERE instead of silently
    // shrinking coverage.
    const bare = [
      'export async function broken(x: unknown) {',
      '  const res = await fetch(`${API_BASE}/x`, {',
      "    method: 'POST',",
      '    body: JSON.stringify(x),',
      '  })',
      '  return res.json()',
      '}',
    ].join('\n')
    const tmp = path.join(__dirname, '_scanfixture.ts.txt')
    fs.writeFileSync(tmp, bare)
    try {
      expect(nonCompliantStringBodies(tmp),
        'the detector no longer recognises the exact shape of the bug it exists for')
        .toEqual(['_scanfixture.ts.txt:4 broken'])
    } finally {
      fs.unlinkSync(tmp)
    }
  })

  it('the scanner does NOT flag the fixed form — it would cry wolf', () => {
    const fixed = [
      'export async function mended(x: unknown) {',
      '  const res = await fetch(`${API_BASE}/x`, {',
      "    method: 'POST',",
      "    headers: { 'Content-Type': 'application/json' },",
      '    body: JSON.stringify(x),',
      '  })',
      '  return res.json()',
      '}',
    ].join('\n')
    const tmp = path.join(__dirname, '_scanfixture_ok.ts.txt')
    fs.writeFileSync(tmp, fixed)
    try {
      expect(nonCompliantStringBodies(tmp)).toEqual([])
    } finally {
      fs.unlinkSync(tmp)
    }
  })
})
