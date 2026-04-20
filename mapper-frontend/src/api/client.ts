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
    year?: number
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
}

// ── Phase 2A: MFA ─────────────────────────────────────────────────────────────

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

export interface MFASystemState {
  system_id: string
  survival_configs: SurvivalConfig[]
  initial_stock: Record<string, number>
  inflows: InflowData[]
}

export interface YearResult {
  year: number
  stock: Record<string, number>
  stock_by_age: Record<string, Record<string, number>>
  inflow: Record<string, number>
  outflow: Record<string, number>
  outflow_by_age: Record<string, Record<string, number>>
}

export interface SimulationSummary {
  total_stock_start: number
  total_stock_end: number
  total_inflows: number
  total_outflows: number
}

export interface SimulationResult {
  system_id: string
  years: YearResult[]
  summary: SimulationSummary
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

export interface SurvivalPreviewPoint {
  age: number
  survival_rate: number
  hazard_rate: number
}

// ── Phase 2B: BOM / Archetype / MFA × LCA ────────────────────────────────────

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
  unit: string
  is_annual?: boolean
  children?: BOMNode[] | null
  ecoinvent_activity?: EcoinventLink | null
  evolution?: MaterialEvolution | null
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
}

export interface CohortMappingResult {
  mapped_cohorts: number
  unmapped_cohorts: string[]
  invalid_cohorts: string[]
  invalid_archetypes: string[]
}

export interface MFALCAYearResult {
  year: number
  total_impact: number
  impact_by_cohort: Record<string, number>
  impact_by_material: Record<string, number>
  count_by_cohort?: Record<string, number>
  unit: string
}

export interface MFALCASummary {
  total_impact: number
  peak_year: number
  peak_impact: number
}

export interface MFALCAResult {
  mfa_system_id: string
  method: string[]
  method_label?: string
  scope: 'inflows' | 'outflows' | 'stock' | 'all'
  unit: string
  years: MFALCAYearResult[]
  summary: MFALCASummary
  stages_included?: string[]
}

export interface MFALCABatchResult {
  results: MFALCAResult[]
  methods_calculated: number
  year_start?: number | null
  year_end?: number | null
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options)
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(detail || `HTTP ${res.status}`)
  }
  return res.json()
}

async function uploadFile<T>(path: string, file: File): Promise<T> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', body: form })
  if (!res.ok) {
    const detail = await res.text()
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
}

export async function calculateArchetypeLCA(
  archetypeId: string,
  scope: string,
  methods: string[][],
  stageAmounts?: Record<string, number>,
  amount?: number,
): Promise<ArchetypeLCACalculateResult> {
  return request<ArchetypeLCACalculateResult>('/lca/calculate-archetype', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      archetype_id: archetypeId,
      scope,
      amount: amount ?? 1,
      stage_amounts: stageAmounts ?? null,
      methods,
    }),
  })
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

// ── MFA endpoints ────────────────────────────────────────────────────────────

export async function createMFASystem(def: Omit<SystemDefinition, 'id' | 'created_at'>): Promise<SystemDefinition> {
  return request<SystemDefinition>('/mfa/systems', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(def),
  })
}

export async function listMFASystems(): Promise<SystemSummary[]> {
  return request<SystemSummary[]>('/mfa/systems')
}

export async function getMFASystem(id: string): Promise<SystemDefinition> {
  return request<SystemDefinition>(`/mfa/systems/${id}`)
}

export interface SystemUpdateResponse {
  system: SystemDefinition
  warnings: string[]
}

export async function updateMFASystem(id: string, def: SystemDefinition): Promise<SystemUpdateResponse> {
  return request<SystemUpdateResponse>(`/mfa/systems/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(def),
  })
}

export async function deleteMFASystem(id: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/mfa/systems/${id}`, { method: 'DELETE' })
}

export async function getMFAState(id: string): Promise<MFASystemState> {
  return request<MFASystemState>(`/mfa/systems/${id}/state`)
}

