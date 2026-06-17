import { recordComputation } from '../stores/carbonStore'

const API_BASE = 'http://localhost:8000/api'
const WS_BASE = 'ws://localhost:8000/api'

// ── Phase 0 ──────────────────────────────────────────────────────────────────

export interface HealthResponse {
  status: string
  brightway2_version: string
  current_project: string
}

export interface ProjectResponse {
  name: string
  is_current: boolean
}

export interface DatabaseResponse {
  name: string
  records: number
  modified: string | null
  is_prospective?: boolean
  prospective_meta?: {
    base_db?: string
    iam?: string
    ssp?: string
    year?: number | null
    years?: number[]
    mode?: 'separate' | 'superstructure'
    sdf_path?: string | null
    created_at?: string
  } | null
}

// ── Phase 1A: Activities ──────────────────────────────────────────────────────

export interface ActivitySummary {
  key: string
  code: string
  name: string
  location: string
  unit: string
  product: string
  database: string
}

export interface ActivityPage {
  items: ActivitySummary[]
  total: number
  offset: number
  limit: number
}

export interface ActivityDistinctValues {
  locations: string[]
  units: string[]
}

export type ActivitySortBy = 'name_asc' | 'name_desc' | 'location_asc' | 'unit_asc' | 'relevance'

export interface ActivityExportDetail {
  database: string
  code: string
  name: string
  reference_product: string
  location: string
  unit: string
  classifications: string
  comment: string
  production_amount: number
  technosphere_count: number
  biosphere_count: number
  activity_type: string
}

export interface ExchangeDetail {
  input_key: string
  input_name: string
  input_location: string
  input_unit: string
  input_database: string
  amount: number
  type: string
}

export interface ActivityDetail {
  key: string
  code: string
  name: string
  location: string
  unit: string
  product: string
  database: string
  exchanges: ExchangeDetail[]
  metadata: Record<string, string>
}

export interface MethodIndicator {
  indicator: string
  tuple: string[]
}

export interface MethodCategory {
  category: string
  indicators: MethodIndicator[]
}

export interface MethodFamily {
  family: string
  categories: MethodCategory[]
}

// ── Phase 1B: Ecoinvent ───────────────────────────────────────────────────────

export interface ValidateCredentialsResponse {
  valid: boolean
  versions: string[]
  message: string
}

export interface TaskStartedResponse {
  task_id: string
  status: string
}

export interface TaskProgressMessage {
  step: string
  progress: number
  message: string
}

// ── Phase 1C: LCA ─────────────────────────────────────────────────────────────

export interface LCAResult {
  task_id: string
  method: string[]
  functional_unit_name: string
  functional_unit_amount: number
  score: number
  unit: string
  calculated_at: string
}

export interface ContributionItem {
  activity_name: string
  activity_key: string
  location: string
  amount: number
  unit: string
  percentage: number
}

export interface ContributionsResponse {
  items: ContributionItem[]
  rest_amount: number
  rest_percentage: number
}

export interface SankeyNode {
  id: string
  name: string
  location: string
}

export interface SankeyLink {
  source: string
  target: string
  value: number
}

export interface SankeyData {
  nodes: SankeyNode[]
  links: SankeyLink[]
  /** Total nodes the cycle-safe BFS discovered (pre-truncation). */
  total_nodes_discovered?: number
  /** True when ``total_nodes_discovered > max_nodes`` and the response was
   *  pruned (best-first by edge value from the root). */
  truncated?: boolean
}

// ── Phase 2A: DSM ─────────────────────────────────────────────────────────────

export interface TimeHorizon {
  start_year: number
  end_year: number
}

export interface DimensionDef {
  name: string
  display_name: string
  labels: string[]
  is_age?: boolean
}

export interface SystemDefinition {
  id?: string | null
  name: string
  description?: string | null
  time_horizon: TimeHorizon
  dimensions: DimensionDef[]
  created_at?: string | null
  unit_name?: string
}

export interface SystemSummary {
  id: string
  name: string
  description: string | null
  time_horizon: TimeHorizon
  dimension_count: number
  cohort_count: number
  created_at: string
}

export interface CustomSurvivalPoint {
  age: number
  survival_rate: number
}

export interface SurvivalConfig {
  dimension_filters: Record<string, string>
  method: 'weibull' | 'custom'
  weibull_shape?: number | null
  weibull_scale?: number | null
  custom_curve?: CustomSurvivalPoint[] | null
}

export interface InflowData {
  year: number
  counts: Record<string, number>
}

export type DSMMode = 'manual' | 'survival_inflow' | 'survival_stock'

export interface ModeConfig {
  dimension_filters: Record<string, string>
  mode: DSMMode
}

export interface StockTargetData {
  year: number
  counts: Record<string, number>
}

export interface OutflowData {
  year: number
  counts: Record<string, number>
  cohort_age_counts: Record<string, number>
}

export type ScalingTarget = 'inflows' | 'stock_targets' | 'outflows'

export interface DSMScalingRule {
  id: string
  dimension_filters: Record<string, string>
  applies_to: ScalingTarget
  expression: string
  description?: string | null
}

export interface DSMScalingRuleList {
  rules: DSMScalingRule[]
}

export interface DSMScenario {
  id: string
  name: string
  description?: string | null
  is_base: boolean
  initial_stock?: Record<string, number> | null
  inflows?: InflowData[] | null
  stock_targets?: StockTargetData[] | null
  outflows?: OutflowData[] | null
  mode_configs?: ModeConfig[] | null
  scaling_rules?: DSMScalingRule[] | null
  created_at?: string | null
  updated_at?: string | null
}

export interface DSMSystemState {
  system_id: string
  survival_configs: SurvivalConfig[]
  integer_units: boolean
  scenarios: DSMScenario[]
  active_scenario_id: string | null
}

export interface ScenarioList {
  scenarios: DSMScenario[]
  active_scenario_id: string | null
}

export interface ScenarioCreateBody {
  id?: string
  name: string
  description?: string | null
  copy_from?: string | null
}

export interface ScenarioUpdateBody {
  name?: string | null
  description?: string | null
  clear_slots?: string[]
}

export interface YearResult {
  year: number
  stock: Record<string, number>
  stock_by_age: Record<string, Record<string, number>>
  inflow: Record<string, number>
  outflow: Record<string, number>
  outflow_by_age: Record<string, Record<string, number>>
  natural_outflow: Record<string, number>
  forced_retirement: Record<string, number>
  forced_retirement_by_age: Record<string, Record<string, number>>
  manual_outflow: Record<string, number>
}

export interface SimulationSummary {
  total_stock_start: number
  total_stock_end: number
  total_inflows: number
  total_outflows: number
  warnings: string[]
}

export interface SimulationResult {
  system_id: string
  years: YearResult[]
  summary: SimulationSummary
  compute_metrics?: ComputeMetrics | null
}

export interface MultiScenarioSimulationResult {
  system_id: string
  scenarios: Record<string, SimulationResult>
  warnings: string[]
}

export interface StockUploadResult {
  rows_parsed: number
  cohorts_found: number
  total_items: number
}

export interface InflowUploadResult {
  years_parsed: number
  rows_parsed: number
  total_inflows: number
}

export interface StockTargetUploadResult {
  years_parsed: number
  rows_parsed: number
  total_targets: number
}

export interface OutflowUploadResult {
  years_parsed: number
  rows_parsed: number
  total_outflows: number
  cohort_specific: boolean
}

export interface SurvivalPreviewPoint {
  age: number
  survival_rate: number
  hazard_rate: number
}

// ── Phase 2B: BOM / Archetype / DSM × LCA ────────────────────────────────────

export interface EcoinventLink {
  database: string
  code: string
  name: string
  location?: string
  unit?: string
  reference_product?: string
}

export interface QuantityMilestone {
  year: number
  quantity: number
}

export interface MaterialEvolution {
  method: 'fixed' | 'learning_rate' | 'rebound_effect' | 'milestones'
  learning_rate?: number | null
  rebound_rate?: number | null
  milestones?: QuantityMilestone[] | null
  base_year: number
  applies_to_stages?: string[] | null
}

export interface BOMNode {
  id?: string | null
  name: string
  node_type: 'component' | 'material'
  quantity: number
  quantity_expression?: string | null
  unit: string
  scope?: 'inflows' | 'stock' | 'outflows' | null
  is_annual?: boolean
  children?: BOMNode[] | null
  ecoinvent_activity?: EcoinventLink | null
  evolution?: MaterialEvolution | null
  validation_status?: 'ok' | 'warning' | 'error'
  validation_message?: string | null
}

export interface ArchetypeTimelineRow {
  node_id: string
  name: string
  unit: string
  path: string[]
  quantities: Record<number, number>
  has_evolution: boolean
}

export interface ArchetypeTimeline {
  archetype_id: string
  years: number[]
  rows: ArchetypeTimelineRow[]
  total_mass_by_year: Record<number, number>
}

export interface TimelineCompareRow {
  node_id: string
  name: string
  path: string[]
  unit: string
  year_start: number
  year_end: number
  quantity_start: number
  quantity_end: number
  delta: number
  delta_pct: number | null
  has_evolution: boolean
}

export interface TimelineCompareResult {
  archetype_id: string
  year_start: number
  year_end: number
  rows: TimelineCompareRow[]
  total_mass_start: number
  total_mass_end: number
}

export interface Archetype {
  id?: string | null
  name: string
  description?: string | null
  category?: string | null
  folder?: string | null
  bom: BOMNode[]
  created_at?: string | null
  updated_at?: string | null
  validation_report?: ValidationReport | null
}

export interface ArchetypeSummary {
  id: string
  name: string
  description: string | null
  category: string | null
  folder: string | null
  material_count: number
  unlinked_count: number
  stages: string[]
  stage_annual: Record<string, boolean>
  created_at: string
  updated_at: string
  validation_error_rows?: number
  validation_warning_rows?: number
}

export interface FlattenedMaterial {
  node_id: string
  name: string
  quantity: number
  unit: string
  ecoinvent_activity?: EcoinventLink | null
  path: string[]
}

export interface FlattenedBOM {
  archetype_id: string
  materials: FlattenedMaterial[]
  total_mass_kg: number
  unlinked_count: number
}

export interface ArchetypeLCAResult {
  archetype_id: string
  method: string[]
  score: number
  unit: string
  amount: number
  impact_by_material: Record<string, number>
}

export interface CohortMappingEntry {
  cohort_key: string
  archetype_id: string
  scaling_factor: number
}

export interface CohortMapping {
  mfa_system_id: string
  mappings: CohortMappingEntry[]
  // Patch 4AK — per-row color overrides keyed by cohort_key.
  row_colors?: Record<string, string>
}

export interface CohortMappingResult {
  mapped_cohorts: number
  unmapped_cohorts: string[]
  invalid_cohorts: string[]
  invalid_archetypes: string[]
  // Patch 4AK — surfaced separately from invalid_cohorts/archetypes so
  // the upload UI can distinguish "the row didn't import" from "the row
  // imported but its color was rejected."
  invalid_row_colors?: string[]
}

export interface DSMLCAYearResult {
  year: number
  total_impact: number
  impact_by_cohort: Record<string, number>
  impact_by_material: Record<string, number>
  count_by_cohort?: Record<string, number>
  unit: string
}

export interface DSMLCASummary {
  total_impact: number
  peak_year: number
  peak_impact: number
}

export interface DSMLCAResult {
  mfa_system_id: string
  method: string[]
  method_label?: string
  scope: 'inflows' | 'outflows' | 'stock' | 'all'
  unit: string
  years: DSMLCAYearResult[]
  summary: DSMLCASummary
  stages_included?: string[]
}

export interface DSMLCABatchResult {
  results: DSMLCAResult[]
  methods_calculated: number
  year_start?: number | null
  year_end?: number | null
  warnings?: string[]
  compute_metrics?: ComputeMetrics | null
}

// ── Subsystems (coupled product populations) ─────────────────────────────────

export interface DependencyRule {
  id: string
  dependent_archetype_id: string
  driver_filter: Record<string, string[]>
  expression: string
  description?: string | null
}

export interface SubsystemCohortMapping {
  archetype_id: string
  scaling_factor: number
}

export interface Subsystem {
  id: string
  name: string
  type: 'primary' | 'dependent'
  dimensions: DimensionDef[]
  depends_on?: string | null
  dependency_rules: DependencyRule[]
  initial_stock?: Record<string, number>
  cohort_mappings?: Record<string, SubsystemCohortMapping>
  unit_name?: string
  integer_units?: boolean
}

export interface SubsystemInitialStockUploadResult {
  archetypes_found: number
  total_items: number
  rows_parsed: number
}

export interface SubsystemSummary {
  id: string
  name: string
  type: 'primary' | 'dependent'
  dimension_count: number
  archetype_count: number
  rule_count: number
  depends_on?: string | null
}

export interface SubsystemList {
  subsystems: Subsystem[]
}

export interface RuleValidationResult {
  ok: boolean
  errors: string[]
}

export interface SubsystemComputeAllResponse {
  subsystem_results: Record<string, SimulationResult>
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

export class HttpError extends Error {
  status: number
  detail: string
  constructor(status: number, detail: string) {
    super(detail || `HTTP ${status}`)
    this.name = 'HttpError'
    this.status = status
    this.detail = detail
  }
}

function _extractDetail(body: string): string {
  // FastAPI returns JSON like {"detail": "..."}; pull out the message so
  // callers don't surface a raw JSON blob to the UI.
  const trimmed = (body || '').trim()
  if (!trimmed.startsWith('{')) return trimmed
  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed?.detail === 'string') return parsed.detail
    if (Array.isArray(parsed?.detail)) {
      return parsed.detail.map((d: { msg?: string }) => d?.msg ?? '').filter(Boolean).join('; ')
    }
  } catch {
    // fall through
  }
  return trimmed
}

