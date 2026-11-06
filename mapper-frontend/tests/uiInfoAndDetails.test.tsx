/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, afterEach } from 'vitest'
import { render, fireEvent, cleanup, screen } from '@testing-library/react'
import { InfoButton } from '../src/components/ui/InfoButton'
import { DetailsToggle } from '../src/components/ui/DetailsToggle'

/**
 * The two shared "keep it short" controls. jsdom proves the open/close behaviour and the
 * accessibility attributes; it cannot show where the popover lands or whether it is clipped.
 */
afterEach(() => cleanup())

describe('<InfoButton>', () => {
  it('is a named button; the text is absent until opened', () => {
    render(<InfoButton label="About x">Long help text.</InfoButton>)
    const b = screen.getByRole('button', { name: 'About x' })
    expect(b.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Long help text.')).toBeNull()
  })

  it('opens on click, closes on a second click, on Escape and on a click elsewhere', () => {
    render(<div><InfoButton label="About x">Long help text.</InfoButton><p>outside</p></div>)
    const b = screen.getByRole('button', { name: 'About x' })
    fireEvent.click(b)
    expect(screen.getByText('Long help text.')).toBeInTheDocument()
    expect(b.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(b)
    expect(screen.queryByText('Long help text.')).toBeNull()
    fireEvent.click(b)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('Long help text.')).toBeNull()
    fireEvent.click(b)
    fireEvent.mouseDown(screen.getByText('outside'))
    expect(screen.queryByText('Long help text.')).toBeNull()
  })

  it('a click inside the popover does not close it', () => {
    render(<InfoButton label="About x">Long help text.</InfoButton>)
    fireEvent.click(screen.getByRole('button', { name: 'About x' }))
    fireEvent.mouseDown(screen.getByText('Long help text.'))
    expect(screen.getByText('Long help text.')).toBeInTheDocument()
  })
})

describe('<DetailsToggle>', () => {
  it('is collapsed by default, keeps the body mounted, and toggles', () => {
    render(<DetailsToggle data-testid="d"><span>the details</span></DetailsToggle>)
    const toggle = screen.getByRole('button', { name: 'Details' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('the details')).toBeInTheDocument()     // mounted (visibility-toggle rule)
    expect(screen.getByText('the details')).not.toBeVisible()
    fireEvent.click(toggle)
    expect(screen.getByText('the details')).toBeVisible()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(toggle)
    expect(screen.getByText('the details')).not.toBeVisible()
  })

  it('defaultOpen opens it', () => {
    render(<DetailsToggle defaultOpen><span>the details</span></DetailsToggle>)
    expect(screen.getByText('the details')).toBeVisible()
  })
})
