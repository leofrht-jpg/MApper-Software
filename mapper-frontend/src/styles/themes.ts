export type ThemeId = 'teal' | 'blue' | 'purple' | 'orange' | 'rose' | 'emerald'

export interface ThemePreset {
  id: ThemeId
  label: string
  accent: string
  accentHover: string
  accentMuted: string  // 10% opacity
  accentSubtle: string // 5% opacity
  accentBg: string     // rgba() for inline backgrounds
}

export const THEMES: Record<ThemeId, ThemePreset> = {
  teal: {
    id: 'teal',
    label: 'Teal',
    accent: '#14b8a6',
    accentHover: '#2dd4bf',
    accentMuted: '#14b8a61A',
    accentSubtle: '#14b8a60D',
    accentBg: 'rgba(20, 184, 166, 0.1)',
  },
  blue: {
    id: 'blue',
    label: 'Blue',
    accent: '#3b82f6',
    accentHover: '#60a5fa',
    accentMuted: '#3b82f61A',
    accentSubtle: '#3b82f60D',
    accentBg: 'rgba(59, 130, 246, 0.1)',
  },
  purple: {
    id: 'purple',
    label: 'Purple',
    accent: '#8b5cf6',
    accentHover: '#a78bfa',
    accentMuted: '#8b5cf61A',
    accentSubtle: '#8b5cf60D',
    accentBg: 'rgba(139, 92, 246, 0.1)',
  },
  orange: {
    id: 'orange',
    label: 'Orange',
    accent: '#f97316',
    accentHover: '#fb923c',
    accentMuted: '#f973161A',
    accentSubtle: '#f973160D',
    accentBg: 'rgba(249, 115, 22, 0.1)',
  },
  rose: {
    id: 'rose',
    label: 'Rose',
    accent: '#f43f5e',
    accentHover: '#fb7185',
    accentMuted: '#f43f5e1A',
    accentSubtle: '#f43f5e0D',
    accentBg: 'rgba(244, 63, 94, 0.1)',
  },
  emerald: {
    id: 'emerald',
    label: 'Emerald',
    accent: '#10b981',
    accentHover: '#34d399',
    accentMuted: '#10b9811A',
    accentSubtle: '#10b9810D',
    accentBg: 'rgba(16, 185, 129, 0.1)',
  },
}

export const THEME_ORDER: ThemeId[] = ['teal', 'blue', 'purple', 'orange', 'rose', 'emerald']
export const DEFAULT_THEME: ThemeId = 'teal'
export const THEME_STORAGE_KEY = 'mapper-theme'

export function applyTheme(theme: ThemePreset) {
  const root = document.documentElement
  root.style.setProperty('--accent', theme.accent)
  root.style.setProperty('--accent-hover', theme.accentHover)
  root.style.setProperty('--accent-muted', theme.accentMuted)
  root.style.setProperty('--accent-subtle', theme.accentSubtle)
  root.style.setProperty('--border-focus', theme.accent)
  root.style.setProperty('--mod-lca', theme.accent)
  root.style.setProperty('--chart-1', theme.accent)
}

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && v in THEMES
}
