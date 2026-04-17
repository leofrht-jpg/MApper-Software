import { create } from 'zustand'
import {
  type ImpactAssessmentRequest,
  type ImpactAssessmentResult,
  type ImpactCompareResult,
  type ImpactProgressMessage,
  type MFALCAResult,
  type ProspectiveScenarioRef,
  connectToImpactTask,
  getImpactResults,
  startImpactCalculation,
} from '../api/client'
import { useProjectStore } from './projectStore'

export interface ImpactJob {
  taskId: string
  mode: 'static' | 'projected'
  stage: string
  pct: number
  done: boolean
  error: string | null
}

interface ImpactStore {
  staticJob: ImpactJob | null
  projectedJob: ImpactJob | null
  staticResult: ImpactAssessmentResult | null
  projectedResult: ImpactAssessmentResult | null
  compareResult: ImpactCompareResult | null
  error: string | null

  run: (body: ImpactAssessmentRequest) => Promise<void>
  compare: () => Promise<void>
  clearCompare: () => void
  reset: () => void
  /** Mirror a static-mode MFA×LCA calculation into staticResult so Comparison
   * and Export flows can pick it up without re-running the LCA through
   * /impact/calculate. Use a synthetic task_id that the Export endpoint treats
   * as a direct-payload run. */
  setStaticFromMFA: (args: {
    mfaSystemId: string
    results: MFALCAResult[]
    scope: 'inflows' | 'outflows' | 'stock' | 'all'
    yearStart: number | null
    yearEnd: number | null
    baseDb?: string | null
  }) => void
  clearStatic: () => void
}

export const useImpactStore = create<ImpactStore>((set, get) => {
  let staticSocket: WebSocket | null = null
  let projectedSocket: WebSocket | null = null

  const closeSocket = (mode: 'static' | 'projected') => {
    const s = mode === 'static' ? staticSocket : projectedSocket
    try { s?.close() } catch { /* ignore */ }
    if (mode === 'static') staticSocket = null
    else projectedSocket = null
  }

  const run: ImpactStore['run'] = async (body) => {
    set({ error: null })
    const { task_id } = await startImpactCalculation(body)
    const job: ImpactJob = {
      taskId: task_id,
      mode: body.mode,
      stage: 'queued',
      pct: 0,
      done: false,
      error: null,
    }
    if (body.mode === 'static') set({ staticJob: job, staticResult: null, compareResult: null })
    else set({ projectedJob: job, projectedResult: null, compareResult: null })

    closeSocket(body.mode)
    const sock = connectToImpactTask(task_id, async (msg: ImpactProgressMessage) => {
      const cur = body.mode === 'static' ? get().staticJob : get().projectedJob
      if (!cur || cur.taskId !== task_id) return
      if (msg.type === 'progress') {
        const patch = { ...cur, stage: msg.stage ?? cur.stage, pct: msg.pct ?? cur.pct }
        if (body.mode === 'static') set({ staticJob: patch })
        else set({ projectedJob: patch })
      } else if (msg.type === 'done') {
        const patch = { ...cur, done: true, pct: 1, stage: 'done' }
        if (body.mode === 'static') set({ staticJob: patch })
        else set({ projectedJob: patch })
        try {
          const result = await getImpactResults(task_id)
          if (body.mode === 'static') set({ staticResult: result })
          else set({ projectedResult: result })
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e)
          const patch2 = { ...patch, error: err }
          if (body.mode === 'static') set({ staticJob: patch2 })
          else set({ projectedJob: patch2 })
        }
        closeSocket(body.mode)
      } else if (msg.type === 'error') {
        const patch = { ...cur, done: true, error: msg.error ?? 'unknown error' }
        if (body.mode === 'static') set({ staticJob: patch })
        else set({ projectedJob: patch })
        closeSocket(body.mode)
      }
    }, () => {
      const cur = body.mode === 'static' ? get().staticJob : get().projectedJob
      if (cur && !cur.done) {
        const patch = { ...cur, error: 'connection lost' }
        if (body.mode === 'static') set({ staticJob: patch })
        else set({ projectedJob: patch })
      }
    })
    if (body.mode === 'static') staticSocket = sock
    else projectedSocket = sock
  }

  const compare: ImpactStore['compare'] = async () => {
    const s = get().staticResult
    const p = get().projectedResult
    if (!s || !p) {
      set({ error: 'Both Static and Projected runs must complete first.' })
      return
    }
    try {
      const compareResult = buildCompareClientSide(s, p)
      set({ compareResult })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  }

  return {
    staticJob: null,
    projectedJob: null,
    staticResult: null,
    projectedResult: null,
    compareResult: null,
    error: null,

    run,
    compare,
    clearCompare: () => set({ compareResult: null }),

    setStaticFromMFA: ({ mfaSystemId, results, scope, yearStart, yearEnd, baseDb }) => {
      if (!results.length) return
      const synthetic: ImpactAssessmentResult = {
        task_id: `mfa-mirror-${mfaSystemId}-${Date.now()}`,
        meta: {
          mode: 'static',
          mfa_system_id: mfaSystemId,
          scope,
          year_start: yearStart,
          year_end: yearEnd,
          base_db: baseDb ?? null,
          scenario: null,
          year_to_database: {},
        },
        results,
      }
      set({ staticResult: synthetic, compareResult: null })
    },

    clearStatic: () => {
      closeSocket('static')
      set({ staticJob: null, staticResult: null, compareResult: null })
    },

    reset: () => {
      closeSocket('static')
      closeSocket('projected')
      set({
        staticJob: null,
        projectedJob: null,
        staticResult: null,
        projectedResult: null,
        compareResult: null,
        error: null,
      })
    },
  }
})

