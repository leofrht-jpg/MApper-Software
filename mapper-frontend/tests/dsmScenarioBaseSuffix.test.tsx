/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { PairListEditor } from '../src/components/impact/ProjectedImpactPanel'

// Patch 4AB — "(base)" parenthetical suffix removed from DSM
// scenario displays across MApper. The is_base data flag is
// preserved (still drives inheritance / management UI badges in
// ScenarioManagerModal etc.), but visible scenario name strings
// don't append the suffix.
//
// Three call sites covered by the audit-and-fix-all:
//   - PairListEditor `<option>{d.name}{d.is_base ? ' (base)' : ''}</option>`
//   - DSMDashboard editing-scenario radio label `{scen.name}{scen.is_base ? ' (Base)' : ''}`
//   - DSMDashboard multi-select compute chip label (same pattern)
//
// Kept (per spec):
//   - Sensitivity Cases checklist's "Base" label (parameter set,
//     methodologically distinct from DSM scenario base)
//   - Standalone "Base" badge pills in DSMScenariosChip /
//     DSMScenarioChip / ScenarioManagerModal (visually-discrete
//     pill, not a name-string suffix)
//   - Hover tooltips like title="Base scenario · …"
//   - Fallback `?? 'Base'` strings when no scenario name found

beforeEach(() => {
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
})

// Audit-and-fix-all discipline (Patch 4AB): static source grep
// asserts the deleted suffix-construction patterns aren't anywhere
// in the rendering codebase. Catches sneaky re-additions: someone
// adds a new DSM-scenario list view and reflexively types
// `{name}{is_base ? ' (base)' : ''}` based on a copy from
// elsewhere — this test fails before the new code ships.
describe('source-level invariant: no "(base)" / "(Base)" suffix construction', () => {
  it('no DSM-scenario render site appends "(base)" or "(Base)" to scenario names', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const srcDir = path.resolve(__dirname, '../src')

    // Walk the src tree collecting .tsx / .ts contents.
    const collectFiles = async (dir: string): Promise<string[]> => {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      const out: string[] = []
      for (const ent of entries) {
        const full = path.join(dir, ent.name)
        if (ent.isDirectory()) out.push(...await collectFiles(full))
        else if (ent.isFile() && (full.endsWith('.tsx') || full.endsWith('.ts'))) out.push(full)
      }
      return out
    }
    const files = await collectFiles(srcDir)

    // Regex matches the deleted patterns:
    //   `is_base ? ' (base)' :`  /  `is_base ? ' (Base)' :`
    //   Variants tolerate whitespace and quote style.
    const pattern = /is_base\s*\?\s*['"]\s*\(\s*[Bb]ase\s*\)\s*['"]\s*:/
    const offenders: string[] = []
    for (const f of files) {
      const text = await fs.readFile(f, 'utf-8')
      if (pattern.test(text)) {
        const rel = path.relative(srcDir, f)
        offenders.push(rel)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('PairListEditor — no "(base)" suffix on DSM scenario options', () => {
  it('renders SSP2 base scenario without " (base)" suffix in the option text', () => {
    const dsmScenarios = [
      { id: 'ssp1', name: 'SSP1', is_base: false },
      { id: 'ssp2', name: 'SSP2', is_base: true },   // ← the suffix-getter
      { id: 'ssp5', name: 'SSP5', is_base: false },
    ]
    const { container } = render(
      <PairListEditor
        pairs={[{ dsm_scenario_id: 'ssp2', lci_scenario: { base_db: '', iam: '', ssp: '' } }]}
        onChange={() => {}}
        dsmScenarios={dsmScenarios}
        lciScenarios={[]}
        duplicateKeys={new Set()}
      />,
    )
    const select = container.querySelector('select[aria-label^="DSM scenario for pair"]') as HTMLSelectElement
    expect(select).not.toBeNull()
    const optionTexts = Array.from(select.options).map((o) => o.textContent ?? '')
    // The pre-Patch-4AB shape: 'SSP2 (base)'. Post-Patch-4AB: 'SSP2'.
    expect(optionTexts).toContain('SSP2')
    for (const text of optionTexts) {
      expect(text).not.toContain('(base)')
      expect(text).not.toContain('(Base)')
    }
  })

  it('preserves is_base data on the option element via the value attribute', () => {
    // is_base is data, not display. The option's `value` is the
    // scenario id (unaffected); the display text is the bare name.
    // Locked in so a future refactor doesn't drop the underlying
    // data thinking the suffix removal made it dead.
    const dsmScenarios = [
      { id: 'base', name: 'Base scenario', is_base: true },
    ]
    const { container } = render(
      <PairListEditor
        pairs={[{ dsm_scenario_id: 'base', lci_scenario: { base_db: '', iam: '', ssp: '' } }]}
        onChange={() => {}}
        dsmScenarios={dsmScenarios}
        lciScenarios={[]}
        duplicateKeys={new Set()}
      />,
    )
    const select = container.querySelector('select[aria-label^="DSM scenario for pair"]') as HTMLSelectElement
    // The option's value is still 'base' — data preserved.
    const baseOption = Array.from(select.options).find((o) => o.value === 'base')
    expect(baseOption).not.toBeNull()
    // Display text is the bare name — no suffix.
    expect(baseOption?.textContent).toBe('Base scenario')
  })
})
