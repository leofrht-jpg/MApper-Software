import { TrendingDown, TrendingUp, Minus } from 'lucide-react'
import type { AESAIndicatorResult } from '../../api/client'

interface IndicatorCardProps {
  indicator: AESAIndicatorResult
  trend?: 'improving' | 'stable' | 'worsening' | null
}

const statusColor: Record<AESAIndicatorResult['status'], string> = {
  safe: 'var(--success)',
  caution: 'var(--warning)',
  exceeded: 'var(--danger)',
}

const fmt = (n: number) => {
  if (n === 0) return '0'
  const a = Math.abs(n)
  if (a >= 1000 || a < 0.01) return n.toExponential(2)
  return n.toLocaleString(undefined, { maximumFractionDigits: 3 })
}

export function IndicatorCard({ indicator, trend }: IndicatorCardProps) {
  const color = statusColor[indicator.status]
  const pct = Math.min(100, Math.max(0, indicator.ratio * 100))
  const TrendIcon = trend === 'worsening' ? TrendingUp : trend === 'improving' ? TrendingDown : Minus
  const trendColor = trend === 'worsening' ? 'var(--danger)' : trend === 'improving' ? 'var(--success)' : 'var(--text-tertiary)'

  return (
    <div style={{
      backgroundColor: 'var(--bg-surface)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-lg)',
      padding: 'var(--space-4)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            color: 'var(--text-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {indicator.boundary_name}
          </div>
          <div style={{
            fontSize: 10,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-wide)',
            marginTop: 2,
          }}>
            {indicator.status}
          </div>
        </div>
        {trend && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: trendColor, fontSize: 'var(--text-xs)' }}>
            <TrendIcon size={14} strokeWidth={1.75} />
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color, letterSpacing: 'var(--tracking-tight)' }}>
          {indicator.ratio.toFixed(2)}×
        </span>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>of threshold</span>
      </div>

      <div style={{
        width: '100%', height: 8,
        backgroundColor: 'var(--bg-elevated)',
        borderRadius: 'var(--radius-full)',
        overflow: 'hidden',
        position: 'relative',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          backgroundColor: color,
          borderRadius: 'var(--radius-full)',
          transition: 'width var(--duration-normal) var(--ease-out)',
        }} />
        {indicator.ratio > 1 && (
          <div style={{
            position: 'absolute', top: 0, bottom: 0, left: '100%',
            width: 2, backgroundColor: 'var(--danger)',
          }} />
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 'var(--text-xs)' }}>
        <div>
          <div style={{ color: 'var(--text-tertiary)' }}>Impact</div>
          <div style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{fmt(indicator.impact_value)}</div>
        </div>
        <div>
          <div style={{ color: 'var(--text-tertiary)' }}>Threshold</div>
          <div style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{fmt(indicator.threshold_value)}</div>
        </div>
      </div>
      {indicator.unit && (
        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: -4 }}>
          {indicator.unit}
        </div>
      )}
    </div>
  )
}
