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
