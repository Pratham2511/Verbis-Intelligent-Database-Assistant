export interface DBConfig {
    id: string;
    name: string;
    dialect: 'postgresql' | 'mysql' | 'sqlite' | 'mssql' | 'mongodb';
    host: string;
    port: number;
    database: string;
    user: string;
    ssl?: boolean;
    sslCa?: string;
    poolSize?: number;
}
export type LLMMode = 'cloud' | 'local' | 'auto';
export interface LLMSettings {
    mode: LLMMode;
    cloudEndpoint?: string;
    cloudModel?: string;
    localModel?: string;
    privacyShieldEnabled: boolean;
}
export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
    metadata?: ChatMessageMetadata;
}
export interface ChatMessageMetadata {
    sql?: string;
    confidence?: number;
    alternatives?: AlternativeSQL[];
    executionResult?: ExecutionResult;
    narrative?: string;
    planExplanation?: string;
    ambiguityQuestions?: AmbiguityQuestion[];
    error?: string;
    queryNodeId?: string;
}
export interface AlternativeSQL {
    sql: string;
    interpretation: string;
    confidence: number;
}
export interface AmbiguityQuestion {
    id: string;
    question: string;
    options: string[];
    selectedOption?: string;
}
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
export interface QueryNode {
    id: string;
    parentId?: string;
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
    perfSparkline?: number[];
    childrenIds?: string[];
}
export interface QueryTree {
    nodes: Record<string, QueryNode>;
    rootIds: string[];
    checkpoints: Array<{
        nodeId: string;
        label: string;
        timestamp: number;
    }>;
}
export interface Annotation {
    id: string;
    queryId: string;
    type: 'sql_line' | 'result_cell';
    target: string;
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
export interface GlossaryTerm {
    connectionId?: string;
    units?: Record<string, string>;
    revision?: number;
    term: string;
    sqlTemplate: string;
    aliases: string[];
    description: string;
    dialect: string;
    owner: string;
    lastValidated: string;
}
export interface JoinPath {
    fromTable: string;
    toTable: string;
    viaColumn: string;
    cost: number;
}
export interface SchemaChangeImpact {
    ddl: string;
    affectedObject: {
        type: 'table' | 'column';
        name: string;
    };
    breakage: {
        willBreak: Array<{
            queryId: string;
            nlInput: string;
            reason: string;
        }>;
        needsReview: Array<{
            queryId: string;
            nlInput: string;
            reason: string;
        }>;
        unaffected: number;
    };
    autoRewriteAvailable: number;
}
export interface RobustnessReport {
    overallScore: number;
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
export interface WebviewMessage {
    type: WebviewMessageType;
    requestId?: string;
    payload: unknown;
}
export type WebviewMessageType = 'GET_PROVIDER_SETTINGS' | 'UPDATE_PROVIDER_SETTINGS' | 'PROVIDER_SETTINGS' | 'CHATGPT_STATUS' | 'CHATGPT_GET_STATUS' | 'CHATGPT_SIGN_IN' | 'CHATGPT_CANCEL_LOGIN' | 'CHATGPT_SIGN_OUT' | 'CHATGPT_REFRESH_MODELS' | 'CHATGPT_SELECT_MODEL' | 'CHATGPT_ALLOW_REQUEST' | 'CHATGPT_MANAGE_USAGE' | 'OPEN_ANALYSIS' | 'EDIT_CONNECTION' | 'PROJECT_CHANGED' | 'PICK_CSV' | 'PICK_DATABASE_FILE' | 'EXPORT_FILE' | 'CANCEL_REQUEST' | 'PANEL_READY' | 'OPEN_TAB' | 'LOAD_SCHEMA' | 'LOAD_TREE' | 'GET_GLOSSARY' | 'GLOSSARY_LOADED' | 'ROBUSTNESS_RESULT' | 'WORKSPACE_ACTION' | 'WORKSPACE_RESULT' | 'DELETE_CONNECTION' | 'OPEN_SOURCE' | 'GENERATE_SQL' | 'START_SQL_EDITOR' | 'EXECUTE_SQL' | 'SQL_GENERATED' | 'EXECUTION_COMPLETE' | 'SCHEMA_LOADED' | 'TREE_UPDATED' | 'ANNOTATION_ADDED' | 'ANNOTATION_RESOLVED' | 'NODE_FORKED' | 'NODE_CHECKPOINTED' | 'AMBIGUITY_ANSWERED' | 'GLOSSARY_SAVED' | 'IMPACT_REQUESTED' | 'ROBUSTNESS_REQUESTED' | 'BACKEND_STATUS' | 'ERROR' | 'SETTINGS_UPDATED' | 'STORE_API_KEY' | 'OPEN_EXTERNAL' | 'SELECT_CONNECTION' | 'SCHEMA_CREATE' | 'SCHEMA_REFINE' | 'SCHEMA_EXECUTE' | 'SCHEMA_RESULT' | 'SCHEMA_EXECUTED' | 'SCHEMA_ERROR' | 'CONNECTIONS_UPDATED' | 'GET_CONNECTIONS' | 'CONNECTION_FORM_SAVE' | 'STORE_DB_PASSWORD' | 'TEST_CONNECTION' | 'CONNECTION_TEST_RESULT';
export interface BackendStatus {
    state: 'starting' | 'ready' | 'crashed' | 'stopped';
    port?: number;
    pid?: number;
    version?: string;
    lastError?: string;
}
export interface MemoryStore {
    domainVocabulary: Record<string, string>;
    preferredPatterns: string[];
    disambiguationRules: Record<string, string>;
    sqlCorrectionHistory: Array<{
        queryId: string;
        originalSql: string;
        correctedSql: string;
        timestamp: number;
    }>;
    lastUpdated: number;
}
export interface PerfLogEntry {
    queryFingerprint: string;
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
