/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { SearchInput } from '../src/components/ui/SearchInput'
import { NumberInput } from '../src/components/ui/NumberInput'
import { IDENTIFIER_INPUT_PROPS } from '../src/components/ui/identifierInput'
import { ComputeOverlay, OVERLAY_REVEAL_MS, StopWaitingNote } from '../src/components/ui/ComputeOverlay'
import { InfoButton } from '../src/components/ui/InfoButton'
import { computePopoverPosition, popoverWidth } from '../src/components/ui/popoverPosition'
import { YEARS_LOCKED_TOOLTIP } from '../src/components/impact/yearsLock'
import {
  StageAmountsEditor, YearsInput, canApplyLifetime, defaultStageAmounts, stageAmountsForPreset,
} from '../src/components/impact/StageAmountsEditor'
import { ABOUT_LIMIT, aboutLength, firstSentence, methodAbout } from '../src/components/impact/methodAbout'
import type { ArchetypeSummary } from '../src/api/client'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

const SRC = path.resolve(__dirname, '../src')
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8')

// ── 1. No suggestion bubble on search, filter, code and numeric fields ────────

function expectNoBubble(el: HTMLElement) {
  expect(el.getAttribute('autocomplete')).toBe('off')
  expect(el.getAttribute('autocorrect')).toBe('off')
  expect(el.getAttribute('autocapitalize')).toBe('off')
  expect(el.getAttribute('spellcheck')).toBe('false')
}

describe('search, filter, code and numeric fields switch the suggestion bubble off', () => {
  it('the shared constant carries all four attributes', () => {
    expect(IDENTIFIER_INPUT_PROPS).toEqual({ autoComplete: 'off', autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false })
  })

  it('SearchInput (the Settings search and every other search box that uses it)', () => {
    render(<SearchInput value="" onChange={() => {}} data-testid="s" />)
    expectNoBubble(screen.getByTestId('s'))
  })

  it('NumberInput (every numeric field that uses it)', () => {
    render(<NumberInput value={1} onChange={() => {}} data-testid="n" />)
    expectNoBubble(screen.getByTestId('n'))
  })

  it('YearsInput, locked and unlocked', () => {
    const { rerender } = render(<YearsInput value={null} onChange={() => {}} testId="y" />)
    expectNoBubble(screen.getByTestId('y'))
    rerender(<YearsInput value={null} onChange={() => {}} testId="y" disabled lockedTitle="x" />)
    expectNoBubble(screen.getByTestId('y'))
  })

  it('a caller can still override an attribute', () => {
    render(<SearchInput value="" onChange={() => {}} data-testid="s" autoCapitalize="words" />)
    expect(screen.getByTestId('s').getAttribute('autocapitalize')).toBe('words')
  })

  // Inputs spread by hand; free text (names, descriptions, comments) deliberately does not.
  it.each([
    ['components/ImportWizard.tsx', 3], ['components/PremiseKeyManager.tsx', 1], ['components/ProjectSwitcher.tsx', 1],
    ['components/aesa/LayerEditModal.tsx', 4], ['components/authored/AuthoredActivityEditor.tsx', 2],
    ['components/authored/BiosphereFlowPicker.tsx', 1], ['components/bom/BOMTree.tsx', 1], ['components/bom/EcoinventLinker.tsx', 1],
    ['components/dsm/EditSystemModal.tsx', 3], ['components/dsm/ModeConfigurator.tsx', 1], ['components/dsm/ScalingRulesEditor.tsx', 2],
    ['components/dsm/SurvivalConfigurator.tsx', 1], ['components/dsm/SystemCreator.tsx', 2], ['components/dsm/UnitTypePicker.tsx', 1],
    ['components/impact/CohortMappingEditor.tsx', 1], ['components/impact/DependentCohortMappingsPanel.tsx', 1],
    ['components/impact/MethodLibrary.tsx', 2], ['components/impact/StageAmountsEditor.tsx', 1], ['components/parameters/KeyframeEditor.tsx', 2],
    ['components/parameters/ParameterManagerPanel.tsx', 8], ['components/shared/MultiItemSelector.tsx', 1],
    ['components/subsystems/EditSubsystemModal.tsx', 1], ['components/subsystems/DependencyRulesEditor.tsx', 1],
    ['components/ui/DimensionColorPicker.tsx', 1], ['components/ui/FilterDropdown.tsx', 1], ['components/uncertainty/MaterialPedigreeTable.tsx', 1],
    ['components/uncertainty/PedigreeEditor.tsx', 1], ['pages/LCAManager.tsx', 1], ['pages/MonteCarlo.tsx', 2], ['pages/SettingsPage.tsx', 1],
  ])('%s spreads the props on %i field(s)', (rel, n) => {
    const hits = read(rel).match(/<(input|textarea) \{\.\.\.IDENTIFIER_INPUT_PROPS\}/g) ?? []
    expect(hits.length).toBeGreaterThanOrEqual(n)
  })

  it('free-text fields keep normal capitalisation: names and descriptions are not spread', () => {
    expect(read('components/authored/AuthoredActivityEditor.tsx')).toMatch(/<input data-testid="authored-name"/)
    expect(read('components/authored/AuthoredActivityEditor.tsx')).toMatch(/<textarea data-testid="authored-comment"/)
    expect(read('components/dsm/SystemCreator.tsx')).toMatch(/<input type="text" value=\{name\}/)
  })
})

