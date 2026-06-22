/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { create } from 'zustand'
import {
  type ImpactAssessmentRequest,
  type ImpactAssessmentResult,
  type ImpactCompareResult,
  type ImpactProgressMessage,
  type DSMLCAResult,
  type MultiScenarioProjectedImpactResult,
  type PairedDSMLCIRef,
  type ProspectiveScenarioRef,
  connectToImpactTask,
  getImpactResults,
  isMultiScenarioProjected,
  pairKey,
  startImpactCalculation,
  startImpactScenarios,
} from '../api/client'
import { useProjectStore } from './projectStore'

export interface ImpactJob {
  taskId: string
  mode: 'static' | 'projected'
  stage: string
  pct: number
  done: boolean
  error: string | null
  cancelled?: boolean
}

/** Per-scenario slot for multi-scenario runs. The UI exposes a scenario picker
 *  above the results panel that toggles which slot drives ``projectedJob`` /
 *  ``projectedResult``. */
export interface ScenarioRun {
  scenario: string
  job: ImpactJob
  result: ImpactAssessmentResult | null
}

interface ImpactStore {
  staticJob: ImpactJob | null
  projectedJob: ImpactJob | null
  staticResult: ImpactAssessmentResult | null
  projectedResult: ImpactAssessmentResult | null
  compareResult: ImpactCompareResult | null
  error: string | null

  /** Ordered list of parameter-scenario names submitted in the most recent
   *  Projected multi-parameter run. */
  projectedScenarioOrder: string[]
  /** Scenario-keyed buckets for the most recent Projected multi-parameter
   *  ``runScenarios`` call. */
  projectedScenarioRuns: Record<string, ScenarioRun>
  /** Which scenario is currently driving ``projectedJob`` / ``projectedResult``. */
  activeProjectedScenario: string | null

  /** Same triplet for Static multi-parameter runs. Static and Projected each
   *  own their own scenario slot so users can have multi-parameter results on
   *  both tabs simultaneously without one clobbering the other. */
  staticScenarioOrder: string[]
  staticScenarioRuns: Record<string, ScenarioRun>
  activeStaticScenario: string | null

  /** Multi-DSM-scenario fan-out — per-side slots. Static and Projected each
   *  own their own multi-DSM run so both sides can carry simultaneous lists
   *  for the Comparison tab to intersect (Patch 2G). Per-run bucket carries
   *  both id (key) and the human-readable name echoed from ``DSMScenario.name``
   *  at fan-out time.
   *
   *  The previous shared slot (``dsmScenarioOrder`` + ``dsmScenarioMode``
   *  discriminator) was retired here — running multi-DSM on one side used to
   *  clobber the other. Never reintroduce a shared multi-axis slot when both
   *  sides need to retain results simultaneously. */
  staticDsmScenarioOrder: string[]
  staticDsmScenarioRuns: Record<string, ScenarioRun & { scenarioName: string }>
  activeStaticDsmScenario: string | null

  projectedDsmScenarioOrder: string[]
  projectedDsmScenarioRuns: Record<string, ScenarioRun & { scenarioName: string }>
  activeProjectedDsmScenario: string | null

  /** Wrapper payload from a multi-LCI projected run. ``projectedResult`` is
   *  populated with the first scenario's nested ``ImpactAssessmentResult`` so
   *  legacy single-result consumers keep working; consumers that need to
   *  iterate or export across scenarios read this field directly. */
  projectedMultiResult: MultiScenarioProjectedImpactResult | null

  /** Paired DSM × LCI fan-out (Patch 2F). Projected-only (paired co-variation
   *  requires a prospective LCI on each pair). Single shared slot — only one
   *  paired run exists at a time, mutually exclusive with multi-DSM and
   *  multi-parameter per axisConflict. Pair-keyed buckets carry both halves
   *  of the pair (dsm_scenario_id + dsm_scenario_name + lci_scenario) so the
   *  detail UI and Excel envelope assembly stay self-contained. */
  pairedScenarioOrder: string[]
  pairedScenarioRuns: Record<string, ScenarioRun & {
    dsmScenarioId: string
    dsmScenarioName: string
    lciScenario: ProspectiveScenarioRef
  }>
  activePairedScenario: string | null

