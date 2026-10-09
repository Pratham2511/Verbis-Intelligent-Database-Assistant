import * as vscode from 'vscode';
import { JWTVerifyGetKey } from 'jose';
export interface ChatGPTModel {
    slug: string;
    name: string;
}
export interface ChatGPTStatus {
    connected: boolean;
    planEnabled: boolean;
    busy: boolean;
    account?: string;
    model?: string;
    models: ChatGPTModel[];
    requestsUsed: number;
    requestLimit: number;
    sessionOnly: true;
    revision: number;
    providerActive: boolean;
}
interface Dependencies {
    fetch: typeof fetch;
    open: (url: string) => PromiseLike<boolean>;
    verify: typeof validateChatGPTIdentity;
}
export declare function validateChatGPTIdentity(token: string, clientId: string, nonce: string, keySet?: JWTVerifyGetKey): Promise<{
    subject: string;
    email: string | undefined;
}>;
/** The webview receives status only. All OAuth credentials stay in host memory. */
export declare class ChatGPTService implements vscode.Disposable {
    private readonly context;
    private readonly changed;
    readonly onDidChange: vscode.Event<ChatGPTStatus>;
    private active?;
    private registrations;
    private models;
    private selectedModel?;
    private used;
    private limit;
    private pending?;
    private revision;
    private readonly deps;
    constructor(context: vscode.ExtensionContext, deps?: Partial<Dependencies>);
    snapshot(): ChatGPTStatus;
    private emit;
    private hasPlan;
    private request;
    private json;
    private exchange;
    private tokens;
    signIn(): Promise<ChatGPTStatus>;
    cancelSignIn(): void;
    accessToken(): Promise<string>;
    refreshModels(): Promise<ChatGPTStatus>;
    selectModel(slug: string): ChatGPTStatus;
    allowOneMoreRequest(): ChatGPTStatus;
    claimRequest(model?: string): Promise<string>;
    signOut(): Promise<ChatGPTStatus>;
    dispose(): void;
}
export {};