// Patch X1+++ — project-state-desync guard. Every request includes
// the client's expected project as ``X-Mapper-Project`` so the
// backend can 409 on mismatch (avoids silent misrouting of writes
// when bw2data.projects.current and the frontend's currentProject
// drift). When ``currentProject`` is null (cold app boot, before
// fetchProjects()), the header is omitted and the backend skips
// validation. The 409 handler below auto-triggers a project re-sync.
let _expectedProjectProvider: () => string | null = () => null
let _onProjectMismatch: ((detail: string) => void) | null = null

export function configureProjectGuard(
  expectedProjectProvider: () => string | null,
  onMismatch: (detail: string) => void,
): void {
  _expectedProjectProvider = expectedProjectProvider
  _onProjectMismatch = onMismatch
}

function _withProjectHeader(options?: RequestInit): RequestInit {
  const expected = _expectedProjectProvider()
  if (!expected) return options ?? {}
  const headers = new Headers(options?.headers || {})
  headers.set('X-Mapper-Project', expected)
  return { ...(options ?? {}), headers }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, _withProjectHeader(options))
  if (!res.ok) {
    const body = await res.text()
    if (res.status === 409 && body.includes('project_state_mismatch')) {
      // Surface the mismatch; consumer (projectStore) will re-sync.
      if (_onProjectMismatch) _onProjectMismatch(_extractDetail(body))
    }
    throw new HttpError(res.status, _extractDetail(body))
  }
  return res.json()
}

// Patch 5AM — a network-level error is the browser's `fetch` rejection
// (`TypeError: Failed to fetch` in Chromium, "NetworkError…" in Firefox,
// "Load failed" in Safari) — typically the backend connection wasn't ready yet
// (cleared by a refresh). An `HttpError` (4xx/5xx) is a REAL server response and
// is never transient.
export function isTransientNetworkError(err: unknown): boolean {
  if (err instanceof HttpError) return false
  if (err instanceof TypeError) return true
  const msg = err instanceof Error ? err.message : String(err)
  return /failed to fetch|networkerror|network error|load failed/i.test(msg)
}

// Retry a fetch-bearing call ONLY on a transient network error, with a small
// bounded backoff. Genuine HTTP errors rethrow immediately so the caller can
// surface them (e.g. the AESA config-load banner). Opt-in per caller — the
// global `request()` is intentionally NOT wrapped, so this doesn't change other
// tabs' behaviour or mask real endpoint failures.
export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  { attempts = 3, baseDelayMs = 200 }: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      if (!isTransientNetworkError(e) || i === attempts - 1) throw e
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * (i + 1)))
    }
  }
  throw lastErr
}

// ── Universal task cancellation ─────────────────────────────────────────────
// Cancels any registered long-running task. Backend returns 200 on success
// with ``{cancelled: true, task_id}``; 404 if the task is unknown (already
// finished, never existed, or was cleaned up). The frontend treats 404 as
// "the task already finished, refresh state" — it's not an error to surface.

export interface CancelTaskResponse {
  cancelled: true
  task_id: string
}

export async function cancelTask(taskId: string): Promise<CancelTaskResponse | null> {
  const res = await fetch(
    `${API_BASE}/tasks/${encodeURIComponent(taskId)}/cancel`,
    { method: 'POST' },
  )
  if (res.status === 404) return null
  if (!res.ok) throw new HttpError(res.status, await res.text())
  return res.json()
}

async function uploadFile<T>(path: string, file: File): Promise<T> {
  const form = new FormData()
  form.append('file', file)
  // Patch X1+++ — propagate the project guard header on file uploads
  // too (FormData bodies bypass the request() wrapper).
  const res = await fetch(`${API_BASE}${path}`, _withProjectHeader({ method: 'POST', body: form }))
  if (!res.ok) {
    const detail = await res.text()
    if (res.status === 409 && detail.includes('project_state_mismatch')) {
      if (_onProjectMismatch) _onProjectMismatch(_extractDetail(detail))
    }
    throw new Error(detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function downloadCSV(path: string, filename: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST' })
  if (!res.ok) throw new Error(await res.text())
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Phase 0 functions ─────────────────────────────────────────────────────────

export async function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/health')
}

export async function getProjects(): Promise<ProjectResponse[]> {
  return request<ProjectResponse[]>('/projects')
}

export async function switchProject(name: string): Promise<ProjectResponse> {
  return request<ProjectResponse>('/projects/switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export async function createProject(name: string): Promise<ProjectResponse> {
  return request<ProjectResponse>('/projects/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export async function duplicateProject(sourceName: string, newName: string): Promise<ProjectResponse> {
  return request<ProjectResponse>('/projects/duplicate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_name: sourceName, new_name: newName }),
  })
}

export async function deleteProject(name: string): Promise<{ deleted: boolean; current_project: string }> {
  return request<{ deleted: boolean; current_project: string }>(
    `/projects/${encodeURIComponent(name)}`,
    { method: 'DELETE' },
  )
}

export async function exportProject(name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error(await res.text())
  const blob = await res.blob()
  const safe = name.replace(/[^A-Za-z0-9._-]+/g, '_') || 'project'
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safe}.mapperproj.tar.gz`
  a.click()
  URL.revokeObjectURL(url)
}

export async function importProject(file: File): Promise<ProjectResponse> {
  return uploadFile<ProjectResponse>('/projects/import', file)
}

export async function getDatabases(): Promise<DatabaseResponse[]> {
  return request<DatabaseResponse[]>('/databases')
}

// ── Phase 1A functions ────────────────────────────────────────────────────────

export async function getActivities(
  database: string,
  offset = 0,
  limit = 50,
  search?: string,
  opts?: { locations?: string[]; units?: string[]; sortBy?: ActivitySortBy },
): Promise<ActivityPage> {
  const params = new URLSearchParams({ offset: String(offset), limit: String(limit) })
  if (search) params.set('search', search)
  if (opts?.sortBy) params.set('sort_by', opts.sortBy)
  for (const l of opts?.locations ?? []) params.append('locations', l)
  for (const u of opts?.units ?? []) params.append('units', u)
  return request<ActivityPage>(`/activities/${encodeURIComponent(database)}?${params}`)
}

export async function searchAllActivities(
  search: string,
  limit = 50,
  technosphereOnly = false,
): Promise<ActivitySummary[]> {
  const params = new URLSearchParams({ search, limit: String(limit) })
  if (technosphereOnly) params.set('technosphere_only', 'true')
  return request<ActivitySummary[]>(`/activities/search-all?${params}`)
}

export async function getActivityDetail(database: string, code: string): Promise<ActivityDetail> {
  return request<ActivityDetail>(
    `/activities/detail/${encodeURIComponent(database)}/${encodeURIComponent(code)}`,
  )
}

export async function getActivityDistinctValues(database: string): Promise<ActivityDistinctValues> {
  return request<ActivityDistinctValues>(
    `/activities/${encodeURIComponent(database)}/distinct-values`,
  )
}

export async function getActivityExportDetails(
  database: string,
  codes: string[],
): Promise<ActivityExportDetail[]> {
  const res = await fetch(
    `${API_BASE}/activities/${encodeURIComponent(database)}/export-details`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes }),
    },
  )
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function exportActivitySelection(
  database: string,
  codes: string[],
  format: 'csv' | 'xlsx',
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/activities/${encodeURIComponent(database)}/export-selection`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes, format }),
    },
  )
  if (!res.ok) throw new Error(await res.text())
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const date = new Date().toISOString().slice(0, 10)
  const safeDb = database.replace(/[^A-Za-z0-9._-]+/g, '_')
  a.download = `activities_${safeDb}_${date}.${format}`
  a.click()
  URL.revokeObjectURL(url)
}

export async function getMethods(): Promise<MethodFamily[]> {
  return request<MethodFamily[]>('/methods')
}

// ── Phase 1B functions ────────────────────────────────────────────────────────

export async function validateEcoinventCredentials(
  username: string,
  password: string,
): Promise<ValidateCredentialsResponse> {
  return request<ValidateCredentialsResponse>('/ecoinvent/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
}

export async function startEcoinventImport(
  username: string,
  password: string,
  version: string,
  system_model: string,
): Promise<TaskStartedResponse> {
  return request<TaskStartedResponse>('/ecoinvent/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, version, system_model }),
  })
}

export interface BrowseFolderResponse {
  valid: boolean
  spold_count: number
  path: string
  message: string
}

export async function browseEcoinventFolder(path: string): Promise<BrowseFolderResponse> {
  return request<BrowseFolderResponse>('/ecoinvent/browse-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
}

export async function startEcoinventLocalImport(
  db_name: string,
  dirpath: string,
): Promise<TaskStartedResponse> {
  return request<TaskStartedResponse>('/ecoinvent/import-local', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ db_name, dirpath }),
  })
}

// ── Phase 1C functions ────────────────────────────────────────────────────────

export async function startLCACalculation(
  functionalUnitKey: string,
  amount: number,
  method: string[],
): Promise<TaskStartedResponse> {
  return request<TaskStartedResponse>('/lca/calculate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ functional_unit: { key: functionalUnitKey, amount }, method }),
  })
}

export async function getLCAResult(taskId: string): Promise<LCAResult> {
  return request<LCAResult>(`/lca/results/${taskId}`)
}

export async function getLCAContributions(taskId: string, limit = 10): Promise<ContributionsResponse> {
  return request<ContributionsResponse>(`/lca/results/${taskId}/contributions?limit=${limit}`)
}

export async function getLCASupplyChain(taskId: string): Promise<SankeyData> {
  return request<SankeyData>(`/lca/results/${taskId}/supply-chain`)
}

// ── Multi-Activity LCA Calculator ─────────────────────────────────────────────

export interface ActivityDemandItem {
  database: string
  code: string
  amount: number
}

export interface ActivityContribution {
  name: string
  location: string
  database: string
  code: string
  demand_amount: number
  demand_unit: string
  impact: number
  percentage: number
}

export interface ActivityLCAMethodResult {
  method: string[]
  method_label: string
  score: number
  unit: string
  contributions: ActivityContribution[]
}

export interface ActivityLCAResult {
  results: ActivityLCAMethodResult[]
  elapsed_seconds: number
}

export async function calculateActivityLCA(
  activities: ActivityDemandItem[],
  methods: string[][],
): Promise<ActivityLCAResult> {
  return request<ActivityLCAResult>('/lca/calculate-activities', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activities, methods }),
  })
}

// ── Archetype LCA Calculator ─────────────────────────────────────────────────

export interface MaterialContribution {
  name: string
  stage: string
  component: string
  quantity: number
  unit: string
  impact: number
  percentage: number
}

export interface ArchetypeLCAMethodResult {
  method: string[]
  method_label: string
  score: number
  unit: string
  contributions: MaterialContribution[]
}

export interface ArchetypeLCACalculateResult {
  archetype_id: string
  archetype_name: string
  scope: string
  amount: number
  stage_amounts: Record<string, number>
  stages_included: string[]
  results: ArchetypeLCAMethodResult[]
  elapsed_seconds: number
  // Patch 3 (M1): backend echoes the LCI database the run was computed against
  // and the named parameter scenario (if any). `warnings` carries
  // database-translation messages (missing prospective keys etc.).
  compute_database?: string | null
  parameter_scenario?: string | null
  warnings?: string[]
  // Patch 4B: per-method, per-stage subtotal of impact. Populated only
  // when `scope == "all"`. Shape: {method_label: {stage_name: score}}.
  // Sum of stage values per method equals the method total.
  stage_breakdown?: Record<string, Record<string, number>> | null
}

export interface CalculateArchetypeLCAOptions {
  stageAmounts?: Record<string, number>
  amount?: number
  computeDatabase?: string | null
  parameterScenario?: string | null
}

export async function calculateArchetypeLCA(
  archetypeId: string,
  scope: string,
  methods: string[][],
  options: CalculateArchetypeLCAOptions = {},
): Promise<ArchetypeLCACalculateResult> {
  const { stageAmounts, amount, computeDatabase, parameterScenario } = options
  return request<ArchetypeLCACalculateResult>('/lca/calculate-archetype', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      archetype_id: archetypeId,
      scope,
      amount: amount ?? 1,
      stage_amounts: stageAmounts ?? null,
      methods,
      compute_database: computeDatabase ?? null,
      parameter_scenario: parameterScenario ?? null,
    }),
  })
}

// ── Multi-product LCA comparison (Patch 4AG) ─────────────────────────────────
//
// Request a side-by-side comparison across N items (mixed archetype +
// activity). Each item computes as an independent LCA; the response
// envelope preserves source order. Per-item error isolation: a failure
// on one item carries `status="error"` + `error_message`; remaining
// items still compute. See `mapper-backend/mapper/models/schemas.py`
// for the authoritative backend shape.

export interface MultiProductArchetypeItem {
  type: 'archetype'
  archetype_id: string
  stage_amounts?: Record<string, number> | null
  parameter_scenario?: string | null
}

export interface MultiProductActivityItem {
  type: 'activity'
  database: string
  code: string
  amount?: number
  // Per-item vintage label (e.g. 'ecoinvent', 'SSP1 2040'), composed into the
  // result label so two vintages of one activity don't collide on a chart axis.
  // Frontend-owned display concept; the per-item DB selection IS `database`.
  vintage_label?: string | null
}

export type MultiProductRequestItem =
  | MultiProductArchetypeItem
  | MultiProductActivityItem

export interface MultiProductLCARequest {
  items: MultiProductRequestItem[]
  methods: string[][]
  scope?: 'inflows' | 'stock' | 'outflows' | 'all'
  compute_database?: string | null
}

