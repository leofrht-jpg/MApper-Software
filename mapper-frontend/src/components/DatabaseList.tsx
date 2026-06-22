/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useEffect } from 'react'
import { useProjectStore } from '../stores/projectStore'

function SkeletonRow() {
  return (
    <tr>
      {[0, 1, 2].map((i) => (
        <td key={i} style={{ padding: '0 var(--space-4)', height: 40 }}>
          <div
            style={{
              height: 14,
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--bg-hover)',
              animation: 'skeleton-pulse 1.5s ease-in-out infinite',
              width: i === 1 ? '50%' : '80%',
            }}
          />
        </td>
      ))}
    </tr>
  )
}

export function DatabaseList() {
  const { databases, isLoading, fetchDatabases } = useProjectStore()

  useEffect(() => {
    fetchDatabases()
  }, [fetchDatabases])

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}
    >
      <style>{`
        @keyframes skeleton-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
        .db-row:hover td { background: var(--bg-hover); }
      `}</style>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr
            style={{
              position: 'sticky',
              top: 0,
              backgroundColor: 'var(--bg-surface)',
              zIndex: 1,
            }}
          >
            {['Name', 'Records', 'Modified'].map((col, i) => (
              <th
                key={col}
                style={{
                  padding: '0 var(--space-4)',
                  height: 36,
                  fontSize: 'var(--text-xs)',
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase',
                  letterSpacing: 'var(--tracking-wide)',
                  textAlign: i === 1 ? 'right' : 'left',
                  borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </>
          ) : databases.length === 0 ? (
            <tr>
              <td
                colSpan={3}
                style={{
                  padding: 'var(--space-10)',
                  textAlign: 'center',
                  color: 'var(--text-tertiary)',
                  fontSize: 'var(--text-sm)',
                }}
              >
                No databases found. Import one to get started.
              </td>
            </tr>
          ) : (
            databases.map((db) => (
              <tr
                key={db.name}
                className="db-row"
                style={{
                  borderBottom: '1px solid var(--border-subtle)',
                  transition: `background var(--duration-fast) var(--ease-out)`,
                }}
              >
                <td
                  style={{
                    padding: '0 var(--space-4)',
                    height: 40,
                    fontSize: 'var(--text-sm)',
                    color: 'var(--text-primary)',
                  }}
                >
                  {db.name}
                </td>
                <td
                  style={{
                    padding: '0 var(--space-4)',
                    height: 40,
                    fontSize: 'var(--text-sm)',
                    fontFamily: 'var(--font-mono)',
                    fontVariantNumeric: 'tabular-nums',
                    textAlign: 'right',
                    color: 'var(--text-primary)',
                  }}
                >
                  {db.records.toLocaleString()}
                </td>
                <td
                  style={{
                    padding: '0 var(--space-4)',
                    height: 40,
                    fontSize: 'var(--text-sm)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {db.modified ?? '—'}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