// ── 2. The note under "Stop waiting" is two block lines ───────────────────────

describe('the note under Stop waiting', () => {
  it('is two sentences, the first ending with a dot, each in its own block', async () => {
    vi.useFakeTimers()
    render(<ComputeOverlay active title="t" onCancel={() => {}} cancelNote={StopWaitingNote()} data-testid="o" />)
    await act(async () => { vi.advanceTimersByTime(OVERLAY_REVEAL_MS + 10) })
    const note = screen.getByTestId('o-cancel-note')
    const lines = Array.from(note.children)
    expect(lines.map((l) => l.tagName)).toEqual(['DIV', 'DIV'])
    expect(lines.map((l) => l.textContent)).toEqual(['The calculation may keep running in the background.', 'The next one can take longer.'])
    expect(note.textContent).not.toContain(';')
    expect(note.textContent).not.toContain('\n')
    expect((lines[0].textContent ?? '').endsWith('.')).toBe(true)
  })

  it.each([
    ['components/impact/MultiProductLCA.tsx', 1], ['components/impact/SingleProductStaticPanel.tsx', 1],
    ['components/impact/SingleProductProjectedPanel.tsx', 1], ['pages/LCACalculator.tsx', 2],
  ])('%s passes the shared note, never its own string (%i overlay(s))', (rel, n) => {
    const src = read(rel)
    expect((src.match(/cancelNote=\{StopWaitingNote\(\)\}/g) ?? []).length).toBe(n)
    expect(src).not.toMatch(/cancelNote=["'`]/)
  })
})

// ── 3. The (i) popover: constant width, capped height ─────────────────────────

describe('popover geometry (pure)', () => {
  const VP = { width: 1000, height: 700 }
  const anchor = (left: number, top: number) => ({ left, top, right: left + 18, bottom: top + 18 })

  it('the width is min(306, window - margins) wherever the anchor is', () => {
    const widths = [[2, 2], [500, 300], [990, 690], [300, 650]].map(([l, t]) => computePopoverPosition(anchor(l, t), { width: 306, height: 90 }, VP).width)
    expect(new Set(widths)).toEqual(new Set([306]))
    expect(popoverWidth(306, 200)).toBe(184)
    expect(computePopoverPosition(anchor(150, 200), { width: 306, height: 90 }, { width: 200, height: 700 }).width).toBe(184)
  })

  it('the height cap is the window minus both margins, and a tall popover is clamped inside the window', () => {
    const p = computePopoverPosition(anchor(300, 400), { width: 306, height: 2000 }, VP)
    expect(p.maxHeight).toBe(684)
    expect(p.top).toBe(8)
    expect(p.top + Math.min(2000, p.maxHeight)).toBeLessThanOrEqual(692)
  })

  it('a popover that fits keeps below/above placement and is never cut by an edge', () => {
    for (const [l, t] of [[300, 10], [300, 340], [300, 690], [990, 690], [2, 2]]) {
      const p = computePopoverPosition(anchor(l, t), { width: 306, height: 300 }, VP)
      expect(p.top).toBeGreaterThanOrEqual(8)
      expect(p.top + 300).toBeLessThanOrEqual(692)
      expect(p.left).toBeGreaterThanOrEqual(8)
      expect(p.left + p.width).toBeLessThanOrEqual(992)
    }
  })
})

describe('<InfoButton> keeps its box while the page scrolls (mocked layout)', () => {
  let btnTop = 200
  function mount(naturalHeight: number, win = { width: 1000, height: 700 }) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: win.width })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: win.height })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const rect = (l: number, t: number, w: number, h: number) => ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h, x: l, y: t, toJSON: () => ({}) }) as DOMRect
      if (this.tagName === 'BUTTON') return rect(300, btnTop, 18, 18)
      if (this.getAttribute('role') === 'note') {
        const w = parseFloat(this.style.width) || 306
        const cap = this.style.maxHeight ? parseFloat(this.style.maxHeight) : Infinity
        return rect(parseFloat(this.style.left) || 0, parseFloat(this.style.top) || 0, w, Math.min(naturalHeight, cap))
      }
      return rect(0, 0, 0, 0)
    })
    const ui = (text: string) => <InfoButton label="About x" data-testid="i">{text}</InfoButton>
    const utils = render(ui('Help text.'))
    fireEvent.click(screen.getByTestId('i'))
    return { pop: screen.getByTestId('i-popover'), rerenderWith: (t: string) => utils.rerender(ui(t)) }
  }
  const geom = (el: HTMLElement) => ({ w: el.style.width, mh: el.style.maxHeight })

  it('width and height cap do not change on scroll; only top and left follow the button', () => {
    btnTop = 200
    const { pop } = mount(120)
    const before = { ...geom(pop), top: pop.style.top, left: pop.style.left }
    expect(before.w).toBe('306px')
    expect(before.mh).toBe('684px')
    for (const t of [180, 120, 40, -10, 500]) {
      btnTop = t
      act(() => { document.dispatchEvent(new Event('scroll')); window.dispatchEvent(new Event('scroll')) })
      expect(geom(pop)).toEqual({ w: '306px', mh: '684px' })
    }
    btnTop = 40
    act(() => { window.dispatchEvent(new Event('scroll')) })
    expect(pop.style.top).not.toBe(before.top)
  })

  it('a re-render of the parent does not undo the placement (React owns no geometry)', () => {
    btnTop = 200
    const { pop, rerenderWith } = mount(120)
    const placed = { top: pop.style.top, left: pop.style.left, ...geom(pop) }
    rerenderWith('Other text.')
    expect({ top: pop.style.top, left: pop.style.left, ...geom(pop) }).toEqual(placed)
    expect(pop.style.visibility).toBe('visible')
  })

  it('long text: capped at the window height minus the margins, scrolls inside, stays fully inside', () => {
    btnTop = 300
    const { pop } = mount(3000)
    expect(pop.style.overflowY).toBe('auto')
    expect(pop.style.maxHeight).toBe('684px')
    const top = parseFloat(pop.style.top)
    expect(top).toBeGreaterThanOrEqual(8)
    expect(top + 684).toBeLessThanOrEqual(692)
  })

  it('narrow window: width is the window minus the margins, and stays so after a scroll', () => {
    btnTop = 200
    const { pop } = mount(120, { width: 220, height: 700 })
    expect(pop.style.width).toBe('204px')
    btnTop = 100
    act(() => { window.dispatchEvent(new Event('scroll')) })
    expect(pop.style.width).toBe('204px')
  })
})