export interface MultiProductItemResult {
  type: 'archetype' | 'activity'
  item_id: string
  label: string
  status: 'success' | 'error'
  error_message?: string | null
  archetype_result?: ArchetypeLCACalculateResult | null
  activity_result?: ActivityLCAResult | null
}

export interface MultiProductLCAResult {
  items: MultiProductItemResult[]
  elapsed_seconds: number
  success_count: number
  error_count: number
}

export async function calculateMultiProductLCA(
  body: MultiProductLCARequest,
): Promise<MultiProductLCAResult> {
  return request<MultiProductLCAResult>('/lca/calculate-multi-product', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Patch 4AG.4 — multi-product LCA comparison export (xlsx).
 *  Frontend assembles the request envelope (result + compute-config
 *  metadata) and POSTs to the backend; the response binary triggers
 *  a download. Filename comes from the backend's
 *  `Content-Disposition` header (`MApper_MultiProduct_Comparison_<date>.xlsx`). */
export async function exportMultiProductComparison(
  result: MultiProductLCAResult,
  scope: 'inflows' | 'stock' | 'outflows' | 'all',
  options: {
    computeDatabase?: string | null
    computedAt?: string
    // Patch 5J — per-item stage-amount provenance, keyed by item_id
    // (archetype_id for archetype items). Captures preset + lifetime +
    // resolved amounts so the export's "Stage amounts" sheet reproduces the run.
    stageAmountsMeta?: Record<string, { preset: string; lifetime: number; amounts: Record<string, number> }>
    // Per-item vintage provenance (activity mode), keyed by item_id
    // ("{database}|{code}"). Records which DB/SSP/year each activity item used.
    activityVintageMeta?: Record<string, {
      label: string; database: string
      base_database?: string | null; iam?: string | null; ssp?: string | null; year?: number | null
    }>
  } = {},
): Promise<void> {
  const date = new Date().toISOString().slice(0, 10)
  await _downloadXlsx(
    `${API_BASE}/impact/export-multi-product`,
    {
      result,
      scope,
      compute_database: options.computeDatabase ?? null,
      computed_at: options.computedAt ?? new Date().toISOString(),
      stage_amounts_meta: options.stageAmountsMeta ?? null,
      activity_vintage_meta: options.activityVintageMeta ?? null,
    },
    `MApper_MultiProduct_Comparison_${date}.xlsx`,
  )
}


// ── Contribution Analysis (Single-Product LCA) ───────────────────────────────

export interface ContributionAnalysisRequest {
  target_type: 'activity' | 'archetype'
  database?: string
  code?: string
  amount?: number
  archetype_id?: string
  scope?: 'inflows' | 'stock' | 'outflows' | 'all'
  stage_amounts?: Record<string, number> | null
  year?: number | null
  // Database to compute against — when set and different from each demand
  // key's source DB, the backend translates keys to this DB (typically a
  // premise-generated prospective database). When omitted, the backend
  // computes against each demand key's source DB (current behavior).
  compute_database?: string | null
  method: string[]
  limit?: number
  cutoff?: number
  max_depth?: number
  /** Cap on Sankey supply-chain graph nodes. Default 200; raise toward
   *  ~600 for high-branching market activities. Hard upper bound 1000. */
  max_nodes?: number
}

export interface BiosphereContributionItem {
  flow_name: string
  flow_key: string
  categories: string[]
  compartment: string
  subcompartment: string
  inventory_amount: number
  inventory_unit: string
  amount: number
  unit: string
  percentage: number
}

export interface ContributionTreeNode {
  name: string
  key: string
  location?: string
  amount: number
  unit: string
  score: number
  unit_score: string
  percentage: number
  children: ContributionTreeNode[]
}

export interface StageContribution {
  stage: string
  score: number
  unit?: string
  percentage?: number
}

export interface ContributionAnalysisResult {
  // Discriminator — paired with system-level ImpactAssessmentResult.
  result_type?: 'single_product'
  target_type: 'activity' | 'archetype'
  target_label: string
  method: string[]
  method_unit: string
  score: number
  scope: string
  year: number | null
  // Database the result was computed against (mirrors request.compute_database).
  compute_database?: string | null
  top_technosphere: ContributionsResponse
  top_biosphere: BiosphereContributionItem[]
  biosphere_rest_amount: number
  biosphere_rest_percentage: number
  supply_chain_sankey: SankeyData
  supply_chain_tree: ContributionTreeNode
  // Per-stage characterised scores for archetype targets (Manufacturing,
  // Use Phase, Maintenance, End of Life, …). Empty for activity targets.
  by_stage?: StageContribution[]
  cutoff: number
  max_depth: number
  elapsed_seconds: number
  // Non-fatal warnings (e.g. activity-key fallbacks for missing prospective DB entries).
  warnings?: string[]
  // Reproducibility stamps.
  computed_at?: string | null
  mapper_version?: string | null
}

export interface ProspectiveYearsResponse {
  pattern: string
  available_years: number[]
  is_prospective: boolean
}

export async function getProspectiveYears(
  database: string,
): Promise<ProspectiveYearsResponse> {
  const q = encodeURIComponent(database)
  return request<ProspectiveYearsResponse>(`/lca/prospective-years?database=${q}`)
}

export async function runContributionAnalysis(
  body: ContributionAnalysisRequest,
): Promise<ContributionAnalysisResult> {
  return request<ContributionAnalysisResult>('/lca/contribution-analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function exportContributionAnalysis(
  result: ContributionAnalysisResult,
  filename: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/lca/contribution-analysis/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ result }),
  })
  if (!res.ok) throw new Error(await res.text())
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Multi-year contribution analysis ───────────────────────────────────────

export interface MultiYearContributionRequest {
  target_type: 'activity' | 'archetype'
  database?: string | null
  code?: string | null
  amount?: number
  archetype_id?: string | null
  scope?: string
  stage_amounts?: Record<string, number> | null
  // Year-stripped IAM × pathway pattern. None ⇒ every year computes against
  // the source DB (parameter-only trajectory).
  compute_database_pattern?: string | null
  years: number[]
  method: string[]
  limit?: number
  cutoff?: number
  max_depth?: number
  max_nodes?: number
}

export interface MultiYearTrajectoryPoint {
  year: number
  score: number
  compute_database?: string | null
  has_warnings: boolean
}

export interface MultiYearEvolutionItem {
  activity_key: string
  activity_name: string
  location?: string
  unit?: string
  by_year: Record<string, number>
}

export interface MultiYearContributionResult {
  result_type: 'multi_year_single_product'
  target_type: string
  target_label: string
  method: string[]
  method_unit: string
  compute_database_pattern?: string | null
  years: number[]
  results: Record<string, ContributionAnalysisResult>
  trajectory: MultiYearTrajectoryPoint[]
  evolution: MultiYearEvolutionItem[]
  cutoff: number
  max_depth: number
  elapsed_seconds: number
  warnings: string[]
  computed_at?: string | null
  mapper_version?: string | null
}

export interface MultiYearContributionTaskStarted {
  task_id: string
  planned_years: number[]
  compute_databases: string[]
}

export async function startMultiYearContribution(
  body: MultiYearContributionRequest,
): Promise<MultiYearContributionTaskStarted> {
  return request<MultiYearContributionTaskStarted>(
    '/lca/contribution-analysis/multi-year',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
}

export async function getMultiYearContribution(
  taskId: string,
): Promise<MultiYearContributionResult> {
  return request<MultiYearContributionResult>(
    `/lca/contribution-analysis/multi-year/${encodeURIComponent(taskId)}`,
  )
}

export interface MultiYearProgress {
  type: 'progress' | 'done' | 'error' | 'cancelled'
  stage?: string
  pct?: number
  year?: number
  task_id?: string
  error?: string
}

/** Subscribe to multi-year progress. Returns the WebSocket so the caller can
 *  close it on unmount. The ``onMessage`` callback is invoked for every frame
 *  including ``done`` / ``error`` (the socket closes itself afterwards). */
export function subscribeMultiYearProgress(
  taskId: string,
  onMessage: (msg: MultiYearProgress) => void,
): WebSocket {
  const ws = new WebSocket(`${WS_BASE}/ws/lca/multi-year/${encodeURIComponent(taskId)}`)
  ws.onmessage = (ev) => {
    try {
      onMessage(JSON.parse(ev.data) as MultiYearProgress)
    } catch {
      // Ignore unparseable frames — backend always sends JSON.
    }
  }
  return ws
}

export async function exportMultiYearContribution(
  result: MultiYearContributionResult,
  filename: string,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/lca/contribution-analysis/multi-year/export`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result }),
    },
  )
  if (!res.ok) throw new Error(await res.text())
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function exportArchetypeLCA(
  results: ArchetypeLCACalculateResult[],
  filename: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/lca/export-archetype`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ results }),
  })
  if (!res.ok) throw new Error(await res.text())
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── DSM endpoints ────────────────────────────────────────────────────────────

export async function createDSMSystem(def: Omit<SystemDefinition, 'id' | 'created_at'>): Promise<SystemDefinition> {
  return request<SystemDefinition>('/dsm/systems', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(def),
  })
}

export async function listDSMSystems(): Promise<SystemSummary[]> {
  return request<SystemSummary[]>('/dsm/systems')
}

export async function getDSMSystem(id: string): Promise<SystemDefinition> {
  return request<SystemDefinition>(`/dsm/systems/${id}`)
}

export interface SystemUpdateResponse {
  system: SystemDefinition
  warnings: string[]
}

export async function updateDSMSystem(id: string, def: SystemDefinition): Promise<SystemUpdateResponse> {
  return request<SystemUpdateResponse>(`/dsm/systems/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(def),
  })
}

export async function deleteDSMSystem(id: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/dsm/systems/${id}`, { method: 'DELETE' })
}

export async function getMFAState(id: string): Promise<DSMSystemState> {
  return request<DSMSystemState>(`/dsm/systems/${id}/state`)
}

export async function patchDSMSettings(
  id: string,
  body: { integer_units?: boolean },
): Promise<{ integer_units: boolean }> {
  return request<{ integer_units: boolean }>(`/dsm/systems/${id}/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function withScenario(path: string, scenarioId?: string | null): string {
  if (!scenarioId) return path
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}scenario_id=${encodeURIComponent(scenarioId)}`
}

export async function uploadStock(
  id: string, file: File, scenarioId?: string | null,
): Promise<StockUploadResult> {
  return uploadFile<StockUploadResult>(
    withScenario(`/dsm/systems/${id}/stock/upload`, scenarioId), file,
  )
}

export async function parseLabelFile(
  file: File,
  expectedDimension: string,
  validDimensions?: string[],
): Promise<{ labels: string[] }> {
  const form = new FormData()
  form.append('file', file)
  form.append('expected_dimension', expectedDimension)
  if (validDimensions && validDimensions.length > 0) {
    form.append('valid_dimensions', validDimensions.join(','))
  }
  const res = await fetch(`${API_BASE}/dsm/parse-labels`, { method: 'POST', body: form })
  if (!res.ok) {
    let detail: string
    try {
      const body = await res.json()
      detail = typeof body?.detail === 'string' ? body.detail : JSON.stringify(body)
    } catch {
      detail = await res.text()
    }
    throw new Error(detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function uploadInflows(
  id: string, file: File, scenarioId?: string | null,
): Promise<InflowUploadResult> {
  return uploadFile<InflowUploadResult>(
    withScenario(`/dsm/systems/${id}/inflows/upload`, scenarioId), file,
  )
}

export async function setSurvivalConfigs(id: string, configs: SurvivalConfig[]): Promise<{ configs_set: number }> {
  return request<{ configs_set: number }>(`/dsm/systems/${id}/survival`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ configs }),
  })
}

export async function getSurvivalConfigs(id: string): Promise<{ configs: SurvivalConfig[] }> {
  return request<{ configs: SurvivalConfig[] }>(`/dsm/systems/${id}/survival`)
}

export async function previewSurvival(
  id: string,
  shape: number,
  scale: number,
  maxAge?: number,
): Promise<SurvivalPreviewPoint[]> {
  const params = new URLSearchParams({ shape: String(shape), scale: String(scale) })
  if (maxAge !== undefined) params.set('max_age', String(maxAge))
  return request<SurvivalPreviewPoint[]>(`/dsm/systems/${id}/survival/preview?${params}`)
}

export async function simulateMFA(id: string, scenarioId?: string | null): Promise<SimulationResult> {
  const qs = scenarioId ? `?scenario_id=${encodeURIComponent(scenarioId)}` : ''
  const res = await request<SimulationResult>(`/dsm/systems/${id}/simulate${qs}`, { method: 'POST' })
  recordComputation({ module: 'DSM', description: `Simulate ${id}`, metrics: res.compute_metrics })
  return res
}

export async function getMFAResults(id: string): Promise<SimulationResult> {
  return request<SimulationResult>(`/dsm/systems/${id}/results`)
}

export async function downloadStockTemplate(id: string, name: string): Promise<void> {
  return downloadCSV(`/dsm/systems/${id}/templates/stock`, `stock_template_${name}.xlsx`)
}

export async function exportMFAResults(systemId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/dsm/systems/${systemId}/export`)
  if (!res.ok) throw new Error(await res.text())
  const blob = await res.blob()
  const filename = res.headers.get('content-disposition')?.split('filename=')[1]?.replace(/"/g, '') || 'simulation.xlsx'
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// All-years cohort table export ("Cohorts in {year}" box, exports every year).
// Mirrors exportMFAResults — the established DSM data-xlsx pattern (backend
// builds the long-format workbook, frontend downloads the blob).
export async function exportDSMCohorts(systemId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/dsm/systems/${systemId}/cohorts/export`)
  if (!res.ok) throw new Error(await res.text())
  const blob = await res.blob()
  const filename = res.headers.get('content-disposition')?.split('filename=')[1]?.replace(/"/g, '') || 'cohorts.xlsx'
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export interface ImportResult {
  years_imported: number
  cohorts_found: number
  warnings: string[]
}

export async function importMFASimulation(systemId: string, file: File): Promise<ImportResult> {
  return uploadFile<ImportResult>(`/dsm/systems/${systemId}/import-simulation`, file)
}

export async function importDSMSystem(file: File): Promise<SystemDefinition> {
  return uploadFile<SystemDefinition>(`/dsm/import-system`, file)
}

export async function downloadInflowTemplate(id: string, name: string): Promise<void> {
  return downloadCSV(`/dsm/systems/${id}/templates/inflows`, `inflow_template_${name}.xlsx`)
}

export async function uploadStockTargets(
  id: string, file: File, scenarioId?: string | null,
): Promise<StockTargetUploadResult> {
  return uploadFile<StockTargetUploadResult>(
    withScenario(`/dsm/systems/${id}/stock-targets/upload`, scenarioId), file,
  )
}

export async function uploadOutflows(
  id: string, file: File, scenarioId?: string | null,
): Promise<OutflowUploadResult> {
  return uploadFile<OutflowUploadResult>(
    withScenario(`/dsm/systems/${id}/outflows/upload`, scenarioId), file,
  )
}

export async function downloadOutflowTemplate(id: string, name: string): Promise<void> {
  return downloadCSV(`/dsm/systems/${id}/templates/outflows`, `outflow_template_${name}.xlsx`)
}

export async function uploadStockAggregate(
  id: string,
  file: File,
  opts?: { shape?: number; scale?: number; maxAge?: number; scenarioId?: string | null },
): Promise<StockUploadResult> {
  const params = new URLSearchParams()
  if (opts?.shape !== undefined) params.set('shape', String(opts.shape))
  if (opts?.scale !== undefined) params.set('scale', String(opts.scale))
  if (opts?.maxAge !== undefined) params.set('max_age', String(opts.maxAge))
  if (opts?.scenarioId) params.set('scenario_id', opts.scenarioId)
  const q = params.toString()
  const path = `/dsm/systems/${id}/stock/upload-aggregate${q ? `?${q}` : ''}`
  return uploadFile<StockUploadResult>(path, file)
}

export async function getModeConfigs(
  id: string, scenarioId?: string | null,
): Promise<{ configs: ModeConfig[] }> {
  return request<{ configs: ModeConfig[] }>(
    withScenario(`/dsm/systems/${id}/mode-configs`, scenarioId),
  )
}

export async function setModeConfigs(
  id: string, configs: ModeConfig[], scenarioId?: string | null,
): Promise<{ configs_set: number }> {
  return request<{ configs_set: number }>(
    withScenario(`/dsm/systems/${id}/mode-configs`, scenarioId),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ configs }),
    },
  )
}

