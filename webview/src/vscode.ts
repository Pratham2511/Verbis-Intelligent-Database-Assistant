// ============================================================================
// vscode.ts — acquireVsCodeApi wrapper + typed postMessage helpers
// ============================================================================
import type { WebviewMessage, WebviewMessageType } from '../../src/types';

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

interface VsCodeApi {
  getState: <T>() => T;
  setState: <T>(state: T) => void;
  postMessage: (msg: WebviewMessage) => void;
}

const vscode = window.acquireVsCodeApi ? window.acquireVsCodeApi() : null;

if (!vscode) {
  console.warn('[Verbis] Not running inside VS Code webview — using mock.');
}

export function postMessage(
  type: WebviewMessageType,
  payload: unknown,
  requestId?: string
): void {
  const msg: WebviewMessage = { type, payload, requestId };
  if (vscode) {
    vscode.postMessage(msg);
  } else {
    // Mock for browser dev
    console.log('[mock postMessage]', msg);
  }
}

export function onMessage(handler: (msg: WebviewMessage) => void): () => void {
  const listener = (event: MessageEvent) => handler(event.data as WebviewMessage);
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

export function genRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export { vscode };

// React hook for components that need direct access to the VS Code API.
// Usage:
//   const vscode = useVsCode();
//   vscode.postMessage({ type: 'STORE_API_KEY', payload: {...} });
//
// Falls back to a no-op mock when running outside a webview (e.g. browser dev).
export function useVsCode(): VsCodeApi {
  if (vscode) {
    return vscode;
  }
  // Mock for browser dev — mirrors the real shape so components compile.
  const mock: VsCodeApi = {
    getState: <T,>() => ({} as T),
    setState: () => {},
    postMessage: (msg) => console.log('[mock postMessage]', msg),
  };
  return mock;
}

export function request(type: WebviewMessageType,payload:unknown):Promise<any> {
  const id=genRequestId();
  return new Promise((resolve,reject)=>{
    // Credential, file and confirmation dialogs wait for the user. The host
    // starts its bounded HTTP timeout after that choice; a second webview
    // clock must not expire the first question while the key prompt is open.
    const hostOwnsDeadline=['CHATGPT_SIGN_IN','CHATGPT_SIGN_OUT','GENERATE_SQL','SCHEMA_CREATE','SCHEMA_REFINE','SCHEMA_EXECUTE','PICK_CSV','EXPORT_FILE','DELETE_CONNECTION','STORE_API_KEY','CONNECTION_FORM_SAVE'].includes(type);
    let timer:ReturnType<typeof setTimeout>|undefined;
    const off=onMessage(msg=>{if(msg.requestId!==id)return;if(timer)clearTimeout(timer);off();
      if(msg.type==='ERROR')reject(new Error((msg.payload as {message:string}).message));else resolve(msg.payload);
    });
    if(!hostOwnsDeadline)timer=setTimeout(()=>{off();if(type==='EXECUTE_SQL')postMessage('CANCEL_REQUEST',{});reject(new Error('Request timed out. Retry after checking the backend.'));},type==='EXECUTE_SQL'?610000:95000);
    postMessage(type,payload,id);
  });
}