export async function uploadStock(id: string, file: File): Promise<StockUploadResult> {
  return uploadFile<StockUploadResult>(`/mfa/systems/${id}/stock/upload`, file)
}

export async function parseLabelFile(file: File): Promise<{ labels: string[] }> {
  return uploadFile<{ labels: string[] }>(`/mfa/parse-labels`, file)
}

export async function uploadInflows(id: string, file: File): Promise<InflowUploadResult> {
  return uploadFile<InflowUploadResult>(`/mfa/systems/${id}/inflows/upload`, file)
}

export async function setSurvivalConfigs(id: string, configs: SurvivalConfig[]): Promise<{ configs_set: number }> {
  return request<{ configs_set: number }>(`/mfa/systems/${id}/survival`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ configs }),
  })
}

export async function getSurvivalConfigs(id: string): Promise<{ configs: SurvivalConfig[] }> {
  return request<{ configs: SurvivalConfig[] }>(`/mfa/systems/${id}/survival`)
}

export async function previewSurvival(
  id: string,
  shape: number,
  scale: number,
  maxAge?: number,
): Promise<SurvivalPreviewPoint[]> {
  const params = new URLSearchParams({ shape: String(shape), scale: String(scale) })
  if (maxAge !== undefined) params.set('max_age', String(maxAge))
  return request<SurvivalPreviewPoint[]>(`/mfa/systems/${id}/survival/preview?${params}`)
}

export async function simulateMFA(id: string): Promise<SimulationResult> {
  return request<SimulationResult>(`/mfa/systems/${id}/simulate`, { method: 'POST' })
}

export async function getMFAResults(id: string): Promise<SimulationResult> {
  return request<SimulationResult>(`/mfa/systems/${id}/results`)
}

export async function downloadStockTemplate(id: string, name: string): Promise<void> {
  return downloadCSV(`/mfa/systems/${id}/templates/stock`, `stock_template_${name}.csv`)
}

export async function exportMFAResults(systemId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/mfa/systems/${systemId}/export`)
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

export interface ImportResult {
  years_imported: number
  cohorts_found: number
  warnings: string[]
}

export async function importMFASimulation(systemId: string, file: File): Promise<ImportResult> {
  return uploadFile<ImportResult>(`/mfa/systems/${systemId}/import-simulation`, file)
}

export async function importMFASystem(file: File): Promise<SystemDefinition> {
  return uploadFile<SystemDefinition>(`/mfa/import-system`, file)
}

export async function downloadInflowTemplate(id: string, name: string): Promise<void> {
  return downloadCSV(`/mfa/systems/${id}/templates/inflows`, `inflow_template_${name}.csv`)
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
}

export interface MultiImportResult {
  format: 'single' | 'multi'
  created: number
  folders_created: number
  archetypes: MultiImportArchetypeSummary[]
  warnings: string[]
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

export async function importArchetype(file: File): Promise<MultiImportResult> {
  return uploadFile<MultiImportResult>('/bom/archetypes/import', file)
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
  patch: { name?: string; quantity?: number; unit?: string; is_annual?: boolean; ecoinvent_activity?: EcoinventLink | null; evolution?: MaterialEvolution | null },
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

// ── Cohort mappings + combined MFA × LCA ─────────────────────────────────────

export async function setCohortMappings(
  systemId: string,
  mappings: CohortMappingEntry[],
): Promise<CohortMappingResult> {
  return request<CohortMappingResult>(`/mfa/systems/${systemId}/cohort-mappings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mfa_system_id: systemId, mappings }),
  })
}

export async function getCohortMappings(systemId: string): Promise<CohortMapping> {
  return request<CohortMapping>(`/mfa/systems/${systemId}/cohort-mappings`)
}

