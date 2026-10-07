// ============================================================================
// Verbis — Shared TypeScript Interfaces
// src/types/index.ts
//
// All types shared between the VS Code extension host and the React webview.
// These mirror the Pydantic models in python_backend/models/{requests,responses}.py
// ============================================================================

// ─── Database Configuration ───────────────────────────────────────────────
export interface DBConfig {
  id: string;                          // UUID, used as pool key
  name: string;                        // Display name (e.g., "Production Postgres")
  dialect: 'postgresql' | 'mysql' | 'sqlite' | 'mssql' | 'mongodb';
  host: string;
  port: number;
  database: string;
  user: string;
  // Password is NEVER stored here — lives in VS Code SecretStorage under key `qm.db.password.${id}`
  ssl?: boolean;
  sslCa?:string;
  poolSize?: number;                   // Default: 5
}

// ─── LLM Mode ─────────────────────────────────────────────────────────────
export type LLMMode = 'cloud' | 'local' | 'auto';

export interface LLMSettings {
  mode: LLMMode;
  cloudEndpoint?: string;
  cloudModel?: string;
  localModel?: string;
  privacyShieldEnabled: boolean;
}

// ─── Chat Messages ────────────────────────────────────────────────────────
export interface ChatMessage {
  id: string;                          // UUID
  role: 'user' | 'assistant' | 'system';
  content: string;                     // NL text or assistant reply text
  timestamp: number;                   // Unix ms
  metadata?: ChatMessageMetadata;
}

export interface ChatMessageMetadata {
  sql?: string;
  confidence?: number;                 // 0.0 – 1.0
  alternatives?: AlternativeSQL[];
  executionResult?: ExecutionResult;
  narrative?: string;                 // Analytical narrative
  planExplanation?: string;            // Plain-English plan explanation
  ambiguityQuestions?: AmbiguityQuestion[];
  error?: string;
  queryNodeId?: string;               // Linked node in Query Tree DAG
}

export interface AlternativeSQL {
  sql: string;
  interpretation: string;              // Plain-English label for this interpretation
  confidence: number;
}

export interface AmbiguityQuestion {
  id: string;
  question: string;
  options: string[];                   // Max 3 options per spec
  selectedOption?: string;
}

// ─── Schema ───────────────────────────────────────────────────────────────
export interface SchemaInfo {
  tableName: string;
  columns: ColumnInfo[];
  primaryKey?: string[];
  foreignKeys?: ForeignKeyInfo[];
  rowCountEstimate?: number;
  dialect?: string;
}

export interface ColumnInfo {
  name: string;
  type: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  defaultValue?: string;
}

export interface ForeignKeyInfo {
  column: string;
  referencedTable: string;
  referencedColumn: string;
}

// ─── Execution ────────────────────────────────────────────────────────────
export interface ExecutionResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionTimeMs: number;
  rowsScanned?: number;
  planExplanation?: string;
  piiColumnsMasked?: string[];
  regressionAlert?: RegressionAlert;
  truncated?: boolean;
}

export interface RegressionAlert {
  percentSlower: number;
  baselineMs: number;
  currentMs: number;
  possibleCauses: string[];
  suggestedFix?: string;
}

// ─── Query Tree (DAG) ─────────────────────────────────────────────────────
export interface QueryNode {
  id: string;                          // UUID
  parentId?: string;                   // null for root node
  nlInput: string;
  sql: string;
  confidence: number;
  status: 'unexecuted' | 'success' | 'failed' | 'warning';
  userRating?: 'up' | 'down';
  executionTimeMs?: number;
  rowCount?: number;
  timestamp: number;
  checkpointLabel?: string;
  annotationCount: number;
  perfSparkline?: number[];            // Last N execution times
  childrenIds?: string[];
}

export interface QueryTree {
  nodes: Record<string, QueryNode>;
  rootIds: string[];
  checkpoints: Array<{ nodeId: string; label: string; timestamp: number }>;
}

// ─── Annotations ──────────────────────────────────────────────────────────
export interface Annotation {
  id: string;
  queryId: string;
  type: 'sql_line' | 'result_cell';
  target: string;                      // Line number OR "row:col" for cells
  author: string;
  timestamp: number;
  comment: string;
  flagType?: 'ANOMALY' | 'VERIFY_NEEDED' | 'CORRECT' | 'INCORRECT' | 'NOTE';
  resolved: boolean;
  replies: AnnotationReply[];
}

export interface AnnotationReply {
  author: string;
  timestamp: number;
  comment: string;
}

// ─── Glossary ─────────────────────────────────────────────────────────────
export interface GlossaryTerm {
  connectionId?: string;
  units?: Record<string,string>;
  revision?: number;
  term: string;
  sqlTemplate: string;
  aliases: string[];
  description: string;
  dialect: string;
  owner: string;
  lastValidated: string;               // ISO date
}

