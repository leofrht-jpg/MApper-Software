/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import React from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost'
type ButtonSize = 'sm' | 'md'

// `size` is not a standard <button> attribute, so it must be an explicit prop
// (and destructured out below so it never leaks onto the DOM node).
interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'size'> {
  variant?: ButtonVariant
  size?: ButtonSize
}

const sizeStyles: Record<ButtonSize, React.CSSProperties> = {
  sm: { height: 28, padding: '0 10px', fontSize: 'var(--text-xs)' },
  md: { height: 36, padding: '0 16px', fontSize: 'var(--text-sm)' },
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

export function Button({ variant = 'primary', size = 'md', style, children, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      style={{
        ...sizeStyles[size],
        borderRadius: 'var(--radius-md)',
        fontWeight: 500,
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
