"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecretsService = void 0;
const vscode = __importStar(require("vscode"));
const crypto = __importStar(require("crypto"));
class SecretsService {
    context;
    verified = new Map();
    markVerified(provider, key, model) { this.verified.set(this.verificationId(provider, key, model), Date.now()); }
    verifiedAt(provider, key, model) { return this.verified.get(this.verificationId(provider, key, model)); }
    verificationId(provider, key, model) { return provider + ':' + model + ':' + crypto.createHash('sha256').update(key).digest('hex'); }
    static GEMINI_KEY = 'verbis.geminiApiKey';
    static GROQ_KEY = 'verbis.groqApiKey';
    static OPENROUTER_KEY = 'verbis.openrouterApiKey';
    static DB_PREFIX = 'verbis.db.password.';
    constructor(context) {
        this.context = context;
    }
    async storeGeminiKey(key) {
        this.verified.clear();
        await this.context.secrets.store(SecretsService.GEMINI_KEY, key.trim());
    }
    async getGeminiKey() {
        return this.context.secrets.get(SecretsService.GEMINI_KEY);
    }
    async deleteGeminiKey() {
        this.verified.clear();
        await this.context.secrets.delete(SecretsService.GEMINI_KEY);
    }
    async storeGroqKey(key) {
        this.verified.clear();
        await this.context.secrets.store(SecretsService.GROQ_KEY, key.trim());
    }
    async getGroqKey() {
        return this.context.secrets.get(SecretsService.GROQ_KEY);
    }
    async deleteGroqKey() {
        this.verified.clear();
        await this.context.secrets.delete(SecretsService.GROQ_KEY);
    }
    async storeOpenRouterKey(key) {
        this.verified.clear();
        await this.context.secrets.store(SecretsService.OPENROUTER_KEY, key.trim());
    }
    async getOpenRouterKey() {
        return this.context.secrets.get(SecretsService.OPENROUTER_KEY);
    }
    async deleteOpenRouterKey() {
        this.verified.clear();
        await this.context.secrets.delete(SecretsService.OPENROUTER_KEY);
    }
    async storeDbPassword(dbId, pw) {
        await this.context.secrets.store(`${SecretsService.DB_PREFIX}${dbId}`, pw);
    }
    async getDbPassword(dbId) {
        return this.context.secrets.get(`${SecretsService.DB_PREFIX}${dbId}`);
    }
    async deleteDbPassword(dbId) {
        await this.context.secrets.delete(`${SecretsService.DB_PREFIX}${dbId}`);
    }
    async getPrivacySalt() {
        let salt = await this.context.secrets.get('verbis.privacySalt');
        if (!salt) {
            salt = crypto.randomBytes(32).toString('hex');
            await this.context.secrets.store('verbis.privacySalt', salt);
        }
        return salt;
    }
    async getActiveApiKey(providerOverride) {
        const provider = providerOverride ?? vscode.workspace
            .getConfiguration('verbis')
            .get('llm.provider', 'gemini');
        if (provider === 'local')
            return undefined;
        if (provider === 'groq')
            return this.getGroqKey();
        if (provider === 'openrouter')
            return this.getOpenRouterKey();
        if (provider === 'gemini')
            return this.getGeminiKey();
        return undefined;
    }
}
exports.SecretsService = SecretsService;
//# sourceMappingURL=SecretsService.js.map