/** Compute static vs projected comparison from the two results held in the
 * store. Mirrors the backend /impact/compare logic so synthetic static
 * results (MFA mirror) can be compared without a backend round-trip. */
function buildCompareClientSide(
  s: ImpactAssessmentResult,
  p: ImpactAssessmentResult,
): ImpactCompareResult {
  if (s.meta.mfa_system_id !== p.meta.mfa_system_id) {
    throw new Error('Comparison requires both runs on the same MFA system.')
  }
  if (s.meta.scope !== p.meta.scope) {
    throw new Error('Comparison requires both runs in the same scope.')
  }
  const keyOf = (m: string[]) => m.join('|')
  const sByMethod = new Map(s.results.map((r) => [keyOf(r.method), r]))
  const methodsOut: ImpactCompareResult['methods'] = []
  for (const pr of p.results) {
    const sr = sByMethod.get(keyOf(pr.method))
    if (!sr) continue
    const sYears = new Map(sr.years.map((y) => [y.year, y.total_impact]))
    const pYears = new Map(pr.years.map((y) => [y.year, y.total_impact]))
    const years = Array.from(new Set([...sYears.keys(), ...pYears.keys()])).sort((a, b) => a - b)
    let totalS = 0, totalP = 0
    const points = years.map((y) => {
      const sv = sYears.get(y) ?? 0
      const pv = pYears.get(y) ?? 0
      const delta = pv - sv
      totalS += sv
      totalP += pv
      return {
        year: y,
        static_impact: sv,
        projected_impact: pv,
        delta,
        delta_pct: sv !== 0 ? (delta / Math.abs(sv)) * 100 : null,
      }
    })
    const totalDelta = totalP - totalS
    methodsOut.push({
      method: pr.method,
      method_label: pr.method_label || pr.method.join(' › '),
      unit: pr.unit || sr.unit,
      points,
      total_static: totalS,
      total_projected: totalP,
      total_delta: totalDelta,
      total_delta_pct: totalS !== 0 ? (totalDelta / Math.abs(totalS)) * 100 : null,
    })
  }
  return {
    mfa_system_id: s.meta.mfa_system_id,
    scope: s.meta.scope,
    methods: methodsOut,
  }
}

// Reset on project change.
let _lastProject: string | null = useProjectStore.getState().currentProject
useProjectStore.subscribe((state) => {
  if (state.currentProject === _lastProject) return
  _lastProject = state.currentProject
  useImpactStore.getState().reset()
})

export type { ProspectiveScenarioRef }