// ── Scaling rules (parameter-driven scenario scaling) ───────────────────────

export async function getScalingRules(
  id: string, scenarioId?: string | null,
): Promise<DSMScalingRuleList> {
  return request<DSMScalingRuleList>(
    withScenario(`/dsm/systems/${id}/scaling-rules`, scenarioId),
  )
}

export async function setScalingRules(
  id: string, rules: DSMScalingRule[], scenarioId?: string | null,
): Promise<{ rules_set: number }> {
  return request<{ rules_set: number }>(
    withScenario(`/dsm/systems/${id}/scaling-rules`, scenarioId),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules }),
    },
  )
}

export async function createScalingRule(
  id: string, rule: DSMScalingRule, scenarioId?: string | null,
): Promise<DSMScalingRule> {
  return request<DSMScalingRule>(
    withScenario(`/dsm/systems/${id}/scaling-rules`, scenarioId),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rule),
    },
  )
}

export async function updateScalingRule(
  id: string, ruleId: string, rule: DSMScalingRule, scenarioId?: string | null,
): Promise<DSMScalingRule> {
  return request<DSMScalingRule>(
    withScenario(`/dsm/systems/${id}/scaling-rules/${ruleId}`, scenarioId),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rule),
    },
  )
}

export async function deleteScalingRule(
  id: string, ruleId: string, scenarioId?: string | null,
): Promise<void> {
  await request(
    withScenario(`/dsm/systems/${id}/scaling-rules/${ruleId}`, scenarioId),
    { method: 'DELETE' },
  )
}

// ── DSM scenarios ──────────────────────────────────────────────────────────

export async function listDSMScenarios(id: string): Promise<ScenarioList> {
  return request<ScenarioList>(`/dsm/systems/${id}/scenarios`)
}

export async function createDSMScenario(
  id: string, body: ScenarioCreateBody,
): Promise<DSMScenario> {
  return request<DSMScenario>(`/dsm/systems/${id}/scenarios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function updateDSMScenario(
  id: string, scenarioId: string, body: ScenarioUpdateBody,
): Promise<DSMScenario> {
  return request<DSMScenario>(`/dsm/systems/${id}/scenarios/${scenarioId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function deleteDSMScenario(
  id: string, scenarioId: string,
): Promise<{ deleted: string }> {
  return request<{ deleted: string }>(
    `/dsm/systems/${id}/scenarios/${scenarioId}`,
    { method: 'DELETE' },
  )
}

export async function activateDSMScenario(
  id: string, scenarioId: string,
): Promise<ScenarioList> {
  return request<ScenarioList>(
    `/dsm/systems/${id}/scenarios/${scenarioId}/activate`,
    { method: 'POST' },
  )
}

export async function promoteDSMScenarioToBase(
  id: string, newBaseId: string,
): Promise<ScenarioList> {
  return request<ScenarioList>(
    `/dsm/systems/${id}/scenarios/${newBaseId}/promote-to-base`,
    { method: 'POST' },
  )
}

export async function simulateScenarios(
  id: string,
  body: { scenario_ids?: string[]; cases?: string[] },
): Promise<MultiScenarioSimulationResult> {
  const res = await request<MultiScenarioSimulationResult>(
    `/dsm/systems/${id}/simulate-scenarios`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  const count = Object.keys(res.scenarios).length
  // Pick any one result's compute_metrics as representative — multi-run
  // cross-product totals aren't yet aggregated server-side.
  const anyMetrics = Object.values(res.scenarios)[0]?.compute_metrics
  recordComputation({
    module: 'DSM',
    description: `Simulate ${id} · ${count} run${count === 1 ? '' : 's'}`,
    metrics: anyMetrics,
  })
  return res
}

export async function downloadStockTargetsTemplate(id: string, name: string): Promise<void> {
  return downloadCSV(`/dsm/systems/${id}/templates/stock-targets`, `stock_target_template_${name}.xlsx`)
}

export async function downloadStockAggregateTemplate(id: string, name: string): Promise<void> {
  return downloadCSV(`/dsm/systems/${id}/templates/stock-aggregate`, `stock_aggregate_template_${name}.xlsx`)
}

// ── Subsystem endpoints ──────────────────────────────────────────────────────

export async function listSubsystems(systemId: string): Promise<SubsystemList> {
  return request<SubsystemList>(`/dsm/systems/${systemId}/subsystems`)
}

export async function listSubsystemSummaries(systemId: string): Promise<SubsystemSummary[]> {
  return request<SubsystemSummary[]>(`/dsm/systems/${systemId}/subsystems/summary`)
}

export async function getSubsystem(systemId: string, subsystemId: string): Promise<Subsystem> {
  return request<Subsystem>(`/dsm/systems/${systemId}/subsystems/${subsystemId}`)
}

export async function createSubsystem(
  systemId: string,
  body: Omit<Subsystem, 'id'> & { id?: string },
): Promise<Subsystem> {
  return request<Subsystem>(`/dsm/systems/${systemId}/subsystems`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, id: body.id ?? '' }),
  })
}

export async function updateSubsystem(
  systemId: string,
  subsystemId: string,
  body: Subsystem,
): Promise<Subsystem> {
  return request<Subsystem>(`/dsm/systems/${systemId}/subsystems/${subsystemId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function deleteSubsystem(
  systemId: string,
  subsystemId: string,
): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(
    `/dsm/systems/${systemId}/subsystems/${subsystemId}`,
    { method: 'DELETE' },
  )
}

export async function validateDependencyRule(
  systemId: string,
  rule: DependencyRule,
): Promise<RuleValidationResult> {
  return request<RuleValidationResult>(
    `/dsm/systems/${systemId}/subsystems/validate-rule`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rule),
    },
  )
}

export async function computeSubsystem(
  systemId: string,
  subsystemId: string,
  parameterSetId?: string | null,
): Promise<SimulationResult> {
  return request<SimulationResult>(
    `/dsm/systems/${systemId}/subsystems/${subsystemId}/compute`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parameter_set_id: parameterSetId ?? null }),
    },
  )
}

export async function computeAllSubsystems(
  systemId: string,
  parameterSetId?: string | null,
): Promise<SubsystemComputeAllResponse> {
  return request<SubsystemComputeAllResponse>(
    `/dsm/systems/${systemId}/subsystems/compute-all`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parameter_set_id: parameterSetId ?? null }),
    },
  )
}

export async function getSubsystemResult(
  systemId: string,
  subsystemId: string,
): Promise<SimulationResult> {
  return request<SimulationResult>(
    `/dsm/systems/${systemId}/subsystems/${subsystemId}/results`,
  )
}

export async function uploadSubsystemInitialStock(
  systemId: string,
  subsystemId: string,
  file: File,
): Promise<SubsystemInitialStockUploadResult> {
  return uploadFile<SubsystemInitialStockUploadResult>(
    `/dsm/systems/${systemId}/subsystems/${subsystemId}/stock/upload`,
    file,
  )
}

export async function clearSubsystemInitialStock(
  systemId: string,
  subsystemId: string,
): Promise<{ cleared: boolean }> {
  return request<{ cleared: boolean }>(
    `/dsm/systems/${systemId}/subsystems/${subsystemId}/stock`,
    { method: 'DELETE' },
  )
}

export async function downloadSubsystemStockTemplate(
  systemId: string,
  subsystemId: string,
  name: string,
): Promise<void> {
  return downloadCSV(
    `/dsm/systems/${systemId}/subsystems/${subsystemId}/stock/template`,
    `stock_template_${name}.csv`,
  )
}

// ── BOM / Archetype endpoints ────────────────────────────────────────────────

export async function listArchetypes(): Promise<ArchetypeSummary[]> {
  return request<ArchetypeSummary[]>('/bom/archetypes')
}

export async function getArchetype(id: string): Promise<Archetype> {
  return request<Archetype>(`/bom/archetypes/${id}`)
}

export async function createArchetype(data: {
  name: string
  description?: string | null
  category?: string | null
  folder?: string | null
  bom: BOMNode[]
}): Promise<Archetype> {
  return request<Archetype>('/bom/archetypes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function updateArchetype(id: string, data: {
  name: string
  description?: string | null
  category?: string | null
  folder?: string | null
  bom: BOMNode[]
}): Promise<Archetype> {
  return request<Archetype>(`/bom/archetypes/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function deleteArchetype(id: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/bom/archetypes/${id}`, { method: 'DELETE' })
}

export async function addBOMNode(arcId: string, parentNodeId: string | null, node: BOMNode): Promise<Archetype> {
  return request<Archetype>(`/bom/archetypes/${arcId}/nodes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parent_node_id: parentNodeId, node }),
  })
}

// ── BOM Excel export / import ────────────────────────────────────────────────

export interface BOMImportResult {
  id: string
  name: string
  stages: number
  materials: number
  linked: number
  unlinked: number
  warnings: string[]
}

export interface MultiImportArchetypeSummary {
  id: string
  name: string
  folder: string | null
  stages: number
  materials: number
  linked: number
  unlinked: number
  action?: 'created' | 'updated'
  validation_error_rows?: number
  validation_warning_rows?: number
}

export type ValidationSeverity = 'error' | 'warning'
export type ValidationErrorType =
  | 'code_truncated'
  | 'code_not_found'
  | 'database_missing'
  | 'code_no_database'
  | 'database_no_code'
  | 'name_mismatch'
  | 'location_mismatch'

export interface ValidationIssue {
  severity: ValidationSeverity
  error_type: ValidationErrorType
  archetype: string
  stage: string
  row_idx: number
  name: string
  bad_value: string
  message: string
  bom_ecoinvent_name?: string
}

export interface ValidationGroupAffected {
  archetype: string
  stage: string
  row_idx: number
  name: string
}

export interface ValidationGroup {
  severity: ValidationSeverity
  error_type: ValidationErrorType
  bad_value: string
  bom_name: string
  count: number
  affected: ValidationGroupAffected[]
}

export interface ValidationReport {
  total_rows: number
  valid_rows: number
  error_rows: number
  warning_rows: number
  issues: ValidationIssue[]
  groups: ValidationGroup[]
  project_name?: string
  bw2_lookups?: number
  cache_hits?: number
}

export interface MultiImportResult {
  format: 'single' | 'multi'
  mode?: 'merge' | 'replace'
  created: number
  updated?: number
  folders_created: number
  archetypes: MultiImportArchetypeSummary[]
  warnings: string[]
  validation_reports?: Record<string, ValidationReport>
}

export async function getArchetypeValidationReport(
  arcId: string,
): Promise<ValidationReport> {
  return request<ValidationReport>(`/bom/archetypes/${arcId}/validation-report`)
}

