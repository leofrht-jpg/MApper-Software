import { Loader2, Square } from 'lucide-react'
import { Button } from './Button'

interface StopButtonProps {
  /** id of the task to cancel; required so the click handler can issue
   *  the cancel POST. When null the button is hidden — that branch keeps
   *  the parent layout stable across the idle → running transition. */
  taskId: string | null
  /** State machine driven by ``useCancellableTask``. ``stopping`` is a
   *  transient ack state covering the round-trip after click; the worker
   *  is the source of truth for terminal state. */
  state: 'idle' | 'running' | 'stopping'
  onClick: () => void
  style?: React.CSSProperties
}

export function StopButton({ taskId, state, onClick, style }: StopButtonProps) {
  if (taskId == null || state === 'idle') return null
  const stopping = state === 'stopping'
  return (
    <Button
      variant="secondary"
      onClick={onClick}
      disabled={stopping}
      title={stopping ? 'Stopping…' : 'Stop the current operation'}
      style={{
        color: stopping ? 'var(--text-secondary)' : 'var(--accent-danger, #c0392b)',
        borderColor: stopping
          ? 'var(--border-default)'
          : 'var(--accent-danger, #c0392b)',
        cursor: stopping ? 'wait' : 'pointer',
        ...style,
      }}
    >
      {stopping ? (
        <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
      ) : (
        <Square size={12} fill="currentColor" />
      )}
      {stopping ? 'Stopping…' : 'Stop'}
    </Button>
  )
}