// ── 4. Long (i) text in the Method Library ────────────────────────────────────

describe('the Method Library (i) text', () => {
  const EF_LONG = 'Installs the 25 EF v3.1 methods (11,414 characterisation factors on 3,226 flows) from the factors that ship with the installed Brightway software (the ecoinvent 3.9 LCIA implementation), so it works offline. Only EF v3.1 is installed, not the other ~760 methods. The factors are linked to this project\'s existing biosphere3, which is only read: no flow is added, changed or removed.'
  const NOTE = 'Offline. Needs an ecoinvent database (and so its biosphere3) already imported into the project.'
  const SRC_TXT = 'The characterisation factors come from the ecoinvent 3.9 LCIA implementation bundled with the installed software; flows that ecoinvent added after 3.9 have no factors, factors on flows removed or renamed since are skipped, and the install report shows how many factors were linked and skipped for this project.'

  it('a text of 350 characters or fewer is shown unchanged', () => {
    const m = { long_description: 'Short.', factor_source: 'Source.', notes: 'Note.' }
    expect(aboutLength(m)).toBeLessThanOrEqual(ABOUT_LIMIT)
    expect(methodAbout(m).full).toBe(true)
  })

  it('a longer text is cut to the first sentence and the note; the rest moves to Details word for word', () => {
    const m = { long_description: EF_LONG, factor_source: SRC_TXT, notes: NOTE }
    expect(aboutLength(m)).toBeGreaterThan(ABOUT_LIMIT)
    const a = methodAbout(m)
    expect(a.full).toBe(false)
    expect(a.lead).toBe('Installs the 25 EF v3.1 methods (11,414 characterisation factors on 3,226 flows) from the factors that ship with the installed Brightway software (the ecoinvent 3.9 LCIA implementation), so it works offline.')
    expect(a.note).toBe(NOTE)
    // nothing is lost: lead + rest is the original description, and the source moved whole
    expect(`${a.lead} ${a.moreDescription}`).toBe(EF_LONG)
    expect(a.moreSource).toBe(SRC_TXT)
    expect((a.lead ?? '').length + (a.note ?? '').length + 'More under Details.'.length).toBeLessThanOrEqual(ABOUT_LIMIT)
  })

  it('firstSentence does not split inside version numbers or counts', () => {
    expect(firstSentence('Installs 54 methods (22,986 characterisation factors). All three.')).toBe('Installs 54 methods (22,986 characterisation factors).')
    expect(firstSentence('ecoinvent 3.9 and v3.1 only')).toBe('ecoinvent 3.9 and v3.1 only')
  })

  it('every real catalogue entry fits after the change', () => {
    const file = path.resolve(__dirname, '../../mapper-backend/mapper/data/lcia_methods.json')
    const catalogue = JSON.parse(fs.readFileSync(file, 'utf8')) as { methods: Array<{ id: string; installer?: string; long_description?: string; notes?: string; factor_source?: string }> }
    expect(catalogue.methods.length).toBeGreaterThan(0)
    for (const e of catalogue.methods) {
      const m = { long_description: e.long_description ?? null, notes: e.notes ?? null, factor_source: e.installer === 'bundled_ef' ? SRC_TXT : (e.factor_source ?? null) }
      const a = methodAbout(m)
      const shown = a.full ? aboutLength(m) : (a.lead ?? '').length + (a.note ?? '').length + 'More under Details.'.length
      expect(shown, e.id).toBeLessThanOrEqual(ABOUT_LIMIT)
      if (!a.full) expect(`${a.lead} ${a.moreDescription ?? ''}`.trim(), e.id).toBe((m.long_description ?? '').trim())
    }
  })
})

