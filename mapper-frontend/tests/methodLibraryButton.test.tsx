import { describe, it, expect, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { ImpactAssessment } from '../src/pages/ImpactAssessment'

/**
 * Patch 5G — the "Method Library" header affordance must read as an evident
 * (secondary/outline) button, reusing the shared Button primitive, and remain
 * subordinate to the filled "Calculate" CTA. Lock the mechanism, not pixels.
 */

beforeEach(() => {
  // recharts ResponsiveContainer needs ResizeObserver in jsdom (panels mount).
  // @ts-expect-error — minimal stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
})

describe('Method Library header button', () => {
  it('renders as a real, focusable <button>', () => {
    const { getByTestId } = render(<ImpactAssessment />)
    const btn = getByTestId('method-library-button')
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.textContent).toContain('Method Library')
    // Native <button> is keyboard-focusable / Enter-Space activatable.
    btn.focus()
    expect(document.activeElement).toBe(btn)
  })

  it('uses the shared secondary/outline treatment — visible border, not the filled primary', () => {
    const { getByTestId } = render(<ImpactAssessment />)
    const btn = getByTestId('method-library-button') as HTMLButtonElement
    // Secondary variant from Button.tsx: bordered + elevated bg, pointer cursor.
    expect(btn.style.border).toBe('1px solid var(--border-default)')
    expect(btn.style.backgroundColor).toBe('var(--bg-elevated)')
    expect(btn.style.cursor).toBe('pointer')
    // NOT the filled primary CTA (which would compete with Calculate).
    expect(btn.style.backgroundColor).not.toBe('var(--accent)')
  })

  it('clicking still opens the Method Library modal (behavior preserved)', () => {
    const { getByTestId, queryByText, getByText } = render(<ImpactAssessment />)
    // Modal not present initially.
    expect(queryByText('LCIA Method Library')).toBeNull()
    fireEvent.click(getByTestId('method-library-button'))
    // The MethodLibrary modal renders its heading on open.
    expect(getByText('LCIA Method Library')).toBeTruthy()
  })

  it('opens for both Single-product and System-level views (one shared header)', () => {
    const { getByTestId } = render(<ImpactAssessment />)
    // System-level view.
    fireEvent.click(getByTestId('impact-mode-system'))
    expect(getByTestId('method-library-button').tagName).toBe('BUTTON')
    // Single-product view.
    fireEvent.click(getByTestId('impact-mode-single_product'))
    expect(getByTestId('method-library-button').tagName).toBe('BUTTON')
  })
})