export async function exportArchetype(arcId: string, name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/bom/archetypes/${arcId}/export`)
  if (!res.ok) throw new Error(await res.text())
  const blob = await res.blob()
  const safe = (name || 'archetype').replace(/[^A-Za-z0-9._-]+/g, '_')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safe}_bom.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

export async function exportAllArchetypes(folder?: string | null): Promise<void> {
  const q = folder ? `?folder=${encodeURIComponent(folder)}` : ''
  const res = await fetch(`${API_BASE}/bom/archetypes/export-all${q}`)
  if (!res.ok) throw new Error(await res.text())
  const blob = await res.blob()
  const safe = folder ? folder.replace(/[^A-Za-z0-9._-]+/g, '_') : 'all'
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `mapper_archetypes_${safe}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

export async function downloadBOMTemplate(): Promise<void> {
  const res = await fetch(`${API_BASE}/bom/template`)
  if (!res.ok) throw new Error(await res.text())
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'mapper_archetypes_template.xlsx'
  a.click()
  URL.revokeObjectURL(url)
}

export async function importArchetype(
  file: File,
  mode: 'merge' | 'replace' = 'merge',
): Promise<MultiImportResult> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API_BASE}/bom/archetypes/import?mode=${mode}`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(detail || `HTTP ${res.status}`)
  }
  return res.json()
}

// ── Folder endpoints ─────────────────────────────────────────────────────────

export async function listFolders(): Promise<string[]> {
  return request<string[]>('/bom/folders')
}

export async function createFolder(path: string): Promise<{ path: string; folders: string[] }> {
  return request<{ path: string; folders: string[] }>('/bom/folders/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
}

export async function renameFolder(
  oldPath: string,
  newPath: string,
): Promise<{ renamed: number; folders: string[] }> {
  return request<{ renamed: number; folders: string[] }>('/bom/folders/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ old_path: oldPath, new_path: newPath }),
  })
}

export async function deleteFolder(
  path: string,
  deleteArchetypes = false,
): Promise<{ deleted_archetypes: number; moved_archetypes: number; folders: string[] }> {
  return request<{ deleted_archetypes: number; moved_archetypes: number; folders: string[] }>(
    '/bom/folders/delete',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, delete_archetypes: deleteArchetypes }),
    },
  )
}

export async function moveArchetype(
  archetypeId: string,
  newFolder: string | null,
): Promise<Archetype> {
  return request<Archetype>('/bom/archetypes/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ archetype_id: archetypeId, new_folder: newFolder }),
  })
}

export async function updateBOMNode(
  arcId: string,
  nodeId: string,
  patch: { name?: string; quantity?: number; quantity_expression?: string | null; unit?: string; is_annual?: boolean; scope?: 'inflows' | 'stock' | 'outflows' | null; ecoinvent_activity?: EcoinventLink | null; evolution?: MaterialEvolution | null },
): Promise<BOMNode> {
  return request<BOMNode>(`/bom/archetypes/${arcId}/nodes/${nodeId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

export async function fetchArchetypeTimeline(
  arcId: string,
  opts: { years?: number[]; yearStart?: number; yearEnd?: number; step?: number },
): Promise<ArchetypeTimeline> {
  const q = new URLSearchParams()
  if (opts.years && opts.years.length > 0) q.set('years', opts.years.join(','))
  if (opts.yearStart !== undefined) q.set('year_start', String(opts.yearStart))
  if (opts.yearEnd !== undefined) q.set('year_end', String(opts.yearEnd))
  if (opts.step !== undefined) q.set('step', String(opts.step))
  return request<ArchetypeTimeline>(`/bom/archetypes/${arcId}/timeline?${q.toString()}`)
}

export async function compareArchetypeTimeline(
  arcId: string,
  yearStart: number,
  yearEnd: number,
): Promise<TimelineCompareResult> {
  const q = new URLSearchParams({ year_start: String(yearStart), year_end: String(yearEnd) })
  return request<TimelineCompareResult>(`/bom/archetypes/${arcId}/timeline/compare?${q.toString()}`)
}

export async function applyLearningRate(
  arcId: string,
  args: {
    node_ids?: string[] | null
    learning_rate: number | null
    base_year?: number
    reset?: boolean
  },
): Promise<Archetype> {
  return request<Archetype>(`/bom/archetypes/${arcId}/apply-learning-rate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
}

export async function applyReboundEffect(
  arcId: string,
  args: {
    node_ids?: string[] | null
    rebound_rate: number | null
    base_year?: number
    applies_to_stages?: string[] | null
    reset?: boolean
  },
): Promise<Archetype> {
  return request<Archetype>(`/bom/archetypes/${arcId}/apply-rebound-effect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
}

export async function applyMilestones(
  arcId: string,
  nodeId: string,
  milestones: QuantityMilestone[],
): Promise<BOMNode> {
  return request<BOMNode>(`/bom/archetypes/${arcId}/apply-milestones`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ node_id: nodeId, milestones }),
  })
}

export async function deleteBOMNode(arcId: string, nodeId: string): Promise<Archetype> {
  return request<Archetype>(`/bom/archetypes/${arcId}/nodes/${nodeId}`, { method: 'DELETE' })
}

export async function flattenArchetype(arcId: string, year?: number | null): Promise<FlattenedBOM> {
  const suffix = year != null ? `?year=${year}` : ''
  return request<FlattenedBOM>(`/bom/archetypes/${arcId}/flatten${suffix}`)
}

export async function runArchetypeLCA(
  arcId: string,
  method: string[],
  amount = 1,
): Promise<ArchetypeLCAResult> {
  return request<ArchetypeLCAResult>(`/bom/archetypes/${arcId}/lca`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, amount }),
  })
}

// ── Cohort mappings + combined DSM × LCA ─────────────────────────────────────

export async function setCohortMappings(
  systemId: string,
  mappings: CohortMappingEntry[],
  rowColors?: Record<string, string>,
): Promise<CohortMappingResult> {
  return request<CohortMappingResult>(`/dsm/systems/${systemId}/cohort-mappings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mfa_system_id: systemId,
      mappings,
      // Patch 4AK — row colors round-trip in the same payload.
      row_colors: rowColors ?? {},
    }),
  })
}

export async function getCohortMappings(systemId: string): Promise<CohortMapping> {
  return request<CohortMapping>(`/dsm/systems/${systemId}/cohort-mappings`)
}

export async function uploadCohortMappings(
  systemId: string,
  file: File,
): Promise<CohortMappingResult> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API_BASE}/dsm/systems/${systemId}/cohort-mappings/upload`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(detail || `Upload failed (${res.status})`)
  }
  return res.json()
}

export async function downloadCohortMappingsTemplate(
  systemId: string,
  filename: string,
): Promise<void> {
  const url = `${API_BASE}/dsm/systems/${encodeURIComponent(systemId)}/cohort-mappings/template`
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Template download failed (${res.status}) ${url} — ${body || '(no body)'}`)
  }
  const blob = await res.blob()
  const blobUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(blobUrl)
}

export interface DSMLCARunOptions {
  scope: 'inflows' | 'outflows' | 'stock' | 'all'
  yearStart?: number | null
  yearEnd?: number | null
  parameterSetId?: string | null
}

export async function runDSMLCA(
  systemId: string,
  methods: string[][],
  opts: DSMLCARunOptions,
): Promise<DSMLCABatchResult> {
  const res = await request<DSMLCABatchResult>(`/dsm/systems/${systemId}/dsm-lca`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      methods,
      scope: opts.scope,
      year_start: opts.yearStart ?? null,
      year_end: opts.yearEnd ?? null,
      parameter_set_id: opts.parameterSetId ?? null,
    }),
  })
  recordComputation({
    module: 'DSM × LCA',
    description: `${methods.length} method${methods.length === 1 ? '' : 's'} · ${opts.scope}`,
    metrics: res.compute_metrics,
  })
  return res
}

export async function getDSMLCAResult(systemId: string): Promise<DSMLCABatchResult> {
  return request<DSMLCABatchResult>(`/dsm/systems/${systemId}/dsm-lca`)
}

export async function exportDSMLCA(systemId: string, filename: string, year?: number | null): Promise<void> {
  const qs = year != null ? `?year=${year}` : ''
  const res = await fetch(`${API_BASE}/dsm/systems/${systemId}/dsm-lca/export${qs}`, { method: 'POST' })
  if (!res.ok) throw new Error(await res.text())
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Material Flows ──────────────────────────────────────────────────────────

export interface MaterialSeries {
  name: string
  unit: string
  ecoinvent_name: string
  ecoinvent_code: string
  stage: string
  component: string
  values: Record<number, number>
  by_archetype: Record<string, Record<number, number>>
  evolution_method: string | null
  evolution_rate: number | null
  subsystem_id?: string
  subsystem_name?: string
}

export interface MaterialFlowSubsystemRef {
  id: string
  name: string
}

export interface MaterialFlowResult {
  scope: string
  stages_included: string[]
  year_start: number
  year_end: number
  group_by: string
  materials: MaterialSeries[]
  elapsed_seconds: number
  subsystems?: MaterialFlowSubsystemRef[]
  warnings?: string[]
  compute_metrics?: ComputeMetrics | null
  unit_name?: string
  system_units_by_year?: Record<number, number>
  archetype_units_by_year?: Record<string, Record<number, number>>
}

export async function calculateMaterialFlows(
  systemId: string,
  body: {
    scope: string
    year_start?: number | null
    year_end?: number | null
    group_by?: string
    // Patch 4M — in-task scenario fields. Both default to null /
    // unset for backward compat.
    dsm_scenario_id?: string | null
    parameter_scenario?: string | null
  },
): Promise<MaterialFlowResult> {
  const res = await request<MaterialFlowResult>(`/dsm/systems/${systemId}/material-flows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  recordComputation({
    module: 'MFA',
    description: `Material flows · ${body.scope}`,
    metrics: res.compute_metrics,
  })
  return res
}

// Patch 4M — multi-axis fan-out for Material Flows.
//
// Sync server-side loop, returns a flat envelope. axisConflict applies:
// at most one of `dsm_scenario_ids` / `parameter_scenarios` may be
// non-empty.
export interface MaterialFlowScenarioRun {
  axis: 'dsm' | 'parameter'
  scenario_id: string
  scenario_label: string
  result: MaterialFlowResult
}
export interface MultiMaterialFlowResult {
  axis: 'dsm' | 'parameter'
  runs: MaterialFlowScenarioRun[]
  elapsed_seconds: number
}

