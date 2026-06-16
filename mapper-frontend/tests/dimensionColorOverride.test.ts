import { describe, it, expect, beforeEach } from 'vitest'
import {
  assignColors,
  setLabelColor,
  clearLabelColor,
  getOverriddenLabels,
} from '../src/utils/chartColors'

// Patch 4AJ — per-dimension-value color overrides.
//
// Tests cover the pure-function surface of chartColors.ts:
// setLabelColor / clearLabelColor / getOverriddenLabels and their
// interaction with the algorithm's deterministic assignment + the
// custom-event pubsub for reactivity.

beforeEach(() => {
  localStorage.clear()
})

describe('setLabelColor — writes to localStorage map', () => {
  it('persists the override under the per-scope storage key', () => {
    setLabelColor('BEV-LFP', '#ff0000', 'my-project')
    const raw = localStorage.getItem('mapper-color-assignments-my-project')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!)
    expect(parsed['BEV-LFP']).toBe('#ff0000')
  })

  it('uses _global scope when scope is null/undefined', () => {
    setLabelColor('BEV-LFP', '#ff0000')
    const raw = localStorage.getItem('mapper-color-assignments-_global')
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw!)['BEV-LFP']).toBe('#ff0000')
  })

  it('writes "scope" labels separately', () => {
    setLabelColor('BEV-LFP', '#ff0000', 'project-a')
    setLabelColor('BEV-LFP', '#00ff00', 'project-b')
    expect(JSON.parse(localStorage.getItem('mapper-color-assignments-project-a')!)['BEV-LFP'])
      .toBe('#ff0000')
    expect(JSON.parse(localStorage.getItem('mapper-color-assignments-project-b')!)['BEV-LFP'])
      .toBe('#00ff00')
  })
})

describe('getOverriddenLabels — distinguishes user overrides from algorithm-assigned', () => {
  it('returns empty set when no overrides exist', () => {
    expect(getOverriddenLabels('p1').size).toBe(0)
  })

  it('tracks overrides separately from the color map', () => {
    // assignColors writes to the color map but NOT the overrides set —
    // it's the algorithm's deterministic fill, not a user choice.
    const map = assignColors(['BEV-LFP', 'PHEV'], {})
    localStorage.setItem('mapper-color-assignments-p1', JSON.stringify(map))
    expect(getOverriddenLabels('p1').size).toBe(0)

    setLabelColor('BEV-LFP', '#ff0000', 'p1')
    const overrides = getOverriddenLabels('p1')
    expect(overrides.has('BEV-LFP')).toBe(true)
    expect(overrides.has('PHEV')).toBe(false)
  })

  it('clearLabelColor removes the entry from overrides', () => {
    setLabelColor('BEV-LFP', '#ff0000', 'p1')
    expect(getOverriddenLabels('p1').has('BEV-LFP')).toBe(true)
    clearLabelColor('BEV-LFP', 'p1')
    expect(getOverriddenLabels('p1').has('BEV-LFP')).toBe(false)
  })
})

describe('clearLabelColor — reverts to deterministic algorithm assignment', () => {
  it('removes the override from the color map', () => {
    setLabelColor('BEV-LFP', '#ff0000', 'p1')
    clearLabelColor('BEV-LFP', 'p1')
    const raw = localStorage.getItem('mapper-color-assignments-p1')
    const parsed = raw ? JSON.parse(raw) : {}
    expect('BEV-LFP' in parsed).toBe(false)
  })

  it('next assignColors call after clear produces the deterministic auto color', () => {
    // Seed with algorithm assignments.
    const labels = ['BEV-LFP', 'ICEV-Petrol', 'Hybrid']
    const initial = assignColors(labels, {})
    const autoColor = initial['BEV-LFP']

    // User picks a different color.
    setLabelColor('BEV-LFP', '#123456', 'p1')

    // Reset → next assignColors call (simulating useChartColors
    // re-render after clearLabelColor wiped the entry) reproduces the
    // original deterministic color.
    clearLabelColor('BEV-LFP', 'p1')
    const stored = JSON.parse(
      localStorage.getItem('mapper-color-assignments-p1') || '{}'
    )
    const restored = assignColors(labels, stored)
    expect(restored['BEV-LFP']).toBe(autoColor)
  })

  it('clearing a label that has no override is a no-op', () => {
    expect(() => clearLabelColor('NeverSet', 'p1')).not.toThrow()
    expect(getOverriddenLabels('p1').size).toBe(0)
  })
})

describe('setLabelColor — pubsub: dispatches mapper-color-changed event', () => {
  it('fires a CustomEvent with the matching scope on the window', () => {
    const events: string[] = []
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ scope?: string }>).detail
      events.push(detail?.scope || 'NULL')
    }
    window.addEventListener('mapper-color-changed', handler)
    try {
      setLabelColor('BEV-LFP', '#ff0000', 'project-a')
      setLabelColor('PHEV', '#00ff00', 'project-b')
      expect(events).toEqual(['project-a', 'project-b'])
    } finally {
      window.removeEventListener('mapper-color-changed', handler)
    }
  })

  it('does NOT fire an event when color is unchanged AND label is already overridden', () => {
    setLabelColor('BEV-LFP', '#ff0000', 'p1') // first set
    let fireCount = 0
    const handler = () => { fireCount++ }
    window.addEventListener('mapper-color-changed', handler)
    try {
      setLabelColor('BEV-LFP', '#ff0000', 'p1') // same color, already override
      expect(fireCount).toBe(0)
    } finally {
      window.removeEventListener('mapper-color-changed', handler)
    }
  })

  it('DOES fire when promoting an algorithm-assigned color to a user override', () => {
    // Even if the chosen color matches the auto-assigned one, marking
    // it as a user override (so Reset can revert) requires an event so
    // consumers re-read.
    const initial = assignColors(['BEV-LFP'], {})
    localStorage.setItem('mapper-color-assignments-p1', JSON.stringify(initial))
    let fireCount = 0
    const handler = () => { fireCount++ }
    window.addEventListener('mapper-color-changed', handler)
    try {
      setLabelColor('BEV-LFP', initial['BEV-LFP'], 'p1')
      expect(fireCount).toBe(1)
      expect(getOverriddenLabels('p1').has('BEV-LFP')).toBe(true)
    } finally {
      window.removeEventListener('mapper-color-changed', handler)
    }
  })
})