export interface JoinPath {
  fromTable: string;
  toTable: string;
  viaColumn: string;
  cost: number;                        // Heuristic join cost
}

// ─── Schema Impact ────────────────────────────────────────────────────────
export interface SchemaChangeImpact {
  ddl: string;
  affectedObject: { type: 'table' | 'column'; name: string };
  breakage: {
    willBreak: Array<{ queryId: string; nlInput: string; reason: string }>;
    needsReview: Array<{ queryId: string; nlInput: string; reason: string }>;
    unaffected: number;
  };
  autoRewriteAvailable: number;
}

// ─── Robustness Test ──────────────────────────────────────────────────────
export interface RobustnessReport {
  overallScore: number;                // 0–100
  totalQueries: number;
  survivedAll: number;
  perPerturbation: Array<{
    perturbationType: string;
    breakageRate: number;
    hallucinationRate: number;
    accuracyDegradation: number;
    affectedQueries: string[];
  }>;
  mostFragile: string;
  mostResilient: string;
  recommendations: string[];
}

// ─── postMessage Protocol ─────────────────────────────────────────────────
export interface WebviewMessage {
  type: WebviewMessageType;
  requestId?: string;
  payload: unknown;
}

export type WebviewMessageType =
  | 'OPEN_ANALYSIS' | 'EDIT_CONNECTION' | 'PROJECT_CHANGED' | 'PICK_CSV' | 'EXPORT_FILE' | 'CANCEL_REQUEST'
  | 'PANEL_READY' | 'OPEN_TAB' | 'LOAD_SCHEMA' | 'LOAD_TREE' | 'GET_GLOSSARY' | 'GLOSSARY_LOADED' | 'ROBUSTNESS_RESULT' | 'WORKSPACE_ACTION' | 'WORKSPACE_RESULT' | 'DELETE_CONNECTION' | 'OPEN_SOURCE'
  | 'GENERATE_SQL'
  | 'EXECUTE_SQL'
  | 'SQL_GENERATED'
  | 'EXECUTION_COMPLETE'
  | 'SCHEMA_LOADED'
  | 'TREE_UPDATED'
  | 'ANNOTATION_ADDED'
  | 'ANNOTATION_RESOLVED'
  | 'NODE_FORKED'
  | 'NODE_CHECKPOINTED'
  | 'AMBIGUITY_ANSWERED'
  | 'GLOSSARY_SAVED'
  | 'IMPACT_REQUESTED'
  | 'ROBUSTNESS_REQUESTED'
  | 'BACKEND_STATUS'
  | 'ERROR'
  | 'SETTINGS_UPDATED'
  | 'STORE_API_KEY'
  | 'OPEN_EXTERNAL'
  | 'SELECT_CONNECTION'
  | 'SCHEMA_CREATE'
  | 'SCHEMA_REFINE'
  | 'SCHEMA_EXECUTE'
  | 'SCHEMA_RESULT'
  | 'SCHEMA_EXECUTED'
  | 'SCHEMA_ERROR'
  | 'CONNECTIONS_UPDATED'
  | 'GET_CONNECTIONS'
  | 'CONNECTION_FORM_SAVE'
  | 'STORE_DB_PASSWORD'
  | 'TEST_CONNECTION'
  | 'CONNECTION_TEST_RESULT';

// ─── Backend Lifecycle ────────────────────────────────────────────────────
export interface BackendStatus {
  state: 'starting' | 'ready' | 'crashed' | 'stopped';
  port?: number;
  pid?: number;
  version?: string;
  lastError?: string;
}

// ─── Memory & Preferences ─────────────────────────────────────────────────
export interface MemoryStore {
  domainVocabulary: Record<string, string>;       // e.g., "revenue" → "SUM(order_total)"
  preferredPatterns: string[];                    // e.g., "always_add_limit_100", "prefer_cte"
  disambiguationRules: Record<string, string>;    // e.g., "top customers" → "highest_total_spend"
  sqlCorrectionHistory: Array<{
    queryId: string;
    originalSql: string;
    correctedSql: string;
    timestamp: number;
  }>;
  lastUpdated: number;
}

// ─── Performance Tracking ─────────────────────────────────────────────────
export interface PerfLogEntry {
  queryFingerprint: string;            // Normalized SQL hash
  timestamp: number;
  executionTimeMs: number;
  rowsScanned?: number;
  costEstimate?: number;
}

export interface PerfBaseline {
  queryFingerprint: string;
  averageMs: number;
  sampleCount: number;
  lastSeen: number;
}
