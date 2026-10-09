import {useEffect, useState} from 'react';
import {onMessage, request} from '../vscode';
import ChatGPTSettings from './ChatGPTSettings';
import {ApiKeySettings} from './ApiKeySettings';

export default function ProviderSettings() {
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [working, setWorking] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  useEffect(() => {
    const update = (p: {provider: string; model?: string}) => {setProvider(p.provider); setModel(p.model ?? '');};
    const off = onMessage(m => {if (m.type === 'PROVIDER_SETTINGS') update(m.payload as any);});
    request('GET_PROVIDER_SETTINGS', {}).then(update, e => setError(e.message));
    return off;
  }, []);
  const update = async (next: string, saveModel = false) => {
    setWorking(true); setError(''); setSaved(false);
    try {const r = await request('UPDATE_PROVIDER_SETTINGS', {provider: next, ...(saveModel ? {model} : {})}); setProvider(r.provider); setModel(r.model ?? ''); setSaved(true);}
    catch (e) {setError((e as Error).message);}
    finally {setWorking(false);}
  };
  return <section className="settings-group" aria-label="AI provider settings">
    <h2>AI provider</h2><p>Choose one way to generate SQL and design tables. Running reviewed SQL does not use AI.</p>
    <label>Connect AI with<select aria-label="AI provider" value={provider} disabled={working} onChange={e => update(e.target.value)}>
      <option value="" disabled>Loading settings…</option><option value="chatgpt">ChatGPT Plus / Pro — browser sign-in</option>
      <option value="gemini">Google Gemini — API key</option><option value="groq">Groq — API key</option>
      <option value="openrouter">OpenRouter — free models with API key</option><option value="local">Local Ollama — no cloud key</option>
    </select></label>
    {error && <p role="alert">{error}</p>}{saved && <p role="status" className="help-text">AI settings saved. No AI request was made.</p>}
    {provider === 'chatgpt' && <ChatGPTSettings/>}
    {['gemini', 'groq', 'openrouter'].includes(provider) && <>
      <ApiKeySettings provider={provider as 'gemini'|'groq'|'openrouter'}/>
      <div className="workspace-actions"><label>Model name<input aria-label="Provider model" value={model} onChange={e => {setModel(e.target.value); setSaved(false);}}/></label>
        <button disabled={working || !model.trim()} onClick={() => update(provider, true)}>Save model</button></div>
      {provider === 'openrouter' && <p className="help-text">Only :free model names or openrouter/free are accepted. Model availability and provider limits still apply.</p>}
    </>}
    {provider === 'local' && <p>Start Ollama with an OpenAI-compatible endpoint at <code>127.0.0.1:11434/v1</code>. Verbis uses <code>sqlcoder:latest</code>. This choice does not send requests to a cloud provider.</p>}
  </section>;
}
