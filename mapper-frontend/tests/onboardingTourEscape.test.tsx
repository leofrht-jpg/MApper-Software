/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/**
 * The tour must always have one way out.
 *
 * Its overlay is a 65%-opaque black sheet over the whole viewport at z-index
 * 10000, and both `overlayClickAction: false` and `dismissKeyAction: false` are
 * set on purpose so a stray click cannot skip the tour. That is safe only while
 * a tooltip is on screen. Joyride silently drops a step whose target is missing,
 * and the overlay then covers a working app with no visible control and no way
 * to dismiss it -- indistinguishable from a hung window.
 *
 * Escape is that exit. It ends the tour the same way "Skip tour" does, so a tour
 * escaped this way does not re-arm on the next launch.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { OnboardingTour, hasCompletedOnboarding } from '../src/components/OnboardingTour'

// Joyride itself is not under test here (it renders a portal and measures real
// layout, neither of which jsdom provides). The Escape handler is a plain window
// listener owned by our component, which is exactly what these tests exercise.
vi.mock('react-joyride', () => ({
  Joyride: () => null,
  STATUS: { FINISHED: 'finished', SKIPPED: 'skipped' },
}))

beforeEach(() => {
  localStorage.clear()
})

describe('onboarding tour is always dismissable', () => {
  it('Escape ends a running tour', () => {
    const onFinish = vi.fn()
    render(<OnboardingTour run onFinish={onFinish} />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it('escaping marks onboarding complete, so it does not re-arm next launch', () => {
    expect(hasCompletedOnboarding()).toBe(false)

    render(<OnboardingTour run onFinish={vi.fn()} />)
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(hasCompletedOnboarding()).toBe(true)
  })

  it('does nothing when the tour is not running', () => {
    const onFinish = vi.fn()
    render(<OnboardingTour run={false} onFinish={onFinish} />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onFinish).not.toHaveBeenCalled()
    // and it must not pre-emptively suppress a tour the user has not seen
    expect(hasCompletedOnboarding()).toBe(false)
  })

  it('ignores other keys', () => {
    const onFinish = vi.fn()
    render(<OnboardingTour run onFinish={onFinish} />)

    for (const key of ['Enter', 'a', ' ', 'Tab', 'ArrowRight']) {
      fireEvent.keyDown(window, { key })
    }

    expect(onFinish).not.toHaveBeenCalled()
    expect(hasCompletedOnboarding()).toBe(false)
  })

  it('stops listening once unmounted', () => {
    const onFinish = vi.fn()
    const { unmount } = render(<OnboardingTour run onFinish={onFinish} />)
    unmount()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onFinish).not.toHaveBeenCalled()
  })

  it('listens on the capture phase, so nothing below can swallow the key', () => {
    const onFinish = vi.fn()
    render(<OnboardingTour run onFinish={onFinish} />)

    // A greedy handler on the target that stops propagation entirely. On the
    // bubble phase this would starve the tour's listener; on capture it cannot.
    const greedy = (e: Event) => e.stopPropagation()
    document.body.addEventListener('keydown', greedy)
    try {
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(onFinish).toHaveBeenCalledTimes(1)
    } finally {
      document.body.removeEventListener('keydown', greedy)
    }
  })
})
