import * as vscode from 'vscode';
import * as crypto from 'crypto';

export class SecretsService {
    private verified=new Map<string,number>();
    markVerified(provider:string,key:string,model:string){this.verified.set(this.verificationId(provider,key,model),Date.now())}
    verifiedAt(provider:string,key:string,model:string){return this.verified.get(this.verificationId(provider,key,model))}
    private verificationId(provider:string,key:string,model:string){return provider+':'+model+':'+crypto.createHash('sha256').update(key).digest('hex')}
    private static readonly GEMINI_KEY = 'verbis.geminiApiKey';
    private static readonly GROQ_KEY   = 'verbis.groqApiKey';
    private static readonly OPENROUTER_KEY = 'verbis.openrouterApiKey';
    private static readonly DB_PREFIX  = 'verbis.db.password.';

    constructor(private readonly context: vscode.ExtensionContext) {}

    async storeGeminiKey(key: string): Promise<void> {
        this.verified.clear();
        await this.context.secrets.store(SecretsService.GEMINI_KEY, key.trim());
    }
    async getGeminiKey(): Promise<string | undefined> {
        return this.context.secrets.get(SecretsService.GEMINI_KEY);
    }
    async deleteGeminiKey(): Promise<void> {
        this.verified.clear();
        await this.context.secrets.delete(SecretsService.GEMINI_KEY);
    }

    async storeGroqKey(key: string): Promise<void> {
        this.verified.clear();
        await this.context.secrets.store(SecretsService.GROQ_KEY, key.trim());
    }
    async getGroqKey(): Promise<string | undefined> {
        return this.context.secrets.get(SecretsService.GROQ_KEY);
    }
    async deleteGroqKey(): Promise<void> {
        this.verified.clear();
        await this.context.secrets.delete(SecretsService.GROQ_KEY);
    }

    async storeOpenRouterKey(key: string): Promise<void> {
        this.verified.clear();
        await this.context.secrets.store(SecretsService.OPENROUTER_KEY, key.trim());
    }
    async getOpenRouterKey(): Promise<string | undefined> {
        return this.context.secrets.get(SecretsService.OPENROUTER_KEY);
    }
    async deleteOpenRouterKey(): Promise<void> {
        this.verified.clear();
        await this.context.secrets.delete(SecretsService.OPENROUTER_KEY);
    }

    async storeDbPassword(dbId: string, pw: string): Promise<void> {
        await this.context.secrets.store(`${SecretsService.DB_PREFIX}${dbId}`, pw);
    }
    async getDbPassword(dbId: string): Promise<string | undefined> {
        return this.context.secrets.get(`${SecretsService.DB_PREFIX}${dbId}`);
    }
    async deleteDbPassword(dbId: string): Promise<void> {
        await this.context.secrets.delete(`${SecretsService.DB_PREFIX}${dbId}`);
    }

    async getPrivacySalt(): Promise<string> {
        let salt = await this.context.secrets.get('verbis.privacySalt');
        if (!salt) { salt = crypto.randomBytes(32).toString('hex'); await this.context.secrets.store('verbis.privacySalt', salt); }
        return salt;
    }
    async getActiveApiKey(providerOverride?: string): Promise<string | undefined> {
        const provider = providerOverride ?? vscode.workspace
            .getConfiguration('verbis')
            .get<string>('llm.provider', 'gemini');
        if (provider === 'local') return undefined;
        if (provider === 'groq') return this.getGroqKey();
        if (provider === 'openrouter') return this.getOpenRouterKey();
        if (provider === 'gemini') return this.getGeminiKey();
        return undefined;
    }
}
