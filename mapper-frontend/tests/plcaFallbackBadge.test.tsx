/**
 * A superstructure fallback is visible in the pLCA database list, durably.
 *
 * `fallback_warning` reaches the task and the WS `done` frame, so the fallback
 * was never silent — but a dismissed toast left nothing behind, and the
 * registry list is what someone reads months later.
 *
 * The badge is NOT a quality signal. The content is identical either way: the
 * fallback fires only in premise's WRITE step, after the transformation has
 * already produced the per-year databases. It says how the databases came to
 * be written, not that they are worse.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PLCADeveloper } from '../src/pages/PLCADeveloper'
import { usePLCAStore } from '../src/stores/plcaStore'
import { useProjectStore } from '../src/stores/projectStore'
import type { ProspectiveDB } from '../src/api/client'

function db(over: Partial<ProspectiveDB> = {}): ProspectiveDB {
  return {
    name: 'ei_premise_remind_ssp2_2030',
    base_db: 'ei',
    iam: 'remind',
    ssp: 'SSP2-PkBudg1150',
    year: 2030,
    years: [2030],
    mode: 'separate',
    created_at: '2026-04-24T09:40:07Z',
    ...over,
  }
}

function seed(dbs: ProspectiveDB[]) {
  usePLCAStore.setState({ databases: dbs, isLoading: false, error: null } as never)
  useProjectStore.setState({ databases: [], currentProject: 'p' } as never)
}

describe('pLCA fallback badge', () => {
  it('is absent for an ordinary separate-mode database', () => {
    seed([db()])
    render(<PLCADeveloper />)
    expect(screen.queryByTestId('plca-fallback-badge')).toBeNull()
  })

  it('appears when the entry came from the superstructure fallback', () => {
    seed([db({ fallback: true })])
    render(<PLCADeveloper />)
    const badge = screen.getByTestId('plca-fallback-badge')
    expect(badge.textContent).toMatch(/fallback/i)
  })

  it('explains that the CONTENT is the same, not that it is degraded', () => {
    seed([db({ fallback: true })])
    render(<PLCADeveloper />)
    const title = screen.getByTestId('plca-fallback-badge').getAttribute('title') ?? ''
    expect(title).toMatch(/content is the same/i)
    // And why per-year is the useful form, which is the whole reason there is
    // no opt-in flag.
    expect(title).toMatch(/compute against/i)
  })

  it('treats a missing flag as false, so pre-existing entries are unmarked', () => {
    const legacy = db()
    delete (legacy as Partial<ProspectiveDB>).fallback
    seed([legacy as ProspectiveDB])
    render(<PLCADeveloper />)
    expect(screen.queryByTestId('plca-fallback-badge')).toBeNull()
  })
})
