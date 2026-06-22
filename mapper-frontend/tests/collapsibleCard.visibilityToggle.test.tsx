/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { useState } from 'react'
import { CollapsibleCard } from '../src/components/ui/CollapsibleCard'

// Patch 4A — CollapsibleCard now uses visibility-toggle (display: none) on
// its body, not conditional mount. The contract: children stay mounted
// across collapse/expand round-trips, so component-local React state is
// preserved. This is the same architectural rule that governs
// ImpactAssessment's mode toggle and tab panes (CLAUDE.md "UI conventions").
//
// Concrete failure mode this fixes: indicator selections (state inside
// MethodPicker.useMethodSelection) used to vanish when the user collapsed
// the Configuration card. With visibility-toggle the wrapped subtree never
// remounts, so its useState slots survive intact.

function StateProbe({ children }: { children?: React.ReactNode }) {
  const [count, setCount] = useState(0)
  return (
    <div>
      <button data-testid="probe-bump" onClick={() => setCount((v) => v + 1)}>bump</button>
      <span data-testid="probe-count">{count}</span>
      {children}
    </div>
  )
}

function Harness() {
  const [expanded, setExpanded] = useState(true)
  return (
    <CollapsibleCard
      title="Test card"
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
    >
      <StateProbe />
    </CollapsibleCard>
  )
}

describe('CollapsibleCard — visibility-toggle (Patch 4A)', () => {
  it('keeps children mounted across collapse/expand and preserves their state', () => {
    const { getByTestId, getByText } = render(<Harness />)

    fireEvent.click(getByTestId('probe-bump'))
    fireEvent.click(getByTestId('probe-bump'))
    fireEvent.click(getByTestId('probe-bump'))
    expect(getByTestId('probe-count')).toHaveTextContent('3')

    // Collapse — child stays in DOM, body wrapper flips to display: none.
    fireEvent.click(getByText('Test card'))
    const stillMounted = getByTestId('probe-count')
    expect(stillMounted).toBeInTheDocument()
    expect(stillMounted).toHaveTextContent('3')
    expect(stillMounted.closest('[style*="display: none"]')).not.toBeNull()

    // Expand — same instance, same state, no display:none ancestor.
    fireEvent.click(getByText('Test card'))
    expect(getByTestId('probe-count')).toHaveTextContent('3')
    expect(getByTestId('probe-count').closest('[style*="display: none"]')).toBeNull()
  })

  it('renders actions in the header regardless of expanded state', () => {
    function ActionHarness() {
      const [expanded, setExpanded] = useState(true)
      return (
        <CollapsibleCard
          title="Card with actions"
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
          actions={<button data-testid="header-action">Run</button>}
        >
          <span data-testid="body-text">body</span>
        </CollapsibleCard>
      )
    }
    const { getByTestId, getByText } = render(<ActionHarness />)
    expect(getByTestId('header-action')).toBeInTheDocument()
    fireEvent.click(getByText('Card with actions'))
    // Header action stays even when body is hidden — the always-accessible
    // Calculate-button pattern (Patch 4A, Issue 2) relies on this.
    expect(getByTestId('header-action')).toBeInTheDocument()
    expect(getByTestId('body-text').closest('[style*="display: none"]')).not.toBeNull()
  })
})
