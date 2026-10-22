/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

// The shared full-screen calculation card (walkthrough 4).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ComputeOverlay, OVERLAY_REVEAL_MS } from '../src/components/ui/ComputeOverlay'

afterEach(() => { document.getElementById('root')?.remove() })

const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

function withAppRoot(ui: React.ReactElement) {
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)
  return render(ui, { container: root })
}

describe('ComputeOverlay', () => {
  it('renders nothing when idle', () => {
    render(<ComputeOverlay active={false} title="Computing" />)
    expect(screen.queryByTestId('compute-overlay')).toBeNull()
  })

  it('blocks the screen at once and shows the card after the reveal delay', async () => {
    render(<ComputeOverlay active title="Computing AESA" detail="5 cases × 6 sharing · 4 LCA reruns" />)
    const backdrop = screen.getByTestId('compute-overlay')
    expect(backdrop.style.position).toBe('fixed')
    expect(backdrop.style.inset).toBe('0px')
    expect(screen.queryByTestId('compute-overlay-card')).toBeNull()      // no flash for a short run
    await wait(OVERLAY_REVEAL_MS + 50)
    expect(screen.getByTestId('compute-overlay-title').textContent).toBe('Computing AESA')
    expect(screen.getByTestId('compute-overlay-detail').textContent).toBe('5 cases × 6 sharing · 4 LCA reruns')
    expect(screen.getByTestId('compute-overlay-elapsed').textContent).toMatch(/^0:0\d elapsed$/)
  })

  it('a click on the card or backdrop never reaches the panel that owns it', async () => {
    // A portal's events bubble through the REACT tree: without the backdrop's
    // stopPropagation, clicking the dimmed screen would fire the owning
    // panel's own onClick handlers (a collapsible header, a row toggle).
    const onPanel = vi.fn()
    render(<div onClick={onPanel} onMouseDown={onPanel}><ComputeOverlay active title="Computing" /></div>)
    fireEvent.mouseDown(screen.getByTestId('compute-overlay'))
    fireEvent.click(screen.getByTestId('compute-overlay'))
    await wait(OVERLAY_REVEAL_MS + 50)
    fireEvent.click(screen.getByTestId('compute-overlay-card'))
    expect(onPanel).not.toHaveBeenCalled()
  })

  it('makes the app behind it inert while it runs, and releases it after', () => {
    const { rerender } = withAppRoot(<ComputeOverlay active title="Computing" />)
    expect(document.getElementById('root')!.hasAttribute('inert')).toBe(true)
    rerender(<ComputeOverlay active={false} title="Computing" />)
    expect(document.getElementById('root')!.hasAttribute('inert')).toBe(false)
  })

  it('offers Stop when the run can be stopped', async () => {
    const onCancel = vi.fn()
    render(<ComputeOverlay active title="Monte Carlo" onCancel={onCancel} pct={0.4} />)
    await wait(OVERLAY_REVEAL_MS + 50)
    expect(screen.getByTestId('compute-overlay-elapsed').textContent).toMatch(/^40% · /)
    fireEvent.click(screen.getByTestId('compute-overlay-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
