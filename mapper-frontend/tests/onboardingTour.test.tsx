/* SPDX-License-Identifier: MPL-2.0 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { STEPS } from '../src/components/OnboardingTour'
import { Sidebar } from '../src/components/layout/Sidebar'

const navSteps = STEPS.filter((s) => typeof s.target === 'string' && s.target !== 'body')

describe('onboarding tour targets', () => {
  it('every nav step resolves to a real sidebar element', () => {
    // Joyride SILENTLY DROPS a step whose target is missing, leaving the user
    // mid-tour on a blank screen with no error. Renaming a sidebar id or
    // dropping a data-tour attribute would do exactly that, so the resolution
    // is asserted rather than assumed.
    const { container } = render(<Sidebar activeItem="databases" onItemClick={() => {}} />)
    for (const step of navSteps) {
      const sel = step.target as string
      expect(container.querySelector(sel), `no element matches ${sel}`).not.toBeNull()
    }
  })

  it('covers the seven sidebar tabs in research order', () => {
    expect(navSteps.map((s) => s.target)).toEqual([
      '[data-tour="nav-databases"]',
      '[data-tour="nav-lca"]',
      '[data-tour="nav-dsm"]',
      '[data-tour="nav-impact"]',
      '[data-tour="nav-aesa"]',
      '[data-tour="nav-uncertainty"]',
    ])
  })
})

describe('the Uncertainty step', () => {
  const step = STEPS.find((s) => s.target === '[data-tour="nav-uncertainty"]')!
  const content = String(step.content)

  it('exists and is numbered after AESA', () => {
    expect(step).toBeDefined()
    expect(String(step.title)).toMatch(/^6\./)
  })

  it('says what it does', () => {
    expect(content).toMatch(/monte carlo/i)
    expect(content).toMatch(/single-product/i)
  })

  it('says how you get there, both ways', () => {
    expect(content).toMatch(/run uncertainty/i)
    expect(content).toMatch(/open the tab directly/i)
  })

  it('warns that an unscored run is background-only', () => {
    // The point that matters: an unscored run gives a real but PARTIAL result,
    // and nothing on screen would otherwise tell the user the foreground
    // contributed nothing.
    expect(content).toMatch(/unscored/i)
    expect(content).toMatch(/background only/i)
    expect(content).toMatch(/ecoinvent/i)
    expect(content).toMatch(/material scoring/i)
  })

  it('matches its siblings in length', () => {
    const words = (s: unknown) => String(s).split(/\s+/).length
    const others = navSteps
      .filter((s) => s !== step)
      .map((s) => words(s.content))
    const max = Math.max(...others)
    // Within the band the other nav steps occupy, not double them.
    expect(words(content)).toBeLessThanOrEqual(Math.round(max * 1.35))
  })
})

describe('tour copy conventions', () => {
  it('uses no em dashes in user-facing content', () => {
    for (const s of STEPS) {
      expect(String(s.content), `em dash in: ${String(s.title)}`).not.toContain('—')
      expect(String(s.title)).not.toContain('—')
    }
  })

  it('tells the user how to replay it', () => {
    const closing = String(STEPS[STEPS.length - 1].content)
    expect(closing).toMatch(/restart tour/i)
    expect(closing).toMatch(/settings/i)
  })
})
