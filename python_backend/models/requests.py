from pydantic import BaseModel, Field
from typing import Optional, Literal


class GenerateRequest(BaseModel):
    nl_query: str = Field(min_length=1, max_length=20000)
    schema_context: str = ""
    dialect: str = "postgresql"
    query_type: str = "sql"          # "sql" | "nosql"
    provider: Literal['gemini', 'groq', 'openrouter', 'chatgpt', 'local'] = 'gemini'
    api_key: str = ""                # from VS Code SecretStorage — never stored
    model: Optional[str] = None      # user-configured model override (verbis.llm.*Model)
    privacy_enabled: bool = True
    conversation: list[dict] = Field(default_factory=list, max_length=20)
    session_id: Optional[str] = None
    db_config_id: Optional[str] = None


class ExecuteRequest(BaseModel):
    sql: str = Field(min_length=1, max_length=100000)
    connection_id: str
    request_id: Optional[str] = None
    parameters: dict = Field(default_factory=dict)
    row_limit: int = Field(default=500, ge=1, le=10000)
    read_only: Optional[bool] = None      # None → fall back to Settings.read_only_by_default
    timeout_seconds: Optional[int] = Field(default=None, ge=1, le=600)  # None → fall back to Settings.execution_timeout_seconds


class ImpactRequest(BaseModel):
    proposed_ddl: str
    schema_context: str


class RobustnessRequest(BaseModel):
    query_set: list[dict]
    schema_context: str


class GlossaryRequest(BaseModel):
    term: str
    sql_template: str
    aliases: list[str] = []
    description: str = ""
    dialect: str = "postgresql"


# ─── Schema Impact (services/schema_impact.py) ─────────────────────────


class BreakageEntry(BaseModel):
    queryId: str
    nlInput: str = ""
    reason: str = ""


class ImpactResponse(BaseModel):
    ddl: str
    affectedObject: dict          # {'type': 'column'|'table'|'unknown', 'name': str}
    breakage: dict                # {'willBreak': [BreakageEntry], 'needsReview': [...], 'unaffected': int}
    autoRewriteAvailable: int = 0


# ─── Robustness Suite (services/robustness_service.py) ─────────────────


class RobustnessQueryItem(BaseModel):
    id: str
    sql: str
    nlInput: str = ""


class PerturbationResult(BaseModel):
    perturbationType: str
    breakageRate: float
    hallucinationRate: float
    accuracyDegradation: float
    affectedQueries: list[str] = []


class RobustnessReport(BaseModel):
    overallScore: float
    totalQueries: int
    survivedAll: int
    perPerturbation: list[PerturbationResult] = []
    mostFragile: str = ""
    mostResilient: str = ""
    recommendations: list[str] = []


# ─── Business Glossary (services/glossary_service.py) ──────────────────


class GlossaryTerm(BaseModel):
    term: str
    sqlTemplate: str
    connectionId: Optional[str] = None
    units: dict[str,str] = {}
    revision: int = 1
    owner: str = ""
    lastValidated: str = ""
    aliases: list[str] = []
    description: str = ""
    dialect: str = "postgresql"


class JoinPath(BaseModel):
    fromTable: str
    toTable: str
    joinCondition: str = ""


class GlossaryStore(BaseModel):
    terms: list[GlossaryTerm] = []
    joinPaths: list[JoinPath] = []