  run: (body: ImpactAssessmentRequest) => Promise<void>
  /** Launch ``scenarios.length`` impact tasks via ``POST /impact/calculate-scenarios``
   *  and poll each to completion. Routes to the static or projected scenario
   *  slot based on ``body.mode``. */
  runScenarios: (body: ImpactAssessmentRequest, scenarios: string[]) => Promise<void>
  /** Switch the displayed Projected scenario (updates ``projectedJob`` /
   *  ``projectedResult`` to point at that scenario's bucket). */
  selectProjectedScenario: (scenario: string) => void
  /** Switch the displayed Static scenario (updates ``staticJob`` /
   *  ``staticResult``). */
  selectStaticScenario: (scenario: string) => void
  /** Launch ``scenarioIds.length`` impact tasks via DSM-axis fan-out
   *  (``POST /impact/calculate-scenarios`` with ``dsm_scenario_ids``).
   *  ``scenarioNames`` is parallel to ``scenarioIds`` and carries the
   *  human-readable label echoed by the chip multi-select. */
  runDSMScenarios: (
    body: ImpactAssessmentRequest,
    scenarioIds: string[],
    scenarioNames: Record<string, string>,
  ) => Promise<void>
  /** Switch the displayed Static-side DSM scenario (bridges to
   *  ``staticJob/Result``). */
  selectStaticDsmScenario: (scenarioId: string) => void
  /** Switch the displayed Projected-side DSM scenario (bridges to
   *  ``projectedJob/Result``). */
  selectProjectedDsmScenario: (scenarioId: string) => void
  /** Launch ``pairs.length`` impact tasks via paired-axis fan-out
   *  (``POST /impact/calculate-scenarios`` with ``paired_scenarios``).
   *  ``dsmScenarioNames`` maps dsm_scenario_id → human-readable name (echoed
   *  by the chip multi-select). Paired runs always live on the Projected
   *  tab — bridges the active pair to ``projectedJob/Result``. */
  runPairedScenarios: (
    body: ImpactAssessmentRequest,
    pairs: PairedDSMLCIRef[],
    dsmScenarioNames: Record<string, string>,
  ) => Promise<void>
  /** Switch the active pair (updates ``projectedJob`` / ``projectedResult``
   *  to point at that pair's bucket). */
  selectPairedScenario: (pairKey: string) => void
  compare: () => Promise<void>
  clearCompare: () => void
  reset: () => void
  /** Mirror a static-mode DSM×LCA calculation into staticResult so Comparison
   * and Export flows can pick it up without re-running the LCA through
   * /impact/calculate. Use a synthetic task_id that the Export endpoint treats
   * as a direct-payload run. */
  setStaticFromMFA: (args: {
    mfaSystemId: string
    results: DSMLCAResult[]
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
  let scenarioSockets: Record<string, WebSocket> = {}

  const closeSocket = (mode: 'static' | 'projected') => {
    const s = mode === 'static' ? staticSocket : projectedSocket
    try { s?.close() } catch { /* ignore */ }
    if (mode === 'static') staticSocket = null
    else projectedSocket = null
  }

  const closeScenarioSockets = () => {
    for (const s of Object.values(scenarioSockets)) {
      try { s.close() } catch { /* ignore */ }
    }
    scenarioSockets = {}
  }

  const updateScenario = (mode: 'static' | 'projected', scen: string, patch: Partial<ScenarioRun>) => {
    if (mode === 'projected') {
      const cur = get().projectedScenarioRuns[scen]
      if (!cur) return
      const next = { ...get().projectedScenarioRuns, [scen]: { ...cur, ...patch } }
      set({ projectedScenarioRuns: next })
      if (get().activeProjectedScenario === scen) {
        set({ projectedJob: next[scen].job, projectedResult: next[scen].result })
      }
    } else {
      const cur = get().staticScenarioRuns[scen]
      if (!cur) return
      const next = { ...get().staticScenarioRuns, [scen]: { ...cur, ...patch } }
      set({ staticScenarioRuns: next })
      if (get().activeStaticScenario === scen) {
        set({ staticJob: next[scen].job, staticResult: next[scen].result })
      }
    }
  }

  const updateDsmScenario = (
    side: 'static' | 'projected',
    scenarioId: string,
    patch: Partial<ScenarioRun>,
  ) => {
    if (side === 'static') {
      const cur = get().staticDsmScenarioRuns[scenarioId]
      if (!cur) return
      const merged = { ...cur, ...patch }
      const next = { ...get().staticDsmScenarioRuns, [scenarioId]: merged }
      set({ staticDsmScenarioRuns: next })
      if (get().activeStaticDsmScenario === scenarioId) {
        set({ staticJob: merged.job, staticResult: merged.result })
      }
    } else {
      const cur = get().projectedDsmScenarioRuns[scenarioId]
      if (!cur) return
      const merged = { ...cur, ...patch }
      const next = { ...get().projectedDsmScenarioRuns, [scenarioId]: merged }
      set({ projectedDsmScenarioRuns: next })
      if (get().activeProjectedDsmScenario === scenarioId) {
        set({ projectedJob: merged.job, projectedResult: merged.result })
      }
    }
  }

  const run: ImpactStore['run'] = async (body) => {
    set({ error: null })
    if (body.mode === 'static') set({ staticJob: null })
    else set({ projectedJob: null })

    let task_id: string
    try {
      ;({ task_id } = await startImpactCalculation(body))
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      const failedJob: ImpactJob = {
        taskId: '', mode: body.mode,
        stage: 'failed', pct: 0, done: true, error: err,
      }
      if (body.mode === 'static') set({ staticJob: failedJob, error: err })
      else set({ projectedJob: failedJob, error: err })
      return
    }

    const job: ImpactJob = {
      taskId: task_id,
      mode: body.mode,
      stage: 'queued',
      pct: 0,
      done: false,
      error: null,
    }
    if (body.mode === 'static') set({ staticJob: job, staticResult: null, compareResult: null })
    else set({
      projectedJob: job,
      projectedResult: null,
      projectedMultiResult: null,
      compareResult: null,
    })

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
          if (body.mode === 'static') {
            // Static path is single-shape; cast back to the legacy result.
            set({ staticResult: result as ImpactAssessmentResult })
          } else if (isMultiScenarioProjected(result)) {
            // Multi-LCI projected: keep the wrapper, pin the first scenario's
            // nested result on ``projectedResult`` so the time-series chart and
            // headline keep rendering (Phase 2A: chart shows scenario 1 only).
            const first = result.scenarios[0]?.result ?? null
            set({ projectedMultiResult: result, projectedResult: first })
          } else {
            set({ projectedResult: result, projectedMultiResult: null })
          }
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
      } else if (msg.type === 'cancelled') {
        const patch = { ...cur, done: true, cancelled: true, stage: 'cancelled' }
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

  const runScenarios: ImpactStore['runScenarios'] = async (body, scenarios) => {
    if (!scenarios.length) return
    set({ error: null })
    closeScenarioSockets()

    const mode = body.mode

    let assignments: Record<string, string>
    try {
      const payload = { ...body, scenarios } as ImpactAssessmentRequest
      const resp = await startImpactScenarios(payload)
      assignments = resp.scenarios
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      return
    }

    const runs: Record<string, ScenarioRun> = {}
    for (const scen of scenarios) {
      const taskId = assignments[scen] ?? ''
      runs[scen] = {
        scenario: scen,
        job: {
          taskId,
          mode,
          stage: taskId ? 'queued' : 'failed',
          pct: 0,
          done: !taskId,
          error: taskId ? null : `No task_id returned for scenario '${scen}'`,
        },
        result: null,
      }
    }
    const firstScen = scenarios[0]
    if (mode === 'projected') {
      set({
        projectedScenarioOrder: scenarios,
        projectedScenarioRuns: runs,
        activeProjectedScenario: firstScen,
        projectedJob: runs[firstScen].job,
        projectedResult: null,
        projectedMultiResult: null,
        compareResult: null,
      })
    } else {
      set({
        staticScenarioOrder: scenarios,
        staticScenarioRuns: runs,
        activeStaticScenario: firstScen,
        staticJob: runs[firstScen].job,
        staticResult: null,
        compareResult: null,
      })
    }

    const readScenario = (scen: string) =>
      mode === 'projected' ? get().projectedScenarioRuns[scen] : get().staticScenarioRuns[scen]

    for (const scen of scenarios) {
      const run = runs[scen]
      if (!run.job.taskId) continue
      const sock = connectToImpactTask(run.job.taskId, async (msg: ImpactProgressMessage) => {
        const cur = readScenario(scen)
        if (!cur) return
        if (msg.type === 'progress') {
          updateScenario(mode, scen, {
            job: { ...cur.job, stage: msg.stage ?? cur.job.stage, pct: msg.pct ?? cur.job.pct },
          })
        } else if (msg.type === 'done') {
          updateScenario(mode, scen, {
            job: { ...cur.job, done: true, pct: 1, stage: 'done' },
          })
          try {
            const result = await getImpactResults(cur.job.taskId)
            // Parameter-scenario fan-out endpoint returns single-shape results
            // (one task per scenario, single LCI scenario per task).
            updateScenario(mode, scen, { result: result as ImpactAssessmentResult })
          } catch (e) {
            updateScenario(mode, scen, {
              job: { ...cur.job, done: true, error: e instanceof Error ? e.message : String(e) },
            })
          }
          try { scenarioSockets[scen]?.close() } catch { /* ignore */ }
          delete scenarioSockets[scen]
        } else if (msg.type === 'error') {
          updateScenario(mode, scen, {
            job: { ...cur.job, done: true, error: msg.error ?? 'unknown error' },
          })
          try { scenarioSockets[scen]?.close() } catch { /* ignore */ }
          delete scenarioSockets[scen]
        } else if (msg.type === 'cancelled') {
          updateScenario(mode, scen, {
            job: { ...cur.job, done: true, cancelled: true, stage: 'cancelled' },
          })
          try { scenarioSockets[scen]?.close() } catch { /* ignore */ }
          delete scenarioSockets[scen]
        }
      }, () => {
        const cur = readScenario(scen)
        if (cur && !cur.job.done) {
          updateScenario(mode, scen, { job: { ...cur.job, error: 'connection lost' } })
        }
      })
      scenarioSockets[scen] = sock
    }
  }

  const selectProjectedScenario: ImpactStore['selectProjectedScenario'] = (scenario) => {
    const run = get().projectedScenarioRuns[scenario]
    if (!run) return
    set({
      activeProjectedScenario: scenario,
      projectedJob: run.job,
      projectedResult: run.result,
    })
  }

  const selectStaticScenario: ImpactStore['selectStaticScenario'] = (scenario) => {
    const run = get().staticScenarioRuns[scenario]
    if (!run) return
    set({
      activeStaticScenario: scenario,
      staticJob: run.job,
      staticResult: run.result,
    })
  }

  const runDSMScenarios: ImpactStore['runDSMScenarios'] = async (
    body, scenarioIds, scenarioNames,
  ) => {
    if (!scenarioIds.length) return
    set({ error: null })
    closeScenarioSockets()

    const mode = body.mode

    let assignments: Record<string, string>
    try {
      // DSM-axis fan-out: pass ``dsm_scenario_ids`` (list) so the orchestrator
      // takes the DSM branch, not the parameter branch.
      const payload = {
        ...body,
        dsm_scenario_ids: scenarioIds,
        scenarios: null,
      } as ImpactAssessmentRequest
      const resp = await startImpactScenarios(payload)
      assignments = resp.scenarios
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      return
    }

    const runs: Record<string, ScenarioRun & { scenarioName: string }> = {}
    for (const sid of scenarioIds) {
      const taskId = assignments[sid] ?? ''
      runs[sid] = {
        scenario: sid,
        scenarioName: scenarioNames[sid] ?? sid,
        job: {
          taskId,
          mode,
          stage: taskId ? 'queued' : 'failed',
          pct: 0,
          done: !taskId,
          error: taskId ? null : `No task_id returned for DSM scenario '${sid}'`,
        },
        result: null,
      }
    }
    const firstId = scenarioIds[0]
    if (mode === 'projected') {
      set({
        projectedDsmScenarioOrder: scenarioIds,
        projectedDsmScenarioRuns: runs,
        activeProjectedDsmScenario: firstId,
        projectedJob: runs[firstId].job,
        projectedResult: null,
        projectedMultiResult: null,
        projectedScenarioOrder: [],
        projectedScenarioRuns: {},
        activeProjectedScenario: null,
        compareResult: null,
      })
    } else {
      set({
        staticDsmScenarioOrder: scenarioIds,
        staticDsmScenarioRuns: runs,
        activeStaticDsmScenario: firstId,
        staticJob: runs[firstId].job,
        staticResult: null,
        staticScenarioOrder: [],
        staticScenarioRuns: {},
        activeStaticScenario: null,
        compareResult: null,
      })
    }

    const readDsmRun = (sid: string) =>
      mode === 'projected'
        ? get().projectedDsmScenarioRuns[sid]
        : get().staticDsmScenarioRuns[sid]

    console.log('[multi-DSM]', mode, 'fan-out POST returned task_ids', assignments)
    for (const sid of scenarioIds) {
      const run = runs[sid]
      if (!run.job.taskId) {
        console.warn('[multi-DSM]', sid, 'no task_id assigned by backend')
        continue
      }
      const sock = connectToImpactTask(run.job.taskId, async (msg: ImpactProgressMessage) => {
        const cur = readDsmRun(sid)
        if (!cur) return
        if (msg.type === 'progress') {
          updateDsmScenario(mode, sid, {
            job: { ...cur.job, stage: msg.stage ?? cur.job.stage, pct: msg.pct ?? cur.job.pct },
          })
        } else if (msg.type === 'done') {
          console.log('[multi-DSM]', sid, 'WS done frame; fetching result for task', cur.job.taskId)
          updateDsmScenario(mode, sid, {
            job: { ...cur.job, done: true, pct: 1, stage: 'done' },
          })
          try {
            const result = await getImpactResults(cur.job.taskId)
            console.log('[multi-DSM]', sid, 'fetched result', result)
            // DSM-axis fan-out spawns single-shape per-task results.
            updateDsmScenario(mode, sid, { result: result as ImpactAssessmentResult })
          } catch (e) {
            console.error('[multi-DSM]', sid, 'getImpactResults threw', e)
            updateDsmScenario(mode, sid, {
              job: { ...cur.job, done: true, error: e instanceof Error ? e.message : String(e) },
            })
          }
          try { scenarioSockets[sid]?.close() } catch { /* ignore */ }
          delete scenarioSockets[sid]
        } else if (msg.type === 'error') {
          console.error('[multi-DSM]', sid, 'WS error frame', msg)
          updateDsmScenario(mode, sid, {
            job: { ...cur.job, done: true, error: msg.error ?? 'unknown error' },
          })
          try { scenarioSockets[sid]?.close() } catch { /* ignore */ }
          delete scenarioSockets[sid]
        } else if (msg.type === 'cancelled') {
          updateDsmScenario(mode, sid, {
            job: { ...cur.job, done: true, cancelled: true, stage: 'cancelled' },
          })
          try { scenarioSockets[sid]?.close() } catch { /* ignore */ }
          delete scenarioSockets[sid]
        }
      }, () => {
        const cur = readDsmRun(sid)
        if (cur && !cur.job.done) {
          updateDsmScenario(mode, sid, { job: { ...cur.job, error: 'connection lost' } })
        }
      })
      scenarioSockets[sid] = sock
    }
  }

  const selectStaticDsmScenario: ImpactStore['selectStaticDsmScenario'] = (scenarioId) => {
    const run = get().staticDsmScenarioRuns[scenarioId]
    if (!run) return
    // Clear compareResult so the Comparison useEffect re-fires compare()
    // against the freshly-bridged staticResult. Without this, tab switching
    // is cosmetic — Patch 2H.
    set({
      activeStaticDsmScenario: scenarioId,
      staticJob: run.job,
      staticResult: run.result,
      compareResult: null,
    })
  }

  const selectProjectedDsmScenario: ImpactStore['selectProjectedDsmScenario'] = (scenarioId) => {
    const run = get().projectedDsmScenarioRuns[scenarioId]
    if (!run) return
    set({
      activeProjectedDsmScenario: scenarioId,
      projectedJob: run.job,
      projectedResult: run.result,
      compareResult: null,
    })
  }

  const updatePairedScenario = (
    key: string, patch: Partial<ScenarioRun>,
  ) => {
    const cur = get().pairedScenarioRuns[key]
    if (!cur) return
    const merged = { ...cur, ...patch }
    const next = { ...get().pairedScenarioRuns, [key]: merged }
    set({ pairedScenarioRuns: next })
    if (get().activePairedScenario === key) {
      set({ projectedJob: merged.job, projectedResult: merged.result })
    }
  }

  const runPairedScenarios: ImpactStore['runPairedScenarios'] = async (
    body, pairs, dsmScenarioNames,
  ) => {
    if (!pairs.length) return
    set({ error: null })
    closeScenarioSockets()

    // Paired runs are projected-only by definition (each pair has a
    // prospective LCI ref); ignore body.mode and force 'projected'.
    const mode: 'projected' = 'projected'

    let assignments: Record<string, string>
    try {
      const payload = {
        ...body,
        mode,
        paired_scenarios: pairs,
        scenarios: null,
        dsm_scenario_ids: null,
        lci_scenarios: null,
      } as ImpactAssessmentRequest
      const resp = await startImpactScenarios(payload)
      assignments = resp.scenarios
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      return
    }

    const keys = pairs.map(pairKey)
    const runs: ImpactStore['pairedScenarioRuns'] = {}
    for (const [i, key] of keys.entries()) {
      const pair = pairs[i]
      const taskId = assignments[key] ?? ''
      runs[key] = {
        scenario: key,
        dsmScenarioId: pair.dsm_scenario_id,
        dsmScenarioName: dsmScenarioNames[pair.dsm_scenario_id] ?? pair.dsm_scenario_id,
        lciScenario: pair.lci_scenario,
        job: {
          taskId,
          mode,
          stage: taskId ? 'queued' : 'failed',
          pct: 0,
          done: !taskId,
          error: taskId ? null : `No task_id returned for pair '${key}'`,
        },
        result: null,
      }
    }
    const firstKey = keys[0]
    set({
      pairedScenarioOrder: keys,
      pairedScenarioRuns: runs,
      activePairedScenario: firstKey,
      projectedJob: runs[firstKey].job,
      projectedResult: null,
      projectedMultiResult: null,
      projectedScenarioOrder: [],
      projectedScenarioRuns: {},
      activeProjectedScenario: null,
      // Paired is mutually exclusive with multi-DSM on the projected side
      // (axisConflict). Static-side multi-DSM is independent — the
      // Comparison tab intersects paired DSM ids with static DSM ids.
      projectedDsmScenarioOrder: [],
      projectedDsmScenarioRuns: {},
      activeProjectedDsmScenario: null,
      compareResult: null,
    })

    console.log('[paired] fan-out POST returned task_ids', assignments)
    for (const key of keys) {
      const run = runs[key]
      if (!run.job.taskId) {
        console.warn('[paired]', key, 'no task_id assigned by backend')
        continue
      }
      const sock = connectToImpactTask(run.job.taskId, async (msg: ImpactProgressMessage) => {
        const cur = get().pairedScenarioRuns[key]
        if (!cur) return
        if (msg.type === 'progress') {
          updatePairedScenario(key, {
            job: { ...cur.job, stage: msg.stage ?? cur.job.stage, pct: msg.pct ?? cur.job.pct },
          })
        } else if (msg.type === 'done') {
          updatePairedScenario(key, {
            job: { ...cur.job, done: true, pct: 1, stage: 'done' },
          })
          try {
            const result = await getImpactResults(cur.job.taskId)
            updatePairedScenario(key, { result: result as ImpactAssessmentResult })
          } catch (e) {
            updatePairedScenario(key, {
              job: { ...cur.job, done: true, error: e instanceof Error ? e.message : String(e) },
            })
          }
          try { scenarioSockets[key]?.close() } catch { /* ignore */ }
          delete scenarioSockets[key]
        } else if (msg.type === 'error') {
          updatePairedScenario(key, {
            job: { ...cur.job, done: true, error: msg.error ?? 'unknown error' },
          })
          try { scenarioSockets[key]?.close() } catch { /* ignore */ }
          delete scenarioSockets[key]
        } else if (msg.type === 'cancelled') {
          updatePairedScenario(key, {
            job: { ...cur.job, done: true, cancelled: true, stage: 'cancelled' },
          })
          try { scenarioSockets[key]?.close() } catch { /* ignore */ }
          delete scenarioSockets[key]
        }
      }, () => {
        const cur = get().pairedScenarioRuns[key]
        if (cur && !cur.job.done) {
          updatePairedScenario(key, { job: { ...cur.job, error: 'connection lost' } })
        }
      })
      scenarioSockets[key] = sock
    }
  }

  const selectPairedScenario: ImpactStore['selectPairedScenario'] = (key) => {
    const run = get().pairedScenarioRuns[key]
    if (!run) return
    set({
      activePairedScenario: key,
      projectedJob: run.job,
      projectedResult: run.result,
      compareResult: null,
    })
  }

  return {
    staticJob: null,
    projectedJob: null,
    staticResult: null,
    projectedResult: null,
    compareResult: null,
    error: null,

    projectedScenarioOrder: [],
    projectedScenarioRuns: {},
    activeProjectedScenario: null,
    staticScenarioOrder: [],
    staticScenarioRuns: {},
    activeStaticScenario: null,
    staticDsmScenarioOrder: [],
    staticDsmScenarioRuns: {},
    activeStaticDsmScenario: null,
    projectedDsmScenarioOrder: [],
    projectedDsmScenarioRuns: {},
    activeProjectedDsmScenario: null,
    pairedScenarioOrder: [],
    pairedScenarioRuns: {},
    activePairedScenario: null,
    projectedMultiResult: null,

    run,
    runScenarios,
    runDSMScenarios,
    runPairedScenarios,
    selectProjectedScenario,
    selectStaticScenario,
    selectStaticDsmScenario,
    selectProjectedDsmScenario,
    selectPairedScenario,
    compare,
    clearCompare: () => set({ compareResult: null }),

    setStaticFromMFA: ({ mfaSystemId, results, scope, yearStart, yearEnd, baseDb }) => {
      if (!results.length) return
      const synthetic: ImpactAssessmentResult = {
        task_id: `dsm-mirror-${mfaSystemId}-${Date.now()}`,
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
      set({
        staticJob: null,
        staticResult: null,
        compareResult: null,
        staticScenarioOrder: [],
        staticScenarioRuns: {},
        activeStaticScenario: null,
        staticDsmScenarioOrder: [],
        staticDsmScenarioRuns: {},
        activeStaticDsmScenario: null,
      })
    },

    reset: () => {
      closeSocket('static')
      closeSocket('projected')
      closeScenarioSockets()
      set({
        staticJob: null,
        projectedJob: null,
        staticResult: null,
        projectedResult: null,
        compareResult: null,
        error: null,
        projectedScenarioOrder: [],
        projectedScenarioRuns: {},
        activeProjectedScenario: null,
        staticScenarioOrder: [],
        staticScenarioRuns: {},
        activeStaticScenario: null,
        staticDsmScenarioOrder: [],
        staticDsmScenarioRuns: {},
        activeStaticDsmScenario: null,
        projectedDsmScenarioOrder: [],
        projectedDsmScenarioRuns: {},
        activeProjectedDsmScenario: null,
        pairedScenarioOrder: [],
        pairedScenarioRuns: {},
        activePairedScenario: null,
        projectedMultiResult: null,
      })
    },
  }
})

/** Compute static vs projected comparison from the two results held in the
 * store. Mirrors the backend /impact/compare logic so synthetic static
 * results (DSM mirror) can be compared without a backend round-trip. */
function buildCompareClientSide(
  s: ImpactAssessmentResult,
  p: ImpactAssessmentResult,
): ImpactCompareResult {
  if (s.meta.mfa_system_id !== p.meta.mfa_system_id) {
    throw new Error('Comparison requires both runs on the same DSM system.')
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
