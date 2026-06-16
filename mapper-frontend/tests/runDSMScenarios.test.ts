import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useImpactStore } from '../src/stores/impactStore'
import type { ImpactAssessmentRequest } from '../src/api/client'

// Regression: multi-DSM Calculate must POST exactly once to
// /impact/calculate-scenarios with `dsm_scenario_ids: [...]` — never iterate
// scenarios into N individual POSTs. The backend's /calculate-scenarios route
// is the fan-out boundary; the frontend hands it the list and consumes one
// task_id per scenario from the response.

const realFetch = globalThis.fetch
const realWebSocket = globalThis.WebSocket

beforeEach(() => {
  // Stub WebSocket so connectToImpactTask() in the post-POST loop doesn't
  // try to open real sockets in jsdom.
  // @ts-expect-error — minimal stub
  globalThis.WebSocket = class {
    onmessage: ((e: MessageEvent) => void) | null = null
    onerror: ((e: Event) => void) | null = null
    close() {}
    constructor(_url: string) {}
  }
  // Reset store between cases so per-side DSM slots don't leak.
  useImpactStore.setState({
    staticDsmScenarioOrder: [],
    staticDsmScenarioRuns: {},
    activeStaticDsmScenario: null,
    projectedDsmScenarioOrder: [],
    projectedDsmScenarioRuns: {},
    activeProjectedDsmScenario: null,
    error: null,
  })
})

afterEach(() => {
  globalThis.fetch = realFetch
  globalThis.WebSocket = realWebSocket
})

function makeBody(): ImpactAssessmentRequest {
  return {
    mode: 'static',
    mfa_system_id: 'sys-test',
    scope: 'all',
    methods: [['ef v3.1', 'climate change', 'gwp 100a']],
    year_start: null,
    year_end: null,
    scenario: null,
    parameter_set_id: null,
  } as unknown as ImpactAssessmentRequest
}

describe('runDSMScenarios — single fan-out POST', () => {
  it('fires exactly one POST to /impact/calculate-scenarios with dsm_scenario_ids', async () => {
    const calls: { url: string; body: unknown }[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const body = init?.body ? JSON.parse(init.body as string) : null
      calls.push({ url, body })
      return new Response(
        JSON.stringify({ scenarios: { s1: 't-1', s2: 't-2', s3: 't-3' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })
    globalThis.fetch = fetchMock as typeof fetch

    const ids = ['s1', 's2', 's3']
    const names = { s1: 'SSP1', s2: 'SSP2', s3: 'SSP5' }
    await useImpactStore.getState().runDSMScenarios(makeBody(), ids, names)

    const fanOutCalls = calls.filter((c) => c.url.endsWith('/impact/calculate-scenarios'))
    expect(fanOutCalls).toHaveLength(1)
    const payload = fanOutCalls[0].body as { dsm_scenario_ids: string[] }
    expect(payload.dsm_scenario_ids).toEqual(ids)
  })

  it('populates staticDsmScenarioOrder/Runs from the single response', async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ scenarios: { s1: 't-1', s2: 't-2', s3: 't-3' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch

    const ids = ['s1', 's2', 's3']
    const names = { s1: 'SSP1', s2: 'SSP2', s3: 'SSP5' }
    await useImpactStore.getState().runDSMScenarios(makeBody(), ids, names)

    const st = useImpactStore.getState()
    expect(st.staticDsmScenarioOrder).toEqual(ids)
    expect(st.activeStaticDsmScenario).toBe('s1')
    expect(st.staticDsmScenarioRuns.s1.scenarioName).toBe('SSP1')
    expect(st.staticDsmScenarioRuns.s2.scenarioName).toBe('SSP2')
    expect(st.staticDsmScenarioRuns.s3.scenarioName).toBe('SSP5')
    expect(st.staticDsmScenarioRuns.s1.job.taskId).toBe('t-1')
    expect(st.staticDsmScenarioRuns.s3.job.taskId).toBe('t-3')
  })
})