export async function calculateMaterialFlowsMulti(
  systemId: string,
  body: {
    scope: string
    year_start?: number | null
    year_end?: number | null
    group_by?: string
    dsm_scenario_ids?: string[] | null
    parameter_scenarios?: string[] | null
  },
): Promise<MultiMaterialFlowResult> {
  return request<MultiMaterialFlowResult>(
    `/dsm/systems/${systemId}/material-flows-multi`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
}

export async function exportMaterialFlows(
  systemId: string,
  scope: string,
  yearStart: number | null,
  yearEnd: number | null,
  filename: string,
): Promise<void> {
  const params = new URLSearchParams({ scope })
  if (yearStart != null) params.set('year_start', String(yearStart))
  if (yearEnd != null) params.set('year_end', String(yearEnd))
  const res = await fetch(`${API_BASE}/dsm/systems/${systemId}/material-flows/export?${params}`)
  if (!res.ok) throw new Error(await res.text())
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── WebSocket helper ──────────────────────────────────────────────────────────

export function connectToTask(
  path: string,
  onMessage: (data: TaskProgressMessage) => void,
  onError?: (e: Event) => void,
): WebSocket {
  const ws = new WebSocket(`${WS_BASE}${path}`)
  ws.onmessage = (e) => {
    try {
      onMessage(JSON.parse(e.data))
    } catch { /* ignore malformed frames */ }
  }
  if (onError) ws.onerror = onError
  return ws
}

// ── Phase 3A: Prospective LCA ────────────────────────────────────────────────

export interface PLCAScenarios {
  iams: string[]
  ssps: string[]
  ssps_by_iam: Record<string, string[]>
  years: number[]
  key_configured: boolean
}

export type PLCAMode = 'separate' | 'superstructure'

export interface ProspectiveDB {
  name: string
  base_db: string
  iam: string
  ssp: string
  year: number | null
  years: number[]
  mode: PLCAMode
  sdf_path?: string | null
  created_at: string
}

export interface PLCAGenerateRequest {
  base_db: string
  iam: string
  ssp: string
  years: number[]
  source_version?: string
  system_model?: string
  mode?: PLCAMode
}

export interface PLCAGenerateResponse {
  task_id: string
  planned_names: string[]
  mode: PLCAMode
}

export interface PLCAProgressMessage {
  type: 'progress' | 'done' | 'error' | 'cancelled'
  stage?: string
  pct?: number
  written?: string[]
  error?: string
  task_id?: string
}

export async function getPLCAScenarios(): Promise<PLCAScenarios> {
  const res = await fetch(`${API_BASE}/plca/scenarios`)
  if (!res.ok) throw new Error(`GET /plca/scenarios failed: ${res.status}`)
  return res.json()
}

export async function getPLCADatabases(): Promise<ProspectiveDB[]> {
  const res = await fetch(`${API_BASE}/plca/databases`)
  if (!res.ok) throw new Error(`GET /plca/databases failed: ${res.status}`)
  return res.json()
}

export async function startPLCAGeneration(body: PLCAGenerateRequest): Promise<PLCAGenerateResponse> {
  const res = await fetch(`${API_BASE}/plca/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`POST /plca/generate failed: ${res.status} ${detail}`)
  }
  return res.json()
}

export async function deletePLCADatabase(name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/plca/databases/${encodeURIComponent(name)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`DELETE /plca/databases failed: ${res.status}`)
}

export interface PremiseKeyStatus {
  configured: boolean
  path: string
}

export async function getPremiseKeyStatus(): Promise<PremiseKeyStatus> {
  const res = await fetch(`${API_BASE}/plca/key/status`)
  if (!res.ok) throw new Error(`GET /plca/key/status failed: ${res.status}`)
  return res.json()
}

export async function savePremiseKey(key: string): Promise<void> {
  const res = await fetch(`${API_BASE}/plca/key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  })
  if (!res.ok) {
    let detail: string
    try { detail = (await res.json()).detail ?? (await res.text()) } catch { detail = await res.text() }
    throw new Error(detail || `POST /plca/key failed: ${res.status}`)
  }
}

export async function deletePremiseKey(): Promise<void> {
  const res = await fetch(`${API_BASE}/plca/key`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`DELETE /plca/key failed: ${res.status}`)
}

export function connectToPLCATask(
  taskId: string,
  onMessage: (data: PLCAProgressMessage) => void,
  onError?: (e: Event) => void,
): WebSocket {
  const ws = new WebSocket(`${WS_BASE}/plca/ws/${encodeURIComponent(taskId)}`)
  ws.onmessage = (e) => {
    try {
      onMessage(JSON.parse(e.data))
    } catch { /* ignore malformed */ }
  }
  if (onError) ws.onerror = onError
  return ws
}

// ── Phase 3C: Impact Assessment (unified) ────────────────────────────────────

export interface ProspectiveScenarioRef {
  base_db: string
  iam: string
  ssp: string
}

export interface ImpactAssessmentRequest {
  mode: 'static' | 'projected'
  mfa_system_id: string
  scope: 'inflows' | 'outflows' | 'stock' | 'all'
  methods: string[][]
  year_start?: number | null
  year_end?: number | null
  base_db?: string | null
  scenario?: ProspectiveScenarioRef | null
  parameter_set_id?: string | null
  /** Optional multi-scenario sweep: one task is launched per entry. */
  scenarios?: string[] | null
  /** Multi-LCI-scenario projected runs: pass N prospective scenarios to run
   *  sequentially under a single task_id. ``len === 1`` collapses to legacy
   *  single-scenario semantics. Takes precedence over ``scenario``. */
  lci_scenarios?: ProspectiveScenarioRef[] | null
  /** Singular, in-task: when set, the backend simulates this DSM scenario
   *  fresh (without polluting ``_proj_results``) and runs the pipeline
   *  against it. When unset, the cached active-scenario sim is used. */
  dsm_scenario_id?: string | null
  /** List form for ``/impact/calculate-scenarios`` fan-out: spawn one task
   *  per id, threading each into per-task ``dsm_scenario_id``. Mutually
   *  exclusive with ``scenarios`` (parameter axis). */
  dsm_scenario_ids?: string[] | null
  /** Paired DSM × LCI co-variation (Patch 2F): one task per pair, threading
   *  both ``dsm_scenario_id`` (singular) AND ``scenario`` (singular LCI ref)
   *  into the per-task body. Mutually exclusive with ``scenarios``,
   *  ``dsm_scenario_ids``, and multi-LCI ``lci_scenarios``. */
  paired_scenarios?: PairedDSMLCIRef[] | null
  /** Projected-mode prospective-LCA temporal handling. ``'block'`` (default):
   *  per-year nearest-earlier premise anchor db (step at anchors).
   *  ``'interpolate'``: blend the two bracketing-anchor solves linearly
   *  (smooth). Default ``'block'`` → no drift; interpolate is opt-in. */
  temporal_mode?: 'block' | 'interpolate'
}

export interface ImpactAssessmentMeta {
  mode: 'static' | 'projected'
  mfa_system_id: string
  scope: 'inflows' | 'outflows' | 'stock' | 'all'
  year_start?: number | null
  year_end?: number | null
  base_db?: string | null
  scenario?: ProspectiveScenarioRef | null
  parameter_set_id?: string | null
  /** Echoed back from ``ImpactAssessmentRequest.dsm_scenario_id`` when the
   *  request explicitly named a DSM scenario; otherwise None. */
  dsm_scenario_id?: string | null
  year_to_database: Record<number, string>
  warnings?: string[]
}

export interface ImpactAssessmentResult {
  task_id: string
  meta: ImpactAssessmentMeta
  results: DSMLCAResult[]
  elapsed_seconds?: number | null
  /** Discriminator. Single-scenario projected/static runs return the legacy
   *  shape (no field present, treat as ``'system_level'``). */
  result_type?: 'system_level'
}

export interface ScenarioProjectedResult {
  scenario: ProspectiveScenarioRef
  result: ImpactAssessmentResult
}

export interface MultiScenarioProjectedImpactResult {
  result_type: 'multi_scenario_projected'
  task_id: string
  meta: ImpactAssessmentMeta
  scenarios: ScenarioProjectedResult[]
  elapsed_seconds?: number | null
}

export type ImpactResultEnvelope =
  | ImpactAssessmentResult
  | MultiScenarioProjectedImpactResult

export function isMultiScenarioProjected(
  r: ImpactResultEnvelope,
): r is MultiScenarioProjectedImpactResult {
  return (r as MultiScenarioProjectedImpactResult).result_type === 'multi_scenario_projected'
}

export interface ParamScenarioImpactResult {
  scenario: string
  result: ImpactAssessmentResult
}

/** Frontend-assembled envelope for multi-parameter Excel export. Mirrors the
 *  multi-LCI envelope shape but without a backend ``task_id`` — multi-param
 *  fan-out runs as N parallel single-scenario tasks under
 *  ``/impact/calculate-scenarios``, so the envelope is built client-side from
 *  the per-scenario task results. The backend reads the active project's
 *  parameter table to populate the index sheet's varying-parameters columns. */
export interface MultiParamImpactResult {
  result_type: 'multi_param'
  meta: ImpactAssessmentMeta
  scenarios: ParamScenarioImpactResult[]
  elapsed_seconds?: number | null
}

export interface DSMScenarioImpactResult {
  scenario_id: string
  scenario_name: string
  result: ImpactAssessmentResult
}

/** Frontend-assembled envelope for multi-DSM-scenario fan-out (Patch 2E.2).
 *  Topology mirrors ``MultiParamImpactResult``: N parallel single-scenario
 *  tasks under ``/impact/calculate-scenarios`` (DSM branch), envelope built
 *  client-side from per-task results. ``scenario_name`` is echoed at fan-out
 *  time so the envelope is self-contained for downstream consumers. */
export interface MultiDSMImpactResult {
  result_type: 'multi_dsm'
  meta: ImpactAssessmentMeta
  scenarios: DSMScenarioImpactResult[]
  elapsed_seconds?: number | null
}

export function isMultiDSM(
  r: { result_type?: string } | null | undefined,
): r is MultiDSMImpactResult {
  return !!r && (r as MultiDSMImpactResult).result_type === 'multi_dsm'
}

/** Patch 2F — Paired DSM × LCI scenario co-variation.
 *
 * One pair = one DSM scenario id matched 1:1 with one prospective LCI ref.
 * The pair list defines N paired runs that produce one task each (parallel
 * to multi-DSM topology, NOT a Cartesian product). */
export interface PairedDSMLCIRef {
  dsm_scenario_id: string
  lci_scenario: ProspectiveScenarioRef
}

export interface PairedScenarioImpactResult {
  dsm_scenario_id: string
  dsm_scenario_name: string
  lci_scenario: ProspectiveScenarioRef
  /** Pre-computed verbose label echoed at fan-out time, keeps the envelope
   *  self-contained for the Excel builder and Comparison tab consumers. */
  lci_scenario_label: string
  result: ImpactAssessmentResult
}

/** Frontend-assembled envelope for paired DSM×LCI fan-out. Topology mirrors
 *  ``MultiDSMImpactResult`` / ``MultiParamImpactResult``: N parallel single-
 *  scenario tasks under ``/impact/calculate-scenarios`` (paired branch),
 *  envelope built client-side from per-task results. */
export interface MultiPairedImpactResult {
  result_type: 'multi_paired_dsm_lci'
  meta: ImpactAssessmentMeta
  scenarios: PairedScenarioImpactResult[]
  elapsed_seconds?: number | null
}

export function isMultiPaired(
  r: { result_type?: string } | null | undefined,
): r is MultiPairedImpactResult {
  return !!r && (r as MultiPairedImpactResult).result_type === 'multi_paired_dsm_lci'
}

/** Deterministic pair key used as response dict key and as the pair's
 *  identity in the frontend store. Format mirrors the backend orchestrator
 *  exactly so frontend lookups match server-issued task_id keys. */
export function pairKey(p: PairedDSMLCIRef): string {
  const { dsm_scenario_id, lci_scenario: r } = p
  return `${dsm_scenario_id}::${r.base_db}::${r.iam}::${r.ssp}`
}

/** Short, repeated-use label for chart legends and discriminator columns.
 *  Format: ``<dsm_name> × <iam>/<ssp>`` (drops base_db). */
export function pairedShortLabel(
  dsmName: string, ref: ProspectiveScenarioRef,
): string {
  return `${dsmName} × ${ref.iam}/${ref.ssp}`
}

/** Verbose label for tooltips and the index sheet.
 *  Format: ``<dsm_name> stock × <base_db>/<iam>/<ssp>``. */
export function pairedFullLabel(
  dsmName: string, ref: ProspectiveScenarioRef,
): string {
  return `${dsmName} stock × ${ref.base_db}/${ref.iam}/${ref.ssp}`
}

export interface ImpactProgressMessage {
  type: 'progress' | 'done' | 'error' | 'cancelled'
  stage?: string
  pct?: number
  methods_calculated?: number
  year_to_database?: Record<number, string>
  elapsed_seconds?: number
  error?: string
  task_id?: string
  /** Multi-scenario done frames carry this discriminator + count. */
  result_type?: 'multi_scenario_projected'
  scenarios_calculated?: number
}

export interface ImpactComparePoint {
  year: number
  static_impact: number
  projected_impact: number
  delta: number
  delta_pct: number | null
}

export interface ImpactCompareMethodResult {
  method: string[]
  method_label: string
  unit: string
  points: ImpactComparePoint[]
  total_static: number
  total_projected: number
  total_delta: number
  total_delta_pct: number | null
}

export interface ImpactCompareResult {
  mfa_system_id: string
  scope: string
  methods: ImpactCompareMethodResult[]
}

export async function startImpactCalculation(body: ImpactAssessmentRequest): Promise<{ task_id: string }> {
  const res = await fetch(`${API_BASE}/impact/calculate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`POST /impact/calculate failed: ${res.status} ${detail}`)
  }
  return res.json()
}

/** Launch one impact task per scenario. The backend returns
 *  ``{scenarios: {scenario_name: task_id}}``; poll each task via
 *  ``getImpactResults`` and assemble the multi-scenario view client-side. */
export async function startImpactScenarios(
  body: ImpactAssessmentRequest,
): Promise<{ scenarios: Record<string, string> }> {
  const res = await fetch(`${API_BASE}/impact/calculate-scenarios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`POST /impact/calculate-scenarios failed: ${res.status} ${detail}`)
  }
  return res.json()
}

export async function getImpactResults(taskId: string): Promise<ImpactResultEnvelope> {
  const res = await fetch(`${API_BASE}/impact/results/${encodeURIComponent(taskId)}`)
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`GET /impact/results failed: ${res.status} ${detail}`)
  }
  return res.json()
}

export async function compareImpact(
  staticTaskId: string,
  projectedTaskId: string,
): Promise<ImpactCompareResult> {
  const res = await fetch(`${API_BASE}/impact/compare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ static_task_id: staticTaskId, projected_task_id: projectedTaskId }),
  })
  if (!res.ok) throw new Error(`POST /impact/compare failed: ${res.status}`)
  return res.json()
}

export interface ImpactExportBody {
  task_id?: string | null
  result?: ImpactAssessmentResult | null
  /** When set, the backend routes the export through the multi-scenario
   *  builder (LCI Scenario column on every data sheet). */
  multi_result?: MultiScenarioProjectedImpactResult | null
  /** When set, the backend routes through ``_build_multi_param_workbook``
   *  (Sensitivity case column on every data sheet, Parameter Scenarios
   *  index). Mutually exclusive with ``multi_result``. */
  multi_param_result?: MultiParamImpactResult | null
  /** When set, routes through ``_build_multi_dsm_workbook`` (DSM scenario
   *  column on every data sheet). Builder ships in Patch 2E.3; until then
   *  the backend route 501s on a lone ``multi_dsm_result``. Mutually
   *  exclusive with ``multi_result`` and ``multi_param_result``. */
  multi_dsm_result?: MultiDSMImpactResult | null
  /** Patch 2F — paired DSM × LCI envelope. Routes through
   *  ``_build_multi_paired_workbook`` (Pair column on every data sheet).
   *  Mutually exclusive with all other multi-axis envelopes. */
  multi_paired_result?: MultiPairedImpactResult | null
  year?: number | null
  compare_task_id?: string | null
  compare_result?: ImpactAssessmentResult | null
}

export async function exportImpact(body: ImpactExportBody, filename: string): Promise<void> {
  const res = await fetch(`${API_BASE}/impact/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST /impact/export failed: ${res.status} ${await res.text()}`)
  // Prefer server-generated filename from Content-Disposition
  const cd = res.headers.get('Content-Disposition')
  const serverName = cd?.match(/filename="?([^"]+)"?/)?.[1]
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = serverName || filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Patch 4G — Single-product Impact Assessment exports. Three sibling
// endpoints, one per sub-tab. Each returns a binary xlsx with a
// server-generated filename in Content-Disposition.

export interface SingleProductStaticScenarioPayload {
  label: string
  result: ArchetypeLCACalculateResult
}
export interface SingleProductProspectiveRunPayload {
  db_name: string
  year: number | null
  iam: string
  ssp: string
  result: ArchetypeLCACalculateResult
}

async function _downloadXlsx(url: string, body: unknown, fallbackName: string): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${url} failed: ${res.status} ${await res.text()}`)
  const cd = res.headers.get('Content-Disposition')
  const serverName = cd?.match(/filename="?([^"]+)"?/)?.[1]
  const blob = await res.blob()
  const blobUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = serverName || fallbackName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(blobUrl)
}

