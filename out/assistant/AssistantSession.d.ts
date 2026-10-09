import { BackendClient } from '../services/BackendClient';
import { SecretsService } from '../services/SecretsService';
import { WorkspaceService } from '../services/WorkspaceService';
import { ExecutionResult } from '../types';
export interface AssistantReply {
    kind: 'sql' | 'message' | 'offtopic' | 'error' | 'cancelled';
    connectionId?: string;
    schemaFingerprint?: string;
    parameters?: Record<string, unknown>;
    sql?: string;
    explanation?: string;
    confidence?: number;
    message?: string;
    wasCancelled?: boolean;
    alternatives?: Array<{
        sql: string;
        interpretation: string;
        confidence: number;
    }>;
    ambiguityQuestions?: Array<{
        id: string;
        question: string;
        options: string[];
    }>;
}
export interface ExecuteOutcome {
    kind: 'result' | 'error' | 'cancelled';
    result?: ExecutionResult;
    message?: string;
}
interface HistoryEntry {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    sql?: string;
    connectionId?: string;
    schemaFingerprint?: string;
    parameters?: Record<string, unknown>;
}
export type CredentialSource = 'configured' | 'session' | 'unset';
export declare class AssistantSession {
    private readonly getClient;
    private readonly secrets;
    private readonly workspace;
    private sessionId;
    private history;
    private lastUserQuestion;
    private conversationConnectionId?;
    private busy;
    private abortController;
    private executionId?;
    private sessionApiKey;
    private credentialSource;
    private credentialProvider?;
    private pending?;
    private stateRevision;
    constructor(getClient: () => BackendClient | null, secrets: SecretsService, workspace: WorkspaceService);
    get id(): string;
    get isBusy(): boolean;
    get transcript(): ReadonlyArray<HistoryEntry>;
    get providerLabel(): string;
    get modelLabel(): string;
    get readOnlyMode(): boolean;
    get credentialSourceLabel(): "ChatGPT plan (this window only)" | "Local (no key)" | "Session-specific key (not saved)" | "Existing configured key" | "Not chosen yet";
    private resolveModel;
    private resolveApiKey;
    ensureCredentialChoice(): Promise<{
        ok: boolean;
        message?: string;
    }>;
    getStatusSnapshot(): Promise<{
        provider: string;
        model: string;
        readOnly: boolean;
        connectionName: string | undefined;
        dialect: "postgresql" | "mysql" | "sqlite" | "mssql" | "mongodb" | undefined;
        database: string | undefined;
        tableCount: number | undefined;
        columnCount: number | undefined;
    }>;
    ask(nlInput: string): Promise<AssistantReply>;
    withProvider<T>(operation: (client: BackendClient, options: {
        provider: string;
        apiKey: string;
        model?: string;
    }, signal: AbortSignal) => Promise<T>): Promise<T>;
    bindSql(sql: string, connectionId: string, schemaFingerprint?: string, parameters?: Record<string, unknown>): void;
    restoreAnalysis(entry: {
        id: string;
        sql: string;
        question: string;
        connectionId: string;
        schemaFingerprint: string;
        parameters: Record<string, unknown>;
    }): void;
    execute(sql: string, parameters?: Record<string, unknown>): Promise<ExecuteOutcome>;
    private recordExecution;
    private connectionName;
    cancel(): void;
    reset(): void;
    discardSessionKey(): void;
    private persist;
    restoreLastSession(): Promise<number>;
    get restoredSql(): string | undefined;
    static describeError(err: unknown): string;
}
export {};
