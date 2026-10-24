/* SPDX-License-Identifier: MPL-2.0 */
/**
 * Every in-app link that calls onNavigate('<id>') must name a page App knows.
 * The single-product "Change it in LCA Architect > Manager" link called
 * onNavigate('archetypes') -- an LCA Architect SUB-tab, not a page -- so the
 * content area fell through to the "Select a database" placeholder. The page
 * ids are read from App.tsx's renderPage, not restated here.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(__dirname, '..', 'src')

function pageIds(): Set<string> {
  const app = readFileSync(join(SRC, 'App.tsx'), 'utf8')
  const body = app.slice(app.indexOf('function renderPage'))
  return new Set([...body.matchAll(/activeItem === '([a-z_-]+)'/g)].map((m) => m[1]))
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : []
  })
}

function navigateLiterals(): Array<{ file: string; id: string }> {
  return walk(SRC).flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/onNavigate\??\.?\(\s*['"]([a-z_-]+)['"]\s*\)/g)]
      .map((m) => ({ file: file.slice(SRC.length + 1), id: m[1] })))
}

describe('onNavigate targets are real page ids', () => {
  it('reads the page ids from App.tsx', () => {
    const ids = pageIds()
    for (const id of ['databases', 'lca', 'dsm', 'impact', 'aesa', 'uncertainty', 'settings']) {
      expect(ids.has(id)).toBe(true)
    }
    expect(ids.has('archetypes')).toBe(false)
  })

  it('every onNavigate literal in src names one of them', () => {
    const ids = pageIds()
    const found = navigateLiterals()
    expect(found.length).toBeGreaterThan(3)   // the sweep is not vacuous
    expect(found.filter((f) => f.file.endsWith('SingleProductImpact.tsx')).map((f) => f.id)).toEqual(['lca'])
    const bad = found.filter((f) => !ids.has(f.id))
    expect(bad, bad.map((b) => `${b.file}: onNavigate('${b.id}')`).join('\n')).toEqual([])
  })

  it('the LCA Architect page opens on its Manager tab, where the setting is', () => {
    const page = readFileSync(join(SRC, 'pages', 'LCAPage.tsx'), 'utf8')
    expect(page).toMatch(/useState<LCATab>\('manager'\)/)
  })

  it('the sweep would have caught the old target', () => {
    expect(pageIds().has('archetypes')).toBe(false)
    expect("onNavigate?.('archetypes')".match(/onNavigate\??\.?\(\s*['"]([a-z_-]+)['"]\s*\)/)![1]).toBe('archetypes')
  })
})