// Patch 5K+ — stage-amount provenance (preset + lifetime + resolved amounts),
// reusing 5J's shape. Single archetype → a single instance (not a dict like
// the multi-item export). Threaded into the single-product export requests so
// the Configuration block can record preset/lifetime alongside the amounts.
export interface StageAmountsMeta {
  preset: string
  lifetime: number
  amounts: Record<string, number>
}

export async function exportSingleProductStatic(
  archetypeName: string,
  scope: string,
  scenarios: SingleProductStaticScenarioPayload[],
  stageAmountsMeta?: StageAmountsMeta,
): Promise<void> {
  await _downloadXlsx(
    `${API_BASE}/impact/export-single-product-static`,
    { archetype_name: archetypeName, scope, scenarios, stage_amounts_meta: stageAmountsMeta ?? null },
    `MApper_Impact_SingleProduct_Static_${archetypeName}.xlsx`,
  )
}

export async function exportSingleProductProspective(
  archetypeName: string,
  scope: string,
  runs: SingleProductProspectiveRunPayload[],
  stageAmountsMeta?: StageAmountsMeta,
): Promise<void> {
  await _downloadXlsx(
    `${API_BASE}/impact/export-single-product-prospective`,
    { archetype_name: archetypeName, scope, runs, stage_amounts_meta: stageAmountsMeta ?? null },
    `MApper_Impact_SingleProduct_Prospective_${archetypeName}.xlsx`,
  )
}

export async function exportSingleProductComparison(
  archetypeName: string,
  scope: string,
  staticResult: ArchetypeLCACalculateResult,
  projectedRuns: SingleProductProspectiveRunPayload[],
  stageAmountsMeta?: StageAmountsMeta,
): Promise<void> {
  await _downloadXlsx(
    `${API_BASE}/impact/export-single-product-comparison`,
    {
      archetype_name: archetypeName,
      scope,
      static_result: staticResult,
      projected_runs: projectedRuns,
      stage_amounts_meta: stageAmountsMeta ?? null,
    },
    `MApper_Impact_SingleProduct_Comparison_${archetypeName}.xlsx`,
  )
}

export function connectToImpactTask(
  taskId: string,
  onMessage: (data: ImpactProgressMessage) => void,
  onError?: (e: Event) => void,
): WebSocket {
  const ws = new WebSocket(`${WS_BASE}/impact/ws/${encodeURIComponent(taskId)}`)
  ws.onmessage = (e) => {
    try {
      onMessage(JSON.parse(e.data))
    } catch { /* ignore malformed */ }
  }
  if (onError) ws.onerror = onError
  return ws
}

// ── Parameter System ─────────────────────────────────────────────────────────

/** New schema: parameter row with Base value + per-scenario overrides. The
 *  ``value`` field is a read-only convenience alias for ``base_value`` kept so
 *  older UI code (BOMTree, DependencyRulesEditor) can keep using ``p.value``
 *  during the scenarios rollout. */
export interface Parameter {
  name: string
  base_value: number
  value?: number // alias for base_value (back-compat)
  unit?: string | null
  description?: string | null
  category?: string | null
  scenario_overrides?: Record<string, number>
}

export interface ParameterTable {
  parameters: Record<string, Parameter>
  scenarios: string[]
  categories: string[]
  created_at?: string | null
  updated_at?: string | null
}

export const BASE_SCENARIO = 'Base'

/** Resolve a single parameter's value under ``scenario`` (empty cell =
 *  inherit from base). Falls back to ``base_value`` for unknown scenarios. */
export function resolveParameterValue(p: Parameter, scenario: string | null): number {
  if (!scenario || scenario === BASE_SCENARIO) return p.base_value
  const ov = p.scenario_overrides?.[scenario]
  if (ov === undefined || ov === null) return p.base_value
  return ov
}

export interface ScenarioCreatePayload {
  name: string
  copy_from?: string | null
}

export interface ScenarioRenamePayload {
  old_name: string
  new_name: string
}

// ── Legacy types, preserved for callers still reading ``ParameterSet`` ──

export interface ParameterSet {
  id?: string | null
  name: string
  parameters: Parameter[]
  created_at?: string | null
  updated_at?: string | null
}

export interface ParameterSetSummary {
  id: string
  name: string
  parameter_count: number
  categories: string[]
  created_at: string
  updated_at: string
}

export interface ResolveResult {
  expression: string
  value: number | null
  error: string | null
  references: string[]
}

export interface ValidateResult {
  results: ResolveResult[]
}

// ── New ParameterTable API ──────────────────────────────────────────────────

export async function getParameterTable(): Promise<ParameterTable> {
  return request<ParameterTable>('/parameters/table')
}

