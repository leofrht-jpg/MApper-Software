from pydantic import BaseModel


# ── Phase 0 ──────────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str
    brightway2_version: str
    current_project: str


class ProjectResponse(BaseModel):
    name: str
    is_current: bool


class SwitchProjectRequest(BaseModel):
    name: str


class CreateProjectRequest(BaseModel):
    name: str


class DuplicateProjectRequest(BaseModel):
    source_name: str
    new_name: str


class ExportProjectRequest(BaseModel):
    name: str


class DeleteProjectResponse(BaseModel):
    deleted: bool
    current_project: str


class DatabaseResponse(BaseModel):
    name: str
    records: int
    modified: str | None
    is_prospective: bool = False
    prospective_meta: dict | None = None


# ── Phase 1A: Activities ──────────────────────────────────────────────────────

class ActivitySummary(BaseModel):
    key: str           # string repr of bw2 tuple key, e.g. "('db', 'abc')"
    code: str
    name: str
    location: str
    unit: str
    product: str
    database: str


class ActivityPage(BaseModel):
    items: list[ActivitySummary]
    total: int
    offset: int
    limit: int


class ActivityDistinctValues(BaseModel):
    locations: list[str]
    units: list[str]


class ExchangeDetail(BaseModel):
    input_key: str
    input_name: str
    input_location: str
    input_unit: str
    input_database: str
    amount: float
    type: str


class ActivityDetail(BaseModel):
    key: str
    code: str
    name: str
    location: str
    unit: str
    product: str
    database: str
    exchanges: list[ExchangeDetail]
    metadata: dict


class ActivityExportDetail(BaseModel):
    database: str
    code: str
    name: str
    reference_product: str
    location: str
    unit: str
    classifications: str
    comment: str
    production_amount: float
    technosphere_count: int
    biosphere_count: int
    activity_type: str


class ActivityExportRequest(BaseModel):
    codes: list[str]


class ActivityExportSelectionRequest(BaseModel):
    codes: list[str]
    format: str = "xlsx"


class MethodIndicator(BaseModel):
    indicator: str
    tuple: list[str]


class MethodCategory(BaseModel):
    category: str
    indicators: list[MethodIndicator]


class MethodFamily(BaseModel):
    family: str
    categories: list[MethodCategory]


# ── Phase 1B: Ecoinvent Import ────────────────────────────────────────────────

class ValidateCredentialsRequest(BaseModel):
    username: str
    password: str


class ValidateCredentialsResponse(BaseModel):
    valid: bool
    versions: list[str]
    message: str


class ImportEcoinventRequest(BaseModel):
    username: str
    password: str
    version: str
    system_model: str


class BrowseFolderRequest(BaseModel):
    path: str


class BrowseFolderResponse(BaseModel):
    valid: bool
    spold_count: int
    path: str
    message: str = ""


class ImportLocalEcoinventRequest(BaseModel):
    db_name: str
    dirpath: str


class TaskStartedResponse(BaseModel):
    task_id: str
    status: str


class TaskProgressMessage(BaseModel):
    step: str
    progress: float
    message: str


# ── Phase 1C: LCA ─────────────────────────────────────────────────────────────

class FunctionalUnit(BaseModel):
    key: str
    amount: float


class LCACalculateRequest(BaseModel):
    functional_unit: FunctionalUnit
    method: list[str]


class LCAResult(BaseModel):
    task_id: str
    method: list[str]
    functional_unit_name: str
    functional_unit_amount: float
    score: float
    unit: str
    calculated_at: str


class ContributionItem(BaseModel):
    activity_name: str
    activity_key: str
    location: str
    amount: float
    unit: str
    percentage: float


class ContributionsResponse(BaseModel):
    items: list[ContributionItem]
    rest_amount: float
    rest_percentage: float


class SankeyNode(BaseModel):
    id: str
    name: str
    location: str


class SankeyLink(BaseModel):
    source: str
    target: str
    value: float


class SankeyData(BaseModel):
    nodes: list[SankeyNode]
    links: list[SankeyLink]
