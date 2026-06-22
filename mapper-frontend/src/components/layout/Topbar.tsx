/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import React from 'react'
import { ProjectSwitcher } from '../ProjectSwitcher'
import { CarbonBadge } from '../CarbonBadge'

interface TopbarProps {
  actions?: React.ReactNode
}

export function Topbar({ actions }: TopbarProps) {
  return (
    <header
      style={{
        gridArea: 'topbar',
        height: 48,
        backgroundColor: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 var(--space-4)',
        gap: 'var(--space-4)',
      }}
    >
      {/* Logo */}
      <div
        style={{
          fontWeight: 700,
          fontSize: 'var(--text-xl)',
          color: 'var(--text-primary)',
          letterSpacing: 'var(--tracking-tight)',
          flexShrink: 0,
        }}
      >
        MA<span style={{ color: 'var(--accent)' }}>pper</span>
      </div>

      {/* Center — Project Switcher */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 'var(--space-2)' }}>
        <span
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--text-secondary)',
            letterSpacing: 'var(--tracking-wide)',
            textTransform: 'uppercase',
            fontWeight: 500,
          }}
        >
          Project:
        </span>
        <ProjectSwitcher />
        <CarbonBadge />
      </div>

      {/* Right slot — custom actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
        {actions}
      </div>
    </header>
  )
}
