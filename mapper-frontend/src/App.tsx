import { useEffect } from 'react'
import { Shell } from './components/layout/Shell'
import { AESADashboard } from './pages/AESADashboard'
import { DatabaseExplorer } from './pages/DatabaseExplorer'
import { ImpactAssessment } from './pages/ImpactAssessment'
import { LCAPage } from './pages/LCAPage'
import { MFADashboard } from './pages/MFADashboard'
import { PLCADeveloper } from './pages/PLCADeveloper'
import { SettingsPage } from './pages/SettingsPage'
import { useProjectStore } from './stores/projectStore'
import { useThemeStore } from './stores/themeStore'

function App() {
  const { fetchProjects, fetchDatabases } = useProjectStore()
  const initTheme = useThemeStore((s) => s.initTheme)

  useEffect(() => {
    initTheme()
  }, [initTheme])

  useEffect(() => {
    fetchProjects().then(() => fetchDatabases())
  }, [fetchProjects, fetchDatabases])

  return (
    <Shell>
      {(activeItem, setActiveItem) => {
        if (activeItem === 'databases') {
          return <DatabaseExplorer />
        }
        if (activeItem === 'lca') {
          return (
            <LCAPage
              onNavigateToExplorer={() => setActiveItem('databases')}
            />
          )
        }
        if (activeItem === 'mfa') {
          return <MFADashboard />
        }
        if (activeItem === 'plca') {
          return <PLCADeveloper />
        }
        if (activeItem === 'impact') {
          return <ImpactAssessment />
        }
        if (activeItem === 'aesa') {
          return <AESADashboard />
        }
        if (activeItem === 'settings') {
          return <SettingsPage />
        }
        return (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)', fontSize: 'var(--text-base)' }}>
            Select a database to get started
          </div>
        )
      }}
    </Shell>
  )
}

export default App
