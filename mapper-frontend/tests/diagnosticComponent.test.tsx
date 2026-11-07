/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Diagnostic } from '../src/components/ui/Diagnostic'
import { NAVIGATE_EVENT, useDiagnosticHelpStore } from '../src/stores/diagnosticHelpStore'
import { fillSummary, lookupDiagnostic } from '../src/utils/diagnostics'

/**
 * <Diagnostic>: one visible line (marker, count, summary, Help), the original message behind
 * Details, collapsed. A code that is not in the registry is shown expanded and in full.
 *
 * jsdom cannot show whether the summary really fits on one line (it is nowrap + ellipsis),
 * how it looks, or what a screen reader says: it proves the attributes and the structure.
 */
beforeEach(() => useDiagnosticHelpStore.setState({ target: null }))
afterEach(() => cleanup())

const ORIGINAL = "Row 7 (B, Housing, Screw): code 'abc' has wrong length (expected 32 chars, got 3)."

describe('a registered code', () => {
  it('shows ONE visible line with the severity marker, the count and the summary', () => {
    render(<Diagnostic code="code_truncated" severity="error" count={3} message={ORIGINAL} />)
    const line = screen.getByTestId('diagnostic-summary')
    expect(line).toBeVisible()
    expect(line.textContent).toBe('3× Activity code has the wrong length')
    expect(screen.getByRole('img', { name: 'Error' })).toBeInTheDocument()
    expect(screen.getByTestId('diagnostic').getAttribute('data-registered')).toBe('true')
  })

  it('keeps the original message behind Details, collapsed and mounted, and shows it on click', () => {
    render(<Diagnostic code="code_truncated" severity="error" message={ORIGINAL} />)
    const msg = screen.getByTestId('diagnostic-message')
    expect(msg).toBeInTheDocument()
    expect(msg).not.toBeVisible()
    const toggle = screen.getByTestId('diagnostic-details-toggle')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(msg).toBeVisible()
    expect(msg.textContent).toBe(ORIGINAL)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
  })

  it('an error is announced with just its one line; a warning is a status', () => {
    const { rerender } = render(<Diagnostic code="code_truncated" severity="error" message={ORIGINAL} />)
    const alert = screen.getByRole('alert')
    expect(alert).toBe(screen.getByTestId('diagnostic-summary'))
    expect(alert.textContent).not.toContain('Row 7')            // the long message is not in the live region
    rerender(<Diagnostic code="waste_sign" severity="warning" message="x" />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status')).toBe(screen.getByTestId('diagnostic-summary'))
  })

  it('fills {placeholders} from params, and falls back to the title when one is missing', () => {
    const e = lookupDiagnostic('method_install_warnings')!
    expect(fillSummary(e, { value: '9.1% of factors skipped' })).toBe('Installed with warnings: 9.1% of factors skipped')
    expect(fillSummary(e, {})).toBe('Installed with warnings')
    expect(fillSummary(e)).not.toContain('{')
    render(<Diagnostic code="negative_amount" severity="error" message="m" params={{ where: 'Exchanges, row 5, column Amount' }} />)
    expect(screen.getByTestId('diagnostic-summary').textContent).toBe('Exchanges, row 5, column Amount: amount is negative')
  })

  it('the registry is keyed on the code, never the message', () => {
    render(<Diagnostic code="waste_sign" message="Some completely different wording" />)
    expect(screen.getByTestId('diagnostic-summary').textContent).toBe('Positive quantity on a waste treatment')
  })

  it('Help asks Settings for the entry and navigates there', () => {
    const seen: string[] = []
    const on = (e: Event) => seen.push((e as CustomEvent<string>).detail)
    window.addEventListener(NAVIGATE_EVENT, on)
    render(<Diagnostic code="code_truncated" severity="error" message={ORIGINAL} />)
    fireEvent.click(screen.getByTestId('diagnostic-help'))
    window.removeEventListener(NAVIGATE_EVENT, on)
    expect(useDiagnosticHelpStore.getState().target).toBe('code_truncated')
    expect(seen).toEqual(['settings'])
  })

  it('children go into the Details body after the message', () => {
    render(<Diagnostic code="bom_biosphere_link" severity="error" message="m"><ul data-testid="rows"><li>row 4</li></ul></Diagnostic>)
    expect(screen.getByTestId('rows')).not.toBeVisible()
    fireEvent.click(screen.getByTestId('diagnostic-details-toggle'))
    expect(screen.getByTestId('rows')).toBeVisible()
  })
})

describe('a code that is NOT in the registry', () => {
  it('is shown with its original message in full, expanded, never collapsed', () => {
    render(<Diagnostic code="some_future_code" severity="warning" message="A brand new kind of warning, in full." />)
    const box = screen.getByTestId('diagnostic')
    expect(box.getAttribute('data-registered')).toBe('false')
    expect(screen.getByTestId('diagnostic-message')).toBeVisible()
    expect(screen.getByTestId('diagnostic-message').textContent).toBe('A brand new kind of warning, in full.')
    expect(screen.queryByTestId('diagnostic-details-toggle')).toBeNull()   // nothing to expand: it is already open
    expect(screen.queryByTestId('diagnostic-help')).toBeNull()
  })

  it('no code at all behaves the same, and keeps its count', () => {
    render(<Diagnostic severity="error" count={2} message="Something broke." />)
    expect(screen.getByTestId('diagnostic-message').textContent).toBe('2× Something broke.')
    expect(screen.getByRole('alert')).toBeVisible()
  })

  it('hasOwnProperty guard: Object.prototype names are not codes', () => {
    expect(lookupDiagnostic('constructor')).toBeNull()
    expect(lookupDiagnostic('toString')).toBeNull()
  })
})

