/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useMemo } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle } from 'lucide-react'
import { Diagnostic } from '../ui/Diagnostic'
import type {
  ValidationGroup,
  ValidationIssue,
  ValidationReport,
  ValidationSeverity,
} from '../../api/client'

interface Props {
  report: ValidationReport
  archetypeName?: string
  onAccept?: () => void
  onReupload?: () => void
}

export function ValidationReportPanel({ report, archetypeName, onAccept, onReupload }: Props) {
  const { valid_rows, error_rows, warning_rows, total_rows, groups } = report
  const errGroups = useMemo(() => groups.filter((g) => g.severity === 'error'), [groups])
  const warnGroups = useMemo(() => groups.filter((g) => g.severity === 'warning'), [groups])

  return (
    <div style={{
      marginTop: 'var(--space-3)',
      padding: 'var(--space-3) var(--space-4)',
      backgroundColor: 'var(--bg-elevated)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-md)',
      fontSize: 'var(--text-xs)',
      color: 'var(--text-secondary)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <strong style={{ color: 'var(--text-primary)', fontSize: 'var(--text-sm)' }}>
          Validation report{archetypeName ? ` · ${archetypeName}` : ''}
        </strong>
        <Stat dotColor="var(--success)" icon={<CheckCircle size={11} />} label={`${valid_rows} valid`} />
        <Stat dotColor="var(--danger)" icon={<AlertCircle size={11} />} label={`${error_rows} errors`} highlight={error_rows > 0} />
        <Stat dotColor="var(--warning)" icon={<AlertTriangle size={11} />} label={`${warning_rows} warnings`} />
        <span style={{ color: 'var(--text-tertiary)' }}>· {total_rows} rows total</span>
      </div>

      {error_rows === 0 && warning_rows === 0 && (
        <p style={{ margin: '8px 0 0 0', color: 'var(--success)' }}>
          All BOM rows resolve to ecoinvent activities. Ready to compute.
        </p>
      )}

      {errGroups.length > 0 && (
        <GroupList severity="error" groups={errGroups} issues={report.issues} />
      )}
      {warnGroups.length > 0 && (
        <GroupList severity="warning" groups={warnGroups} issues={report.issues} />
      )}

      {(onAccept || onReupload) && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {onAccept && (
            <button
              onClick={onAccept}
              style={{
                height: 28, padding: '0 12px', fontSize: 'var(--text-xs)',
                backgroundColor: 'var(--mod-lca)', color: '#0a1414',
                border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 600,
              }}
            >
              Accept and view archetype
            </button>
          )}
          {onReupload && (
            <button
              onClick={onReupload}
              style={{
                height: 28, padding: '0 12px', fontSize: 'var(--text-xs)',
                backgroundColor: 'transparent', color: 'var(--text-primary)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)', cursor: 'pointer',
              }}
            >
              Re-upload corrected file
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ dotColor, icon, label, highlight }: {
  dotColor: string; icon: React.ReactNode; label: string; highlight?: boolean
}) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      color: highlight ? dotColor : 'var(--text-secondary)',
      fontWeight: highlight ? 600 : 400,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%', backgroundColor: dotColor, display: 'inline-block',
      }} />
      {icon}
      {label}
    </span>
  )
}

function GroupList({ severity, groups, issues }: { severity: ValidationSeverity; groups: ValidationGroup[]; issues: ValidationIssue[] }) {
  const color = severity === 'error' ? 'var(--danger)' : 'var(--warning)'
  const heading = severity === 'error'
    ? `Errors: ${groups.length} unique issue${groups.length === 1 ? '' : 's'} (block compute)`
    : `Warnings: ${groups.length} unique issue${groups.length === 1 ? '' : 's'}`

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{
        fontSize: 'var(--text-xs)', fontWeight: 600, color,
        textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', marginBottom: 6,
      }}>
        {heading}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {groups.map((g, idx) => <GroupRow key={`${severity}-${idx}`} group={g} issues={issues} />)}
      </div>
    </div>
  )
}

/** The original backend text of every row in a group: what the Details toggle shows. */
function groupMessage(group: ValidationGroup, issues: ValidationIssue[]): string {
  return group.affected.map((a) => {
    const hit = issues.find((i) => i.error_type === group.error_type && i.archetype === a.archetype
      && i.stage === a.stage && i.row_idx === a.row_idx && i.name === a.name)
    return hit ? hit.message : `${a.archetype} / ${a.stage} · ${a.name} · row ${a.row_idx}`
  }).join('\n')
}

/** One line per group (marker, count, summary, Help); the original messages behind Details. */
function GroupRow({ group, issues }: { group: ValidationGroup; issues: ValidationIssue[] }) {
  return (
    <Diagnostic
      code={group.error_type}
      severity={group.severity}
      count={group.count}
      params={{ count: group.count, value: group.bad_value, name: group.bom_name, row: group.affected.map((a) => a.row_idx) }}
      message={groupMessage(group, issues)}
      data-testid="validation-group"
    />
  )
}