// ── 5. Years: gating (unchanged) and discoverability ──────────────────────────

const mkArc = (basis: Record<string, 'per_unit' | 'per_year' | undefined>): ArchetypeSummary => {
  const stages = Object.keys(basis)
  const declared = Object.fromEntries(Object.entries(basis).filter(([, v]) => v))
  return {
    id: 'a1', name: 'a1', folder: null, material_count: 0, unlinked_count: 0, stages,
    stage_annual: {}, stage_basis: declared, stage_ids: Object.fromEntries(stages.map((s) => [s, `node-${s}`])),
  } as unknown as ArchetypeSummary
}
const VALUE = { preset: 'custom' as const, lifetime: null, amounts: { Manufacturing: 1, 'Use Phase': 1, Body: 1 } }

describe('Years: editable only once every stage declares a basis', () => {
  it('locked while any stage is undeclared, unlocked the moment every stage has one', () => {
    const open = mkArc({ Manufacturing: 'per_unit', 'Use Phase': 'per_year', Body: undefined })
    const done = mkArc({ Manufacturing: 'per_unit', 'Use Phase': 'per_year', Body: 'per_unit' })
    expect(canApplyLifetime(open)).toBe(false)
    expect(canApplyLifetime(done)).toBe(true)
    const { rerender } = render(<StageAmountsEditor archetype={open} value={VALUE} onChange={() => {}} onDeclareBasis={() => {}} />)
    expect((screen.getByTestId('stage-amounts-lifetime') as HTMLInputElement).disabled).toBe(true)
    rerender(<StageAmountsEditor archetype={done} value={VALUE} onChange={() => {}} onDeclareBasis={() => {}} />)
    expect((screen.getByTestId('stage-amounts-lifetime') as HTMLInputElement).disabled).toBe(false)
  })

  it('what each basis does with the years: per year stages are multiplied, per unit stages are counted once', () => {
    const arc = mkArc({ Manufacturing: 'per_unit', 'Use Phase': 'per_year', Body: 'per_year', 'End of Life': 'per_unit' })
    expect(stageAmountsForPreset(arc, 'custom', 15, null)).toEqual({ Manufacturing: 1, 'Use Phase': 15, Body: 15, 'End of Life': 1 })
    // undeclared would also stay at 1, which is why the box stays locked until each one is declared
    const undeclared = mkArc({ Manufacturing: 'per_unit', 'Use Phase': undefined })
    expect(stageAmountsForPreset(undeclared, 'custom', 15, null)).toEqual({ Manufacturing: 1, 'Use Phase': 1 })
  })
})

