import { forwardRef, useState, type InputHTMLAttributes, type Ref } from 'react'
import { Search, X } from 'lucide-react'

type Size = 'sm' | 'md'

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'onChange'> {
  value: string
  onChange: (value: string) => void
  onClear?: () => void
  size?: Size
  showClear?: boolean
  placeholder?: string
  trailing?: React.ReactNode
}

const SIZES: Record<Size, {
  height: number
  iconSize: number
  iconStroke: number
  iconLeft: number
  padLeft: number
  padRight: number
  fontSize: string
}> = {
  sm: { height: 28, iconSize: 12, iconStroke: 2, iconLeft: 8, padLeft: 26, padRight: 10, fontSize: 'var(--text-xs)' },
  md: { height: 36, iconSize: 16, iconStroke: 1.5, iconLeft: 10, padLeft: 34, padRight: 12, fontSize: 'var(--text-sm)' },
}

/** Shared search input with a leading icon, consistent focus ring, and an
 *  optional trailing clear button. Use `size="md"` (default) for primary
 *  search bars; `size="sm"` for dense sidebars or inline filters. */
export const SearchInput = forwardRef(function SearchInput(
  {
    value, onChange, onClear, size = 'md', showClear = true,
    placeholder = 'Search…', trailing, style, ...rest
  }: Props,
  ref: Ref<HTMLInputElement>,
) {
  const [focused, setFocused] = useState(false)
  const s = SIZES[size]
  const hasValue = value.length > 0
  const canClear = showClear && hasValue && (onClear !== undefined || onChange !== undefined)
  const padRight = canClear ? Math.max(s.padRight, 32) : (trailing ? Math.max(s.padRight, 28) : s.padRight)

  const handleClear = () => {
    if (onClear) onClear()
    else onChange('')
  }

  return (
    <div style={{ position: 'relative' }}>
      <Search
        size={s.iconSize}
        strokeWidth={s.iconStroke}
        style={{
          position: 'absolute', left: s.iconLeft, top: '50%',
          transform: 'translateY(-50%)',
          color: 'var(--text-tertiary)', pointerEvents: 'none',
        }}
      />
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (canClear && e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            handleClear()
          }
          rest.onKeyDown?.(e)
        }}
        onFocus={(e) => { setFocused(true); rest.onFocus?.(e) }}
        onBlur={(e) => { setFocused(false); rest.onBlur?.(e) }}
        placeholder={placeholder}
        style={{
          width: '100%',
          height: s.height,
          paddingLeft: s.padLeft,
          paddingRight: padRight,
          backgroundColor: 'var(--bg-elevated)',
          border: `1px solid ${focused ? 'var(--border-focus)' : 'var(--border-default)'}`,
          boxShadow: focused ? '0 0 0 3px var(--accent-muted)' : 'none',
          borderRadius: 'var(--radius-md)',
          color: 'var(--text-primary)',
          fontSize: s.fontSize,
          outline: 'none',
          transition: 'border-color var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out)',
          ...style,
        }}
        {...rest}
      />
      {canClear && (
        <button
          type="button"
          onClick={handleClear}
          aria-label="Clear search"
          title="Clear search (Esc)"
          style={{
            position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
            width: size === 'md' ? 24 : 20, height: size === 'md' ? 24 : 20,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent', border: 'none',
            borderRadius: 'var(--radius-full)',
            color: 'var(--text-tertiary)', cursor: 'pointer', padding: 0,
            transition: 'background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-tertiary)' }}
        >
          <X size={size === 'md' ? 16 : 12} strokeWidth={1.5} />
        </button>
      )}
      {!canClear && trailing && (
        <span style={{
          position: 'absolute', right: s.iconLeft, top: '50%',
          transform: 'translateY(-50%)',
          fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)',
          pointerEvents: 'none',
        }}>
          {trailing}
        </span>
      )}
    </div>
  )
})
