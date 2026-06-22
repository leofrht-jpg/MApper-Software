/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useProjectStore } from '../../stores/projectStore'

export function StatusBar() {
  const currentProject = useProjectStore((s) => s.currentProject)

  return (
    <footer
      style={{
        gridArea: 'statusbar',
        height: 24,
        backgroundColor: 'var(--bg-surface)',
        borderTop: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 var(--space-4)',
      }}
    >
      {/* Left — connection status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: 'var(--radius-full)',
            backgroundColor: 'var(--success)',
          }}
        />
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
          Connected
        </span>
      </div>

      {/* Right — current project */}
      <span
        style={{
          fontSize: 'var(--text-xs)',
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-secondary)',
        }}
      >
        {currentProject ?? '—'}
      </span>
    </footer>
  )
}
