/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useState } from 'react'
import { Layers, Plus, Trash2 } from 'lucide-react'
import { useSubsystemStore } from '../../stores/subsystemStore'
import { AddSubsystemDialog } from './AddSubsystemDialog'

export const OVERALL_ID = '__overall__'

interface SubsystemTabsProps {
  primarySystemId: string
}

// NOTE: `primarySystemId` is accepted for API clarity (the parent passes the
// active system id) but the subsystem store is already scoped to the active
// system, so the value isn't read here. Flagged in Patch 5AI — verify
// subsystems re-fetch on system switch before wiring it in.
export function SubsystemTabs({ primarySystemId: _primarySystemId }: SubsystemTabsProps) {
  const subsystems = useSubsystemStore((s) => s.subsystems)
  const activeSubsystemId = useSubsystemStore((s) => s.activeSubsystemId)
  const selectSubsystem = useSubsystemStore((s) => s.selectSubsystem)
  const removeDependent = useSubsystemStore((s) => s.removeDependent)
  const [showAdd, setShowAdd] = useState(false)

  const dependents = subsystems.filter((s) => s.type === 'dependent')
  // Primary is implicit (null = primary); no tab rendered unless a dependent exists.
  if (dependents.length === 0 && !showAdd) {
    return (
      <>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={() => setShowAdd(true)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 12px',
              background: 'none', border: '1px dashed var(--border-default)',
              borderRadius: 'var(--radius-md)', cursor: 'pointer',
              color: 'var(--text-secondary)', fontSize: 'var(--text-xs)', fontWeight: 500,
            }}
            title="Add a dependent subsystem (e.g. infrastructure coupled to the primary stock)"
          >
            <Plus size={12} strokeWidth={1.5} /> Add subsystem
          </button>
        </div>
        {showAdd && <AddSubsystemDialog onClose={() => setShowAdd(false)} />}
      </>
    )
  }

  const primaryActive = activeSubsystemId == null
  const overallActive = activeSubsystemId === OVERALL_ID
  const showOverall = dependents.length >= 1
  const tabs: Array<{ id: string | null; label: string; type: 'primary' | 'dependent' }> = [
    { id: null, label: 'Primary system', type: 'primary' },
    ...dependents.map((s) => ({ id: s.id, label: s.name, type: 'dependent' as const })),
  ]

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        borderBottom: '1px solid var(--border-subtle)', flexShrink: 0,
      }}>
        {tabs.map((tab) => {
          const active = !overallActive && (tab.id === activeSubsystemId || (tab.id === null && primaryActive))
          return (
            <div
              key={tab.id ?? '__primary__'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 14px',
                borderBottom: active ? '2px solid var(--mod-dsm)' : '2px solid transparent',
                cursor: 'pointer',
              }}
              onClick={() => selectSubsystem(tab.id)}
            >
              <span style={{
                fontSize: 'var(--text-sm)',
                fontWeight: active ? 600 : 500,
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}>
                {tab.label}
              </span>
              {tab.type === 'dependent' && active && (
                <button
                  onClick={async (e) => {
                    e.stopPropagation()
                    if (!confirm(`Delete subsystem "${tab.label}"?`)) return
                    await removeDependent(tab.id as string)
                  }}
                  title="Delete subsystem"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text-tertiary)', padding: 2, display: 'flex',
                  }}
                >
                  <Trash2 size={12} strokeWidth={1.5} />
                </button>
              )}
            </div>
          )
        })}
        <button
          onClick={() => setShowAdd(true)}
          title="Add subsystem"
          style={{
            marginLeft: 4, padding: '6px 10px',
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center',
            fontSize: 'var(--text-xs)', fontWeight: 500, gap: 4,
          }}
        >
          <Plus size={12} strokeWidth={1.5} /> Add
        </button>

        {/* Overall system tab — only shown when ≥1 dependent exists. */}
        {showOverall && (
          <>
            <div style={{
              flex: 1,
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: 8,
              paddingRight: 2,
            }}>
              <div style={{
                width: 1, height: 20,
                backgroundColor: 'var(--border-default)',
                marginRight: 4,
              }} />
              <div
                onClick={() => selectSubsystem(OVERALL_ID)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px',
                  borderBottom: overallActive ? '2px solid var(--mod-dsm)' : '2px solid transparent',
                  cursor: 'pointer',
                }}
                title="Aggregate material flows across all linked subsystems"
              >
                <Layers size={12} strokeWidth={1.5} style={{
                  color: overallActive ? 'var(--text-primary)' : 'var(--text-tertiary)',
                }} />
                <span style={{
                  fontSize: 'var(--text-sm)',
                  fontWeight: overallActive ? 600 : 500,
                  color: overallActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}>
                  Overall system
                </span>
              </div>
            </div>
          </>
        )}
      </div>
      {showAdd && (
        <AddSubsystemDialog
          onClose={() => setShowAdd(false)}
          onCreated={(id) => selectSubsystem(id)}
        />
      )}
    </>
  )
}
