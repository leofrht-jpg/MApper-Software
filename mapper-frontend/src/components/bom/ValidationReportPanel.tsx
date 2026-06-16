import { useMemo, useState } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle, ChevronDown, ChevronRight } from 'lucide-react'
import type {
  ValidationErrorType,
  ValidationGroup,
  ValidationReport,
  ValidationSeverity,
} from '../../api/client'

interface Props {
  report: ValidationReport
  archetypeName?: string
  onAccept?: () => void
  onReupload?: () => void
}

const ERROR_TYPE_LABELS: Record<ValidationErrorType, string> = {
  code_truncated: 'Truncated code',
  code_not_found: 'Code not in database',
  database_missing: 'Database not installed',
  code_no_database: 'Code without database',
  database_no_code: 'Database without code',
  name_mismatch: 'Name mismatch',
  location_mismatch: 'Location mismatch',
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
        <GroupList severity="error" groups={errGroups} />
      )}
      {warnGroups.length > 0 && (
        <GroupList severity="warning" groups={warnGroups} />
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

function GroupList({ severity, groups }: { severity: ValidationSeverity; groups: ValidationGroup[] }) {
  const color = severity === 'error' ? 'var(--danger)' : 'var(--warning)'
  const heading = severity === 'error'
    ? `Errors — ${groups.length} unique issue${groups.length === 1 ? '' : 's'} (block compute)`
    : `Warnings — ${groups.length} unique issue${groups.length === 1 ? '' : 's'}`

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{
        fontSize: 'var(--text-xs)', fontWeight: 600, color,
        textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', marginBottom: 6,
      }}>
        {heading}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {groups.map((g, idx) => <GroupRow key={`${severity}-${idx}`} group={g} />)}
      </div>
    </div>
  )
}

function GroupRow({ group }: { group: ValidationGroup }) {
  const [open, setOpen] = useState(false)
  const color = group.severity === 'error' ? 'var(--danger)' : 'var(--warning)'
  const visible = open ? group.affected : group.affected.slice(0, 5)
  const hasMore = group.affected.length > 5

  return (
    <div style={{
      border: '1px solid var(--border-subtle)',
      borderLeft: `3px solid ${color}`,
      borderRadius: 'var(--radius-sm)',
      backgroundColor: 'var(--bg-surface)',
      padding: '6px 10px',
    }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          all: 'unset', cursor: 'pointer', display: 'flex',
          alignItems: 'center', gap: 6, width: '100%',
        }}
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <strong style={{ color: 'var(--text-primary)' }}>
          {group.count}× {ERROR_TYPE_LABELS[group.error_type]}
        </strong>
        {group.bad_value && (
          <code style={{
            fontFamily: 'var(--font-mono)', fontSize: 11,
            padding: '1px 6px', backgroundColor: 'var(--bg-elevated)',
            borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)',
            maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {group.bad_value}
          </code>
        )}
        {group.bom_name && (
          <span style={{ color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            · {group.bom_name}
          </span>
        )}
      </button>
      {open && (
        <ul style={{ margin: '6px 0 0 22px', paddingLeft: 0, listStyle: 'none' }}>
          {visible.map((a, i) => (
            <li key={i} style={{ color: 'var(--text-tertiary)', padding: '1px 0' }}>
              <span style={{ color: 'var(--text-secondary)' }}>{a.archetype}</span>
              {' / '}
              <span style={{ color: 'var(--text-secondary)' }}>{a.stage}</span>
              {' · '}
              <span>{a.name}</span>
              <span style={{ color: 'var(--text-tertiary)', marginLeft: 6 }}>row {a.row_idx}</span>
            </li>
          ))}
          {!open && hasMore && (
            <li style={{ color: 'var(--text-tertiary)' }}>…and {group.affected.length - 5} more</li>
          )}
        </ul>
      )}
    </div>
  )
}
