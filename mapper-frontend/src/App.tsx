/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useEffect, useState } from 'react'
import { Shell } from './components/layout/Shell'
import { AESADashboard } from './pages/AESADashboard'
import { DatabaseExplorer } from './pages/DatabaseExplorer'
import { ImpactAssessment } from './pages/ImpactAssessment'
import { LCAPage } from './pages/LCAPage'
import { DSMDashboard } from './pages/DSMDashboard'
import { PLCADeveloper } from './pages/PLCADeveloper'
import { SettingsPage } from './pages/SettingsPage'
import { useProjectStore } from './stores/projectStore'
import { useThemeStore } from './stores/themeStore'
import { OnboardingTour, hasCompletedOnboarding } from './components/OnboardingTour'
import { configureProjectGuard } from './api/client'

// Global helper so the Settings page can re-trigger the tour without
// pulling App state into a context.
declare global {
  interface Window {
    __mapperStartTour?: () => void
  }
}

function App() {
  const { fetchProjects, fetchDatabases } = useProjectStore()
  const initTheme = useThemeStore((s) => s.initTheme)
  const [tourRun, setTourRun] = useState(false)

  useEffect(() => {
    initTheme()
  }, [initTheme])

  useEffect(() => {
    fetchProjects().then(() => fetchDatabases())
  }, [fetchProjects, fetchDatabases])

  // Patch X1+++ — wire the project-state-desync guard. The client
  // sends X-Mapper-Project on every request; if the backend's bw2
  // project differs (most commonly after a backend restart that
  // reset bw2 to "default"), it 409s and we trigger an immediate
  // re-sync via fetchProjects(). Avoids silent write misrouting.
  useEffect(() => {
    configureProjectGuard(
      () => useProjectStore.getState().currentProject,
      (detail) => {
        console.warn('[project-guard] mismatch detected, re-syncing:', detail)
        void useProjectStore.getState().fetchProjects()
      },
    )
  }, [])

  // Auto-start on first launch.
  useEffect(() => {
    if (!hasCompletedOnboarding()) {
      // Delay one tick so the sidebar has mounted before Joyride queries targets.
      const id = setTimeout(() => setTourRun(true), 300)
      return () => clearTimeout(id)
    }
  }, [])

  // Expose a restart hook for Settings → "Restart tour".
  useEffect(() => {
    window.__mapperStartTour = () => setTourRun(true)
    return () => { delete window.__mapperStartTour }
  }, [])

  return (
    <>
      {tourRun && <OnboardingTour run={tourRun} onFinish={() => setTourRun(false)} />}
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
          if (activeItem === 'dsm') {
            return <DSMDashboard />
          }
          if (activeItem === 'plca') {
            return <PLCADeveloper />
          }
          if (activeItem === 'impact') {
            return <ImpactAssessment onNavigate={setActiveItem} />
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
    </>
  )
}

export default App
