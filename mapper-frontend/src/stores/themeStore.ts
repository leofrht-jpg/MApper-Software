import { create } from 'zustand'
import {
  DEFAULT_THEME,
  THEMES,
  THEME_STORAGE_KEY,
  applyTheme,
  isThemeId,
  type ThemeId,
  type ThemePreset,
} from '../styles/themes'

interface ThemeStore {
  themeId: ThemeId
  theme: ThemePreset
  setTheme: (id: ThemeId) => void
  initTheme: () => void
}

function readStored(): ThemeId {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    return isThemeId(raw) ? raw : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

export const useThemeStore = create<ThemeStore>((set) => ({
  themeId: readStored(),
  theme: THEMES[readStored()],

  setTheme: (id) => {
    const theme = THEMES[id]
    applyTheme(theme)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, id)
    } catch {
      // ignore quota / privacy-mode errors
    }
    set({ themeId: id, theme })
  },

  initTheme: () => {
    const id = readStored()
    applyTheme(THEMES[id])
    set({ themeId: id, theme: THEMES[id] })
  },
}))