describe('Years: the locked box says what to do', () => {
  const open = mkArc({ Manufacturing: undefined, 'Use Phase': 'per_year', Body: undefined })

  it('has a tooltip, an accessible name and a hint line in normal size and contrast', () => {
    render(<StageAmountsEditor archetype={open} value={VALUE} onChange={() => {}} onDeclareBasis={() => {}} />)
    const input = screen.getByTestId('stage-amounts-lifetime') as HTMLInputElement
    expect(input.disabled).toBe(true)
    expect(screen.getByTestId('stage-amounts-lifetime-locked').getAttribute('title')).toBe(YEARS_LOCKED_TOOLTIP)
    expect(input.getAttribute('aria-label')).toContain('Choose a basis for every stage first')
    const hint = screen.getByTestId('stage-amounts-years-note')
    expect(hint.textContent).toContain('Years need a basis on every stage.')
    expect(hint.style.fontSize).toBe('var(--text-xs)')
    expect(hint.style.color).toBe('var(--text-secondary)')
  })

  it('clicking the locked box focuses the first stage whose basis is "not declared"', () => {
    render(<StageAmountsEditor archetype={open} value={VALUE} onChange={() => {}} onDeclareBasis={() => {}} />)
    fireEvent.click(screen.getByTestId('stage-amounts-lifetime-locked'))
    expect(document.activeElement).toBe(screen.getByTestId('stage-basis-select-Manufacturing'))
  })

  it('once every stage declares a basis there is no tooltip, no wrapper and the hint is the small one', () => {
    const done = mkArc({ Manufacturing: 'per_unit', 'Use Phase': 'per_year', Body: 'per_unit' })
    render(<StageAmountsEditor archetype={done} value={VALUE} onChange={() => {}} onDeclareBasis={() => {}} />)
    expect(screen.queryByTestId('stage-amounts-lifetime-locked')).toBeNull()
    expect(screen.getByTestId('stage-amounts-years-note').style.fontSize).toBe('10px')
  })

  it('defaultStageAmounts is unchanged (1 for every stage, no years)', () => {
    expect(defaultStageAmounts(open)).toEqual({ preset: '1year', lifetime: null, amounts: { Manufacturing: 1, 'Use Phase': 1, Body: 1 } })
  })
})