export async function uploadCohortMappings(
  systemId: string,
  file: File,
): Promise<CohortMappingResult> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API_BASE}/mfa/systems/${systemId}/cohort-mappings/upload`, {
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
  const url = `${API_BASE}/mfa/systems/${encodeURIComponent(systemId)}/cohort-mappings/template`
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

export interface MFALCARunOptions {
  scope: 'inflows' | 'outflows' | 'stock' | 'all'
  yearStart?: number | null
  yearEnd?: number | null
}

export async function runMFALCA(
  systemId: string,
  methods: string[][],
  opts: MFALCARunOptions,
): Promise<MFALCABatchResult> {
  return request<MFALCABatchResult>(`/mfa/systems/${systemId}/mfa-lca`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      methods,
      scope: opts.scope,
      year_start: opts.yearStart ?? null,
      year_end: opts.yearEnd ?? null,
    }),
  })
}

export async function getMFALCAResult(systemId: string): Promise<MFALCABatchResult> {
  return request<MFALCABatchResult>(`/mfa/systems/${systemId}/mfa-lca`)
}

export async function exportMFALCA(systemId: string, filename: string, year?: number | null): Promise<void> {
  const qs = year != null ? `?year=${year}` : ''
  const res = await fetch(`${API_BASE}/mfa/systems/${systemId}/mfa-lca/export${qs}`, { method: 'POST' })
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
}

export interface MaterialFlowResult {
  scope: string
  stages_included: string[]
  year_start: number
  year_end: number
  group_by: string
  materials: MaterialSeries[]
  elapsed_seconds: number
}

export async function calculateMaterialFlows(
  systemId: string,
  body: { scope: string; year_start?: number | null; year_end?: number | null; group_by?: string },
): Promise<MaterialFlowResult> {
  return request<MaterialFlowResult>(`/mfa/systems/${systemId}/material-flows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
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
  const res = await fetch(`${API_BASE}/mfa/systems/${systemId}/material-flows/export?${params}`)
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

export interface ProspectiveDB {
  name: string
  base_db: string
  iam: string
  ssp: string
  year: number
  created_at: string
}

export interface PLCAGenerateRequest {
  base_db: string
  iam: string
  ssp: string
  years: number[]
  source_version?: string
  system_model?: string
}

export interface PLCAGenerateResponse {
  task_id: string
  planned_names: string[]
}

export interface PLCAProgressMessage {
  type: 'progress' | 'done' | 'error'
  stage?: string
  pct?: number
  written?: string[]
  error?: string
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
}

export interface ImpactAssessmentMeta {
  mode: 'static' | 'projected'
  mfa_system_id: string
  scope: 'inflows' | 'outflows' | 'stock' | 'all'
  year_start?: number | null
  year_end?: number | null
  base_db?: string | null
  scenario?: ProspectiveScenarioRef | null
  year_to_database: Record<number, string>
}

export interface ImpactAssessmentResult {
  task_id: string
  meta: ImpactAssessmentMeta
  results: MFALCAResult[]
  elapsed_seconds?: number | null
}

export interface ImpactProgressMessage {
  type: 'progress' | 'done' | 'error'
  stage?: string
  pct?: number
  methods_calculated?: number
  year_to_database?: Record<number, string>
  elapsed_seconds?: number
  error?: string
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

export async function getImpactResults(taskId: string): Promise<ImpactAssessmentResult> {
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
  impact_mode: 'static' | 'projected'
  boundary_set_id: string
  multi_d: MultiDConfig
  carbon_budget: CarbonBudgetConfig | null
  method_mapping: MethodPBMapping[]
  created_at: string
}

export interface AESAConfigurationCreate {
  name: string
  mfa_system_id: string
  impact_mode?: 'static' | 'projected'
  boundary_set_id?: string
  multi_d: MultiDConfig
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
  sharing_principle: SharingPrincipleId
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

export interface AESAComputeBody {
  config_id?: string | null
  config?: AESAConfiguration | null
  impact_task_id?: string | null
  impact_result?: ImpactAssessmentResult | null
  run_sensitivity?: boolean
}

export async function computeAESA(body: AESAComputeBody): Promise<AESAComputeResult> {
  return _aesaJson('/aesa/compute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function exportAESA(
  config: AESAConfiguration, result: AESAComputeResult, filename: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/aesa/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config, result }),
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
