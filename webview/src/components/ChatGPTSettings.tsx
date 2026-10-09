import {useEffect, useState} from 'react';
import {onMessage, request} from '../vscode';
import type {ChatGPTStatus} from '../../../src/services/ChatGPTService';
import type {WebviewMessageType} from '../../../src/types';

export default function ChatGPTSettings() {
  const [status, setStatus] = useState<ChatGPTStatus>();
  const [working, setWorking] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const off = onMessage(msg => {if (msg.type === 'CHATGPT_STATUS') setStatus(msg.payload as ChatGPTStatus);});
    request('CHATGPT_GET_STATUS', {}).then(setStatus).catch(e => setError(e.message));
    return off;
  }, []);
  const act = async (type: WebviewMessageType, payload: unknown = {}) => {
    setWorking(true); setError('');
    try {setStatus(await request(type, payload));}
    catch (e) {setError((e as Error).message);}
    finally {setWorking(false);}
  };
  const remaining = status ? Math.max(0, status.requestLimit - status.requestsUsed) : 0;
  return <section className="chatgpt-settings" aria-label="ChatGPT plan settings">
    {error && <p role="alert">{error}</p>}
    {!status?.planEnabled && <>
      <p>Sign in with your ChatGPT Plus or Pro account. You do not need an API key.</p>
      <button disabled={working || status?.busy} onClick={() => act('CHATGPT_SIGN_IN')} className="chatgpt-signin">Continue with ChatGPT</button>
      {status?.busy && <div className="workspace-actions"><p role="status">Finish sign-in in your browser, then return here.</p><button className="secondary" onClick={() => request('CHATGPT_CANCEL_LOGIN', {}).catch(e => setError(e.message))}>Cancel sign-in</button></div>}
      {status?.connected && <p>Signed in, but AI access was not approved. Sign in again and choose “Use your ChatGPT plan.”</p>}
      <p className="help-text">Signing in makes no AI request.</p>
    </>}
    {status?.planEnabled && <>
      <p role="status" className="connection-success">ChatGPT connected</p>
      <label>Choose a model<select aria-label="ChatGPT model" value={status.model ?? ''} disabled={working || status.busy}
        onChange={e => act('CHATGPT_SELECT_MODEL', {model: e.target.value})}>
        <option value="" disabled>Choose one model to continue</option>
        {status.models.map(m => <option key={m.slug} value={m.slug}>{m.name}</option>)}
      </select></label>
      {status.busy && <p role="status">Finishing sign-in…</p>}
      {!status.models.length && <p>Models are not loaded yet. Refresh the list before asking a question.</p>}
      <button className="secondary" disabled={working || status.busy} onClick={() => act('CHATGPT_REFRESH_MODELS')}>Refresh model list</button>
      <div className="usage-summary">
        <strong>{remaining === 0 ? 'AI testing is paused' : `${remaining} AI ${remaining === 1 ? 'attempt' : 'attempts'} available`}</strong>
        <p>Each AI generation uses one allowed attempt. Running SQL uses none. A failed AI attempt may still use your plan allowance.</p>
        {remaining === 0 && <button disabled={working || status.busy} onClick={() => act('CHATGPT_ALLOW_REQUEST')}>Allow one more AI attempt</button>}
      </div>
    </>}
    <p className="help-text">AI uses your ChatGPT allowance. Purchased credits may also be used if enabled in your account.</p>
    <button className="text-button" onClick={() => act('CHATGPT_MANAGE_USAGE')}>Manage usage and credit settings ↗</button>
    <details><summary>Account and sign-in details</summary>
      {status?.connected && <p>{status.account}</p>}
      <p>Verbis keeps sign-in credentials only in this VS Code window. Sign in again after restarting or reloading VS Code.</p>
      {status?.connected && <div className="workspace-actions"><button className="secondary" disabled={working || status.busy} onClick={() => act('CHATGPT_SIGN_IN')}>Continue with ChatGPT</button>
        <button className="secondary" disabled={working} onClick={() => act('CHATGPT_SIGN_OUT')}>Sign out</button></div>}
    </details>
  </section>;
}