export async function updateParameterTable(body: {
  parameters?: Record<string, Parameter> | null
  scenarios?: string[] | null
  categories?: string[] | null
}): Promise<ParameterTable> {
  return request<ParameterTable>('/parameters/table', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function createScenario(
  body: ScenarioCreatePayload,
): Promise<ParameterTable> {
  return request<ParameterTable>('/parameters/table/scenarios', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function deleteScenario(name: string): Promise<ParameterTable> {
  return request<ParameterTable>(
    `/parameters/table/scenarios/${encodeURIComponent(name)}`,
    { method: 'DELETE' },
  )
}

export async function renameScenario(
  body: ScenarioRenamePayload,
): Promise<ParameterTable> {
  return request<ParameterTable>('/parameters/table/scenarios', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function exportParameterTable(): Promise<void> {
  const res = await fetch(`${API_BASE}/parameters/export`)
  if (!res.ok) throw new Error(await res.text())
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'parameters.xlsx'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function importParameterTable(
  file: File,
  mode: 'replace' | 'merge' = 'replace',
): Promise<ParameterTable> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API_BASE}/parameters/import?mode=${mode}`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ── Legacy ParameterSet API (kept for back-compat) ─────────────────────────

export async function listParameterSets(): Promise<ParameterSetSummary[]> {
  return request<ParameterSetSummary[]>('/parameters/sets')
}

export async function getParameterSet(setId: string): Promise<ParameterSet> {
  return request<ParameterSet>(`/parameters/sets/${encodeURIComponent(setId)}`)
}

export async function createParameterSet(body: {
  name: string; parameters: Parameter[]
}): Promise<ParameterSet> {
  return request<ParameterSet>('/parameters/sets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function updateParameterSet(
  setId: string,
  body: { name?: string | null; parameters?: Parameter[] | null },
): Promise<ParameterSet> {
  return request<ParameterSet>(`/parameters/sets/${encodeURIComponent(setId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function deleteParameterSet(setId: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(
    `/parameters/sets/${encodeURIComponent(setId)}`,
    { method: 'DELETE' },
  )
}

export async function duplicateParameterSet(
  setId: string,
  newName?: string | null,
): Promise<ParameterSet> {
  const q = newName ? `?new_name=${encodeURIComponent(newName)}` : ''
  return request<ParameterSet>(
    `/parameters/sets/${encodeURIComponent(setId)}/duplicate${q}`,
    { method: 'POST' },
  )
}

export async function resolveExpression(
  expression: string,
  parameterSetId?: string | null,
): Promise<ResolveResult> {
  return request<ResolveResult>('/parameters/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expression, parameter_set_id: parameterSetId ?? null }),
  })
}

export async function validateExpressions(
  expressions: string[],
  parameterSetId?: string | null,
): Promise<ValidateResult> {
  return request<ValidateResult>('/parameters/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expressions, parameter_set_id: parameterSetId ?? null }),
  })
}

export async function downloadParameterTemplate(): Promise<void> {
  const res = await fetch(`${API_BASE}/parameters/template`)
  if (!res.ok) throw new Error(await res.text())
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'parameters_template.xlsx'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function exportParameterSet(setId: string, name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/parameters/sets/${encodeURIComponent(setId)}/export`)
  if (!res.ok) throw new Error(await res.text())
  const blob = await res.blob()
  const safe = (name || 'parameters').replace(/[^A-Za-z0-9._-]+/g, '_')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safe}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function importParameterSet(
  file: File,
  opts?: { name?: string | null; replaceSetId?: string | null },
): Promise<ParameterSet> {
  const params = new URLSearchParams()
  if (opts?.name) params.set('name', opts.name)
  if (opts?.replaceSetId) params.set('replace_set_id', opts.replaceSetId)
  const form = new FormData()
  form.append('file', file)
  const qs = params.toString() ? `?${params}` : ''
  const res = await fetch(`${API_BASE}/parameters/sets/import${qs}`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ── Phase 2B: AESA — Multi-D allocation model (Ferhati et al., SETAC 36th) ───

export type SharingPrincipleId = 'EpC' | 'IN' | 'AGR' | 'LA' | 'AR'
export type PBBoundaryType = 'cumulative' | 'flow'
export type PBStatus2023 = 'safe' | 'exceeded' | 'increasing_risk' | 'regional'
export type AESAZone = 'safe' | 'zone_of_uncertainty' | 'high_risk'

export interface PlanetaryBoundary {
  id: string
  name: string
  control_variable: string
  ef_indicator: string
  pb_value: number
  unit: string
  zone_of_uncertainty: [number, number]
  boundary_type: PBBoundaryType
  status_2023: PBStatus2023
  provisional?: boolean
}

export interface BoundarySet {
  id: string
  name: string
  source: string
  boundaries: Record<string, PlanetaryBoundary>
}

export interface SharingPrincipleConfig {
  principle: SharingPrincipleId
  justification: string
  system_value: number
  global_value: number
  system_time_series?: Record<number, number> | null
  global_time_series?: Record<number, number> | null
}

export interface MultiDConfig {
  layer1: Record<string, SharingPrincipleConfig>
  layer2_sector_share: number
  layer2_source: string
}

// ── N-layer downscaling chain + presets ─────────────────────────────────────

export type PrincipleMode = 'category_specific' | 'fixed'

export interface PrincipleDefinition {
  id: string
  name: string
  description?: string
}

export interface CategoryAssignment {
  pb_id: string
  principle_id: string
  justification?: string
}

/** Layer data: principle_id → year → [system_value, global_value]. */
export type LayerData = Record<string, Record<number, [number, number]>>

export interface DownscalingLayer {
  layer_number: number
  name: string
  principle_mode: PrincipleMode
  fixed_principle?: string | null
  description?: string
  data: LayerData
}

export interface DownscalingChain {
  layers: DownscalingLayer[]
}

export interface SharingPreset {
  id: string
  name: string
  description?: string
  built_in: boolean
  principles: PrincipleDefinition[]
  category_assignments: CategoryAssignment[]
  chain: DownscalingChain
  created_at?: string
  updated_at?: string
}

export interface SharingPresetCreate {
  name: string
  description?: string
  principles: PrincipleDefinition[]
  category_assignments: CategoryAssignment[]
  chain: DownscalingChain
}

export interface CarbonBudgetConfig {
  initial_budget_gt: number
  budget_source: string
  start_year: number
  end_year: number
  projected_emissions: Record<number, number>
  ssp_scenario: string
  provisional?: boolean
}

export interface MethodPBMapping {
  method_tuple: string[]
  pb_id: string
  conversion_factor?: number
}

export interface AESAConfiguration {
  id: string
  name: string
  mfa_system_id: string
  /**
   * Patch 4O — explicit DSM scenario id. ``null`` means "use whatever's
   * active when this config is loaded" (backward-compat default for
   * pre-Patch-4O configs).
   */
  dsm_scenario_id?: string | null
  impact_mode: 'static' | 'projected'
  boundary_set_id: string
  /** Legacy 2-layer config. Optional since the N-layer refactor. */
  multi_d?: MultiDConfig | null
  /** Inline preset snapshot (principles + assignments + chain). Preferred. */
  sharing?: SharingPreset | null
  /** Bookmark to the global preset this config was cloned from (UI only). */
  sharing_preset_id?: string | null
  carbon_budget: CarbonBudgetConfig | null
  method_mapping: MethodPBMapping[]
  created_at: string
}

export interface AESAConfigurationCreate {
  name: string
  mfa_system_id: string
  dsm_scenario_id?: string | null
  impact_mode?: 'static' | 'projected'
  boundary_set_id?: string
  multi_d?: MultiDConfig | null
  sharing?: SharingPreset | null
  sharing_preset_id?: string | null
  carbon_budget?: CarbonBudgetConfig | null
  method_mapping?: MethodPBMapping[]
}

export interface SustainabilityRatioResult {
  year: number
  pb_id: string
  pb_name: string
  ef_indicator: string
  impact: number
  allocated_sos: number
  /** null when allocated SOS is 0 (e.g. carbon budget depleted). Treat as +∞; zone will be 'high_risk'. */
  sr: number | null
  zone: AESAZone
  /** Principle chosen at the (first) category_specific layer; null if none. */
  sharing_principle: string | null
  /** One factor per chain layer, in order. */
  layer_factors: number[]
  total_sharing_factor: number
  /** Legacy: layer_factors[0] and product-of-rest (kept for older readers). */
  sharing_factor_l1: number
  sharing_factor_l2: number
  boundary_type: PBBoundaryType
  confidence: 'high' | 'medium' | 'low'
  unit: string
  impact_by_cohort: Record<string, number>
  method_label: string
}

export interface AESAYearSummary {
  year: number
  safe: number
  zone_of_uncertainty: number
  high_risk: number
  total_assessed: number
}

export interface AESAComputeResult {
  config_id: string | null
  results: SustainabilityRatioResult[]
  summary_by_year: AESAYearSummary[]
  missing_categories: string[]
  sensitivity?: Partial<Record<SharingPrincipleId, SustainabilityRatioResult[]>> | null
  compute_metrics?: ComputeMetrics | null
}

export interface MultiDDefault {
  pb_id: string
  principle: SharingPrincipleId
  justification: string
}

export interface SharingDataLayer1 {
  description: string
  system_value: number
  global_value: number
  unit?: string
  source: string
  provisional?: boolean
}

export interface SharingData {
  entity: string
  sector: string
  year_base: number
  layer1_defaults: Record<SharingPrincipleId, SharingDataLayer1>
  layer2: { sector_share: number; source: string; provisional?: boolean }
}

export interface SSPTrajectory {
  id: string
  name: string
  source: string
  anchors_gt_co2: Record<string, number>
  projected_emissions: Record<number, number>
  provisional?: boolean
}

export interface CarbonBudgetOption {
  id: string
  name: string
  remaining_gt_from_2025: number
  source: string
  provisional?: boolean
}

export interface AESADefaultsBundle {
  boundary_sets: BoundarySet[]
  multi_d_defaults: MultiDDefault[]
  sharing_data: SharingData
  ssp_trajectories: SSPTrajectory[]
  carbon_budget_options: CarbonBudgetOption[]
  default_multi_d: MultiDConfig
  default_carbon_budget: CarbonBudgetConfig
}

async function _aesaJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init)
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} failed: ${res.status} ${await res.text()}`)
  return res.json()
}

export async function getAESADefaults(): Promise<AESADefaultsBundle> {
  return _aesaJson('/aesa/defaults')
}

export async function getBoundarySets(): Promise<BoundarySet[]> {
  return _aesaJson('/aesa/boundary-sets')
}

export async function suggestAESAMethodMapping(
  methods: string[][], boundarySetId = 'Sala2020_EF',
): Promise<MethodPBMapping[]> {
  return _aesaJson('/aesa/method-mapping/suggest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ methods, boundary_set_id: boundarySetId }),
  })
}

export async function getAESAConfigurations(): Promise<AESAConfiguration[]> {
  return _aesaJson('/aesa/configurations')
}

export async function createAESAConfiguration(body: AESAConfigurationCreate): Promise<AESAConfiguration> {
  return _aesaJson('/aesa/configurations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function updateAESAConfiguration(id: string, body: AESAConfigurationCreate): Promise<AESAConfiguration> {
  return _aesaJson(`/aesa/configurations/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function deleteAESAConfiguration(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/aesa/configurations/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`DELETE /aesa/configurations failed: ${res.status}`)
}

// ── Saved sessions (Patch 4R) ──────────────────────────────────────────────
//
// Sessions are immutable historical records of one AESA compute event:
// configuration snapshot at compute time + the result that came out +
// a traceability reference to the upstream Impact Assessment task.
// Distinct from `AESAConfiguration` (reusable input templates).

export interface AESASession {
  id: string
  name: string
  project: string
  created_at: string
  modified_at: string
  configuration_snapshot: AESAConfiguration
  result: AESAComputeResult
  upstream_ia_task_id: string | null
  // Patch 4T — saved display filter. ``null`` = "show all"; an
  // explicit list narrows the radar / timeline / box-plot /
  // detail-table render on session reload. Optional on read because
  // sessions saved before Patch 4T don't carry the field.
  displayed_indicators?: string[] | null
}

export interface AESASessionCreate {
  name: string
  configuration_snapshot: AESAConfiguration
  result: AESAComputeResult
  upstream_ia_task_id?: string | null
  displayed_indicators?: string[] | null
}

export async function getAESASessions(): Promise<AESASession[]> {
  return _aesaJson<AESASession[]>('/aesa/sessions')
}

export async function getAESASession(id: string): Promise<AESASession> {
  return _aesaJson<AESASession>(`/aesa/sessions/${encodeURIComponent(id)}`)
}

export async function createAESASession(body: AESASessionCreate): Promise<AESASession> {
  return _aesaJson<AESASession>('/aesa/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function renameAESASession(id: string, name: string): Promise<AESASession> {
  return _aesaJson<AESASession>(`/aesa/sessions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export async function deleteAESASession(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/aesa/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`DELETE /aesa/sessions failed: ${res.status}`)
}

export interface AESAComputeBody {
  config_id?: string | null
  config?: AESAConfiguration | null
  impact_task_id?: string | null
  impact_result?: ImpactAssessmentResult | null
  run_sensitivity?: boolean
}

export async function computeAESA(body: AESAComputeBody): Promise<AESAComputeResult> {
  const res = await _aesaJson<AESAComputeResult>('/aesa/compute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  recordComputation({
    module: 'AESA',
    description: body.run_sensitivity ? 'Compute + sensitivity' : 'Compute',
    metrics: res.compute_metrics,
  })
  return res
}

export async function exportAESA(
  config: AESAConfiguration,
  result: AESAComputeResult,
  filename: string,
  displayedIndicators?: string[] | null,
): Promise<void> {
  // Patch 4T — when `displayedIndicators` is provided, subset the
  // result CLIENT-SIDE before posting. Filtering on the wire keeps
  // the backend export route untouched and makes the export shape
  // identical to the rendered chart shape (no possibility of drift
  // between "what the chart shows" and "what the spreadsheet
  // contains"). Sensitivity arrays are subset to the same id set so
  // box-plot exports stay coherent. ``null`` / undefined sends the
  // unfiltered result — used by the explicit "Export all computed
  // indicators" override.
  let payloadResult = result
  if (displayedIndicators && displayedIndicators.length < (result.results.length || 0)) {
    const allow = new Set(displayedIndicators)
    const filteredResults = result.results.filter((r) => allow.has(r.pb_id))
    let filteredSensitivity: AESAComputeResult['sensitivity'] = null
    if (result.sensitivity) {
      filteredSensitivity = {}
      for (const [k, arr] of Object.entries(result.sensitivity)) {
        filteredSensitivity[k as keyof typeof filteredSensitivity] = arr.filter((r) => allow.has(r.pb_id))
      }
    }
    // Recompute year summaries from the filtered set so zone counts
    // reflect only the displayed indicators.
    const summaryMap = new Map<number, {
      year: number; safe: number; zone_of_uncertainty: number;
      high_risk: number; total_assessed: number;
    }>()
    for (const r of filteredResults) {
      const cur = summaryMap.get(r.year) ?? {
        year: r.year, safe: 0, zone_of_uncertainty: 0, high_risk: 0, total_assessed: 0,
      }
      cur.total_assessed += 1
      if (r.zone === 'safe') cur.safe += 1
      else if (r.zone === 'zone_of_uncertainty') cur.zone_of_uncertainty += 1
      else if (r.zone === 'high_risk') cur.high_risk += 1
      summaryMap.set(r.year, cur)
    }
    const filteredSummary = Array.from(summaryMap.values()).sort((a, b) => a.year - b.year)
    payloadResult = {
      ...result,
      results: filteredResults,
      summary_by_year: filteredSummary,
      sensitivity: filteredSensitivity,
    }
  }
  const res = await fetch(`${API_BASE}/aesa/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config, result: payloadResult }),
  })
  if (!res.ok) throw new Error(`POST /aesa/export failed: ${res.status} ${await res.text()}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Sharing preset management (N-layer downscaling) ──────────────────────────

export async function getSharingPresets(): Promise<SharingPreset[]> {
  return _aesaJson('/aesa/sharing-presets')
}

export async function getSharingPreset(id: string): Promise<SharingPreset> {
  return _aesaJson(`/aesa/sharing-presets/${encodeURIComponent(id)}`)
}

export async function createSharingPreset(body: SharingPresetCreate): Promise<SharingPreset> {
  return _aesaJson('/aesa/sharing-presets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function updateSharingPreset(id: string, body: SharingPresetCreate): Promise<SharingPreset> {
  return _aesaJson(`/aesa/sharing-presets/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function deleteSharingPreset(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/aesa/sharing-presets/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`DELETE sharing-preset failed: ${res.status} ${await res.text()}`)
}

export async function duplicateSharingPreset(id: string, name?: string): Promise<SharingPreset> {
  return _aesaJson(`/aesa/sharing-presets/${encodeURIComponent(id)}/duplicate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(name ? { name } : {}),
  })
}

export async function getDownscalingChain(presetId: string): Promise<DownscalingChain> {
  return _aesaJson(`/aesa/downscaling-chain/${encodeURIComponent(presetId)}`)
}

export async function putDownscalingChain(presetId: string, chain: DownscalingChain): Promise<SharingPreset> {
  return _aesaJson(`/aesa/downscaling-chain/${encodeURIComponent(presetId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(chain),
  })
}

async function _downloadBlob(path: string, filename: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function downloadSharingTemplate(filename = 'sharing_template.xlsx'): Promise<void> {
  return _downloadBlob('/aesa/sharing/template', filename)
}

export async function exportSharingPreset(presetId: string, filename: string): Promise<void> {
  return _downloadBlob(`/aesa/sharing/export/${encodeURIComponent(presetId)}`, filename)
}

export async function importSharingPreset(file: File, name?: string): Promise<SharingPreset> {
  const form = new FormData()
  form.append('file', file)
  const qs = name ? `?name=${encodeURIComponent(name)}` : ''
  const res = await fetch(`${API_BASE}/aesa/sharing/import${qs}`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`import sharing preset failed: ${res.status} ${await res.text()}`)
  return res.json()
}

// ── System logs ──────────────────────────────────────────────────────────────

export interface SystemLogsResponse {
  lines: string[]
  total: number
  log_path: string
}

export async function getSystemLogs(
  lines = 200,
  level?: string,
): Promise<SystemLogsResponse> {
  const params = new URLSearchParams({ lines: String(lines) })
  if (level) params.set('level', level)
  return request<SystemLogsResponse>(`/system/logs?${params.toString()}`)
}

export interface ComputeMetrics {
  wall_time_seconds: number
  cpu_time_seconds: number
  estimated_energy_wh: number
  estimated_co2_g: number
  tdp_watts: number
  grid_intensity_g_per_kwh: number
}

export interface GridCountry {
  code: string
  name: string
  intensity: number
  year: number
  source: string
}

export interface GridIntensityResponse {
  countries: GridCountry[]
  eu_average: GridCountry
  world_average: GridCountry
  notes: string
}

export async function getGridIntensities(): Promise<GridIntensityResponse> {
  return request<GridIntensityResponse>('/system/grid-intensities')
}

export async function downloadSystemLogs(): Promise<void> {
  const res = await fetch(`${API_BASE}/system/logs/export`)
  if (!res.ok) throw new Error(await res.text())
  const stamp = new Date().toISOString().slice(0, 10)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `mapper_logs_${stamp}.txt`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── LCIA Method Library ──────────────────────────────────────────────────────

export interface LCIAMethodInfo {
  id: string
  name: string
  description: string
  long_description: string | null
  source: 'bundled' | 'downloadable' | 'custom'
  installed: boolean
  category_count: number | null
  size_mb: number | null
  source_url: string | null
  citation: string | null
  installer: string | null
  notes: string | null
  detected_ei_version: string | null
  available_variants: string[] | null
  unit: string | null
}

export interface LCIALibraryResponse {
  detected_ecoinvent_version: string | null
  supported_ecoinvent_versions: string[]
  methods: LCIAMethodInfo[]
}

export interface LCIAInstallTask {
  task_id: string
  method_id: string
}

export type LCIAInstallMessage =
  | { type: 'progress'; stage: string; pct: number }
  | { type: 'done'; method_tuples: string[][]; warnings: string[] }
  | { type: 'error'; error: string }
  | { type: 'cancelled'; task_id: string }

export async function getLcaMethodLibrary(): Promise<LCIALibraryResponse> {
  return request<LCIALibraryResponse>('/impact/methods/library')
}

export async function installLcaMethod(
  method_id: string,
  ecoinvent_version?: string,
): Promise<LCIAInstallTask> {
  return request<LCIAInstallTask>('/impact/methods/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method_id, ecoinvent_version: ecoinvent_version ?? null }),
  })
}

export async function uploadCustomLcaMethod(
  file: File,
  name_tuple: string[],
  description: string,
  unit: string,
): Promise<LCIAInstallTask> {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('name_tuple', JSON.stringify(name_tuple))
  fd.append('description', description)
  fd.append('unit', unit)
  const res = await fetch(`${API_BASE}/impact/methods/install-custom`, {
    method: 'POST',
    body: fd,
  })
  if (!res.ok) {
    let detail: string
    try { detail = (await res.json()).detail ?? (await res.text()) } catch { detail = await res.text() }
    throw new Error(detail || `POST /impact/methods/install-custom failed: ${res.status}`)
  }
  return res.json()
}

export async function uninstallLcaMethod(method_id: string): Promise<{ method_id: string; tuples_removed: number }> {
  const res = await fetch(`${API_BASE}/impact/methods/${encodeURIComponent(method_id)}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export function connectToLcaInstallTask(
  taskId: string,
  onMessage: (data: LCIAInstallMessage) => void,
  onError?: (e: Event) => void,
): WebSocket {
  const ws = new WebSocket(`${WS_BASE}/impact/methods/ws/${encodeURIComponent(taskId)}`)
  ws.onmessage = (e) => {
    try { onMessage(JSON.parse(e.data)) } catch { /* ignore malformed */ }
  }
  if (onError) ws.onerror = onError
  return ws
}
