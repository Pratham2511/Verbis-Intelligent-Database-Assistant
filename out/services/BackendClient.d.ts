import { ExecutionResult, SchemaInfo, SchemaChangeImpact, RobustnessReport, GlossaryTerm } from '../types';
export declare class BackendClientError extends Error {
    readonly kind: 'cancelled' | 'timeout' | 'auth' | 'rate_limit' | 'network' | 'server' | 'unknown';
    readonly statusCode?: number | undefined;
    constructor(message: string, kind: 'cancelled' | 'timeout' | 'auth' | 'rate_limit' | 'network' | 'server' | 'unknown', statusCode?: number | undefined);
}
export declare class BackendClient {
    private readonly baseUrl;
    private readonly defaultTimeoutMs;
    private readonly token?;
    constructor(baseUrl: string, // e.g., http://127.0.0.1:8765
    defaultTimeoutMs?: number, token?: string | undefined);
    health(): Promise<{
        status: string;
        version: string;
    }>;
    clearIntentCache(): Promise<{
        status: string;
    }>;
    createSchema(payload: {
        description: string;
        dialect: string;
        provider: string;
        apiKey: string;
        model?: string;
    }, signal?: AbortSignal): Promise<{
        schema: unknown;
        ddl: string;
        mermaid: string;
        table_count: number;
    }>;
    refineSchema(payload: {
        schema: unknown;
        refinement: string;
        dialect: string;
        provider: string;
        apiKey: string;
        model?: string;
    }, signal?: AbortSignal): Promise<{
        schema: unknown;
        ddl: string;
        mermaid: string;
        table_count: number;
    }>;
    refreshSchema(dbConfigId: string): Promise<{
        tables: unknown[];
        indexed: boolean;
    }>;
    generate(payload: {
        nlInput: string;
        dbConfigId: string;
        sessionId: string;
        llmMode?: 'cloud' | 'local' | 'auto';
        conversation?: Array<{
            role: string;
            content: string;
        }>;
        privacyEnabled?: boolean;
        disambiguationAnswers?: Record<string, string>;
        apiKey?: string;
        provider?: string;
        model?: string;
    }, signal?: AbortSignal): Promise<{
        validation?: string;
        connectionId?: string;
        schemaFingerprint?: string;
        parameters?: Record<string, unknown>;
        /** Generated SQL, normalized from the backend's `query` field. Undefined when off-topic. */
        sql?: string;
        confidence: number;
        alternatives: Array<{
            sql: string;
            interpretation: string;
            confidence: number;
        }>;
        explanation?: string;
        narrative?: string;
        planExplanation?: string;
        ambiguityQuestions?: Array<{
            id: string;
            question: string;
            options: string[];
        }>;
        queryNodeId?: string;
        /** True when the intent guard rejected the request as off-topic. */
        offtopic?: boolean;
        /** A provider response was received; deterministic local guards do not verify keys. */
        providerVerified?: boolean;
        /** Polite off-topic / informational message from the backend. */
        message?: string;
    }>;
    execute(payload: {
        sql: string;
        dbConfigId: string;
        rowLimit?: number;
        readOnly?: boolean;
        timeoutSeconds?: number;
        requestId?: string;
        parameters?: Record<string, unknown>;
    }, signal?: AbortSignal): Promise<ExecutionResult>;
    getSchema(dbConfigId: string): Promise<{
        tables: SchemaInfo[];
        indexed: boolean;
    }>;
    analyzeImpact(payload: {
        ddl: string;
        dbConfigId: string;
    }): Promise<SchemaChangeImpact>;
    runRobustness(payload: {
        dbConfigId: string;
        querySet: Array<{
            id: string;
            sql: string;
            nlInput: string;
        }>;
    }): Promise<RobustnessReport>;
    getGlossary(): Promise<{
        terms: GlossaryTerm[];
    }>;
    saveGlossaryTerm(term: GlossaryTerm): Promise<{
        success: boolean;
    }>;
    cancelExecution(requestId: string): Promise<void>;
    registerConnection(connection: unknown, password: string, validateOnly?: boolean): Promise<void>;
    deleteConnection(id: string): Promise<void>;
    workspaceAction(action: string, payload?: unknown): Promise<any>;
    shutdown(): Promise<void>;
    private requestJson;
    /**
     * Pull a clean message out of an error response body. FastAPI returns
     * {"detail":"..."} for HTTP errors and {"detail":[...]} for validation
     * errors; anything else is returned trimmed. Never returns raw JSON braces
     * for the common FastAPI shapes.
     */
    private static extractDetail;
}
