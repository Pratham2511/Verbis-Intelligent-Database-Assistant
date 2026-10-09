import {useEffect, useState} from 'react';
import {onMessage, request} from '../vscode';
import type {ChatGPTStatus} from '../../../src/services/ChatGPTService';
import type {WebviewMessageType} from '../../../src/types';

export default function ChatGPTSettings() {
  const [status, setStatus] = useState<ChatGPTStatus>();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
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
  return <section className="p-4 space-y-3 border-b border-gray-700" aria-label="ChatGPT plan settings">
    <div className="flex items-center justify-between">
      <h2 className="text-sm font-semibold">ChatGPT plan</h2>
      <button onClick={() => act('CHATGPT_MANAGE_USAGE')} className="text-blue-400 text-xs">Manage usage ↗</button>
    </div>
    <p className="text-xs text-gray-400">Use an eligible ChatGPT Plus or Pro account. Sign-in opens your browser and makes no AI request.</p>
    <p className="text-xs text-gray-400">Credentials stay in this VS Code window only. AI generation uses your plan allowance. Start with one request; extra requests require your choice below.</p>
    <p className="text-xs text-gray-400">ChatGPT may also use purchased credits if your usage settings allow it. Open Manage usage and disable credit use to keep testing within your included allowance.</p>
    {status?.connected && <p>{status.account} · {status.planEnabled ? 'ChatGPT plan connected' : 'Plan usage not granted'}</p>}
    {error && <p role="alert">{error}</p>}
    <div className="flex gap-3">
      <button disabled={working || status?.busy} onClick={() => act('CHATGPT_SIGN_IN')} className="px-3 py-2 rounded bg-white text-black disabled:opacity-40">Continue with ChatGPT</button>
      {status?.busy && <button onClick={() => request('CHATGPT_CANCEL_LOGIN', {}).catch(e => setError(e.message))}>Cancel sign-in</button>}
      {status?.connected && <button disabled={working} onClick={() => act('CHATGPT_SIGN_OUT')}>Sign out</button>}
    </div>
    {status?.planEnabled && <>
      <div className="flex gap-3 items-center">
        <label className="text-sm">ChatGPT model <select aria-label="ChatGPT model" value={status.model ?? ''} disabled={working || status.busy}
          onChange={e => act('CHATGPT_SELECT_MODEL', {model: e.target.value})} className="bg-gray-900 border border-gray-600 rounded px-2 py-1 ml-2">
          <option value="" disabled>Choose a model</option>
          {status.models.map(m => <option key={m.slug} value={m.slug}>{m.name}</option>)}
        </select></label>
        <button disabled={working || status.busy} onClick={() => act('CHATGPT_REFRESH_MODELS')}>Refresh models</button>
      </div>
      <p className="text-xs">AI requests attempted in this window: {status.requestsUsed} of {status.requestLimit}. Failed attempts count toward this local test limit because they may consume usage. SQL execution does not call AI.</p>
      <button disabled={working || status.busy || status.requestsUsed < status.requestLimit} onClick={() => act('CHATGPT_ALLOW_REQUEST')}
        className="text-blue-400 disabled:opacity-40">Allow one more AI request</button>
    </>}
  </section>;
}
