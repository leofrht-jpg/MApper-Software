import { create } from 'zustand'
import type { ComputeMetrics, GridCountry } from '../api/client'

export interface ComputationRecord {
  id: number
  timestamp: string
  module: string
  description: string
  wall_time_seconds: number
  cpu_time_seconds: number
  energy_wh: number
  co2_g: number
  country_code: string
  grid_intensity_g_per_kwh: number
  tdp_watts: number
}

const LS_LIFETIME = 'mapper-lifetime-co2'
const LS_COUNTRY = 'mapper-country'
const LS_TDP = 'mapper-tdp-override'

const DEFAULT_COUNTRY = 'WORLD'
const DEFAULT_INTENSITY = 440

function loadNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    const n = Number(raw)
    return Number.isFinite(n) ? n : fallback
  } catch {
    return fallback
  }
}

function loadString(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function saveNumber(key: string, n: number) {
  try {
    localStorage.setItem(key, String(n))
  } catch {
    /* ignore */
  }
}

function saveString(key: string, s: string) {
  try {
    localStorage.setItem(key, s)
  } catch {
    /* ignore */
  }
}

interface CarbonStore {
  session_records: ComputationRecord[]
  session_total_co2_g: number
  session_total_energy_wh: number
  lifetime_total_co2_g: number
  last_pulse_id: number

  country_code: string
  country_name: string
  grid_intensity_g_per_kwh: number
  grid_year: number
  grid_source: string
  tdp_override: number | null // when null, use auto-detected default

  countries: GridCountry[]

  setCountries: (countries: GridCountry[], eu?: GridCountry, world?: GridCountry) => void
  setCountry: (code: string) => void
  setTdpOverride: (watts: number | null) => void
  recordComputation: (args: {
    module: string
    description: string
    metrics: ComputeMetrics
  }) => void
  resetSession: () => void
  resetLifetime: () => void
}

let _nextId = 1
const MAX_RECORDS = 20

function findCountry(countries: GridCountry[], code: string): GridCountry | undefined {
  return countries.find((c) => c.code === code)
}

export const useCarbonStore = create<CarbonStore>((set, get) => ({
  session_records: [],
  session_total_co2_g: 0,
  session_total_energy_wh: 0,
  lifetime_total_co2_g: loadNumber(LS_LIFETIME, 0),
  last_pulse_id: 0,

  country_code: loadString(LS_COUNTRY, DEFAULT_COUNTRY),
  country_name: 'World average',
  grid_intensity_g_per_kwh: DEFAULT_INTENSITY,
  grid_year: 2024,
  grid_source: 'IEA',
  tdp_override: (() => {
    const raw = (() => {
      try {
        return localStorage.getItem(LS_TDP)
      } catch {
        return null
      }
    })()
    if (raw == null || raw === '') return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  })(),

  countries: [],

  setCountries: (countries, eu, world) => {
    const all = [...countries]
    if (eu) all.push(eu)
    if (world) all.push(world)
    const currentCode = get().country_code
    const match = findCountry(all, currentCode) || findCountry(all, DEFAULT_COUNTRY)
    set({
      countries: all,
      country_code: match?.code ?? currentCode,
      country_name: match?.name ?? get().country_name,
      grid_intensity_g_per_kwh: match?.intensity ?? get().grid_intensity_g_per_kwh,
      grid_year: match?.year ?? get().grid_year,
      grid_source: match?.source ?? get().grid_source,
    })
  },

  setCountry: (code) => {
    const match = findCountry(get().countries, code)
    if (!match) return
    saveString(LS_COUNTRY, code)
    set({
      country_code: match.code,
      country_name: match.name,
      grid_intensity_g_per_kwh: match.intensity,
      grid_year: match.year,
      grid_source: match.source,
    })
  },

  setTdpOverride: (watts) => {
    if (watts == null) {
      saveString(LS_TDP, '')
    } else {
      saveNumber(LS_TDP, watts)
    }
    set({ tdp_override: watts })
  },

  recordComputation: ({ module, description, metrics }) => {
    const state = get()
    const tdp = state.tdp_override ?? metrics.tdp_watts
    const intensity = state.grid_intensity_g_per_kwh
    // Prefer CPU time if meaningful, otherwise wall — matches backend logic.
    const active = metrics.cpu_time_seconds > 0.01 ? metrics.cpu_time_seconds : metrics.wall_time_seconds
    const energy_wh = tdp * (active / 3600)
    const co2_g = energy_wh * (intensity / 1000)

    const record: ComputationRecord = {
      id: _nextId++,
      timestamp: new Date().toISOString(),
      module,
      description,
      wall_time_seconds: metrics.wall_time_seconds,
      cpu_time_seconds: metrics.cpu_time_seconds,
      energy_wh,
      co2_g,
      country_code: state.country_code,
      grid_intensity_g_per_kwh: intensity,
      tdp_watts: tdp,
    }

    const next_records = [record, ...state.session_records].slice(0, MAX_RECORDS)
    const session_total_co2_g = state.session_total_co2_g + co2_g
    const session_total_energy_wh = state.session_total_energy_wh + energy_wh
    const lifetime_total_co2_g = state.lifetime_total_co2_g + co2_g
    saveNumber(LS_LIFETIME, lifetime_total_co2_g)

    set({
      session_records: next_records,
      session_total_co2_g,
      session_total_energy_wh,
      lifetime_total_co2_g,
      last_pulse_id: record.id,
    })
  },

  resetSession: () =>
    set({
      session_records: [],
      session_total_co2_g: 0,
      session_total_energy_wh: 0,
    }),

  resetLifetime: () => {
    saveNumber(LS_LIFETIME, 0)
    set({ lifetime_total_co2_g: 0 })
  },
}))

// Helper usable outside React.
export function recordComputation(args: {
  module: string
  description: string
  metrics: ComputeMetrics | null | undefined
}) {
  if (!args.metrics) return
  useCarbonStore.getState().recordComputation({
    module: args.module,
    description: args.description,
    metrics: args.metrics,
  })
}

export function formatCo2(grams: number): string {
  if (grams < 1) return `${grams.toFixed(3)} g`
  if (grams < 1000) return `${grams.toFixed(3)} g`
  return `${(grams / 1000).toFixed(3)} kg`
}

export function formatEnergy(wh: number): string {
  if (wh < 1) return `${(wh * 1000).toFixed(1)} mWh`
  if (wh < 1000) return `${wh.toFixed(2)} Wh`
  return `${(wh / 1000).toFixed(2)} kWh`
}

/**
 * Everyday equivalence for a CO2 value in grams.
 * Thresholds follow the user spec:
 *   < 1 g           → breath
 *   1–10 g          → cm of petrol car (120 g/km → 1 cm = 0.0012 g, so 1 g = ~8 m)
 *                     Actually 120 g/km = 0.12 g/m. So 1 g = ~8 meters. Use meters.
 *   10–100 g        → meters of car
 *   100–1000 g      → phone charges (~8 g per full charge)
 *   > 1 kg          → km of car (120 g/km)
 */
export function equivalenceText(co2_g: number): string {
  if (co2_g < 1) return 'less than one exhaled breath'
  const car_g_per_km = 120
  const car_g_per_m = car_g_per_km / 1000 // 0.12
  const phone_charge_g = 8.22 // ~8 g per full smartphone charge
  if (co2_g < 10) {
    const meters = co2_g / car_g_per_m
    return `~${meters.toFixed(0)} m of petrol car driving`
  }
  if (co2_g < 100) {
    const meters = co2_g / car_g_per_m
    return `~${meters.toFixed(0)} m of petrol car driving`
  }
  if (co2_g < 1000) {
    const charges = co2_g / phone_charge_g
    return `~${charges.toFixed(0)} smartphone charges`
  }
  const km = co2_g / car_g_per_km
  return `~${km.toFixed(1)} km of petrol car driving`
}
