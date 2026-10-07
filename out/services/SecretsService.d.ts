import * as vscode from 'vscode';
export declare class SecretsService {
    private readonly context;
    private verified;
    markVerified(provider: string, key: string, model: string): void;
    verifiedAt(provider: string, key: string, model: string): number | undefined;
    private verificationId;
    private static readonly GEMINI_KEY;
    private static readonly GROQ_KEY;
    private static readonly OPENROUTER_KEY;
    private static readonly DB_PREFIX;
    constructor(context: vscode.ExtensionContext);
    storeGeminiKey(key: string): Promise<void>;
    getGeminiKey(): Promise<string | undefined>;
    deleteGeminiKey(): Promise<void>;
    storeGroqKey(key: string): Promise<void>;
    getGroqKey(): Promise<string | undefined>;
    deleteGroqKey(): Promise<void>;
    storeOpenRouterKey(key: string): Promise<void>;
    getOpenRouterKey(): Promise<string | undefined>;
    deleteOpenRouterKey(): Promise<void>;
    storeDbPassword(dbId: string, pw: string): Promise<void>;
    getDbPassword(dbId: string): Promise<string | undefined>;
    deleteDbPassword(dbId: string): Promise<void>;
    getPrivacySalt(): Promise<string>;
    getActiveApiKey(providerOverride?: string): Promise<string | undefined>;
}
