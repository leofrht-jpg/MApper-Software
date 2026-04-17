import React from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

const styles: Record<ButtonVariant, React.CSSProperties> = {
  primary: {
    backgroundColor: 'var(--accent)',
    color: 'var(--text-inverse)',
    border: '1px solid transparent',
  },
  secondary: {
    backgroundColor: 'var(--bg-elevated)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-default)',
  },
  ghost: {
    backgroundColor: 'transparent',
    color: 'var(--text-secondary)',
    border: '1px solid transparent',
  },
}

export function Button({ variant = 'primary', style, children, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      style={{
        height: 36,
        padding: '0 16px',
        borderRadius: 'var(--radius-md)',
        fontWeight: 500,
        fontSize: 'var(--text-sm)',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        transition: `background-color var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out)`,
        outline: 'none',
        ...styles[variant],
        ...style,
      }}
    >
      {children}
    </button>
  )
}
