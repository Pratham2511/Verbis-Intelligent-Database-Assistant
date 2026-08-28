from pydantic import BaseModel
from typing import Optional


class GenerateRequest(BaseModel):
    nl_query: str
    schema_context: str
    dialect: str = "postgresql"
    query_type: str = "sql"          # "sql" | "nosql"
    provider: str = "gemini"         # "gemini" | "groq" | "local"
    api_key: str = ""                # from VS Code SecretStorage — never stored
    model: Optional[str] = None      # user-configured model override (verbis.llm.*Model)
    session_id: Optional[str] = None
    db_config_id: Optional[str] = None


class ExecuteRequest(BaseModel):
    sql: str
    connection_id: str
    row_limit: int = 500
    read_only: Optional[bool] = None      # None → fall back to Settings.read_only_by_default
    timeout_seconds: Optional[int] = None  # None → fall back to Settings.execution_timeout_seconds


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
