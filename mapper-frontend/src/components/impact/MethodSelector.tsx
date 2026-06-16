interface Method {
  key: string
  label: string
}

interface Props {
  methods: Method[]
  activeKey: string | null
  onChange: (key: string) => void
  testId?: string
}

// Patch 4C — single-active-method selector for chart views. The chart side
// of single-product Projected / Comparison renders ONE method at a time
// (per Patch 4C scope: "active method drives chart, no multi-method
// overlay"). The table view continues to show all methods at once.
export function MethodSelector({ methods, activeKey, onChange, testId }: Props) {
  return (
    <select
      data-testid={testId}
      value={activeKey ?? ''}
      onChange={(e) => onChange(e.target.value)}
      style={{
        height: 32,
        padding: '0 8px',
        fontSize: 'var(--text-xs)',
        backgroundColor: 'var(--bg-elevated)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        maxWidth: 240,
      }}
    >
      {methods.map((m) => (
        <option key={m.key} value={m.key}>{m.label}</option>
      ))}
    </select>
  )
}
