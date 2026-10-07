import {useState} from 'react';
import {vscode,request} from '../vscode';

const providers=[
    {id:'gemini',name:'Google Gemini',url:'https://aistudio.google.com/app/apikey'},
    {id:'groq',name:'Groq',url:'https://console.groq.com/keys'},
    {id:'openrouter',name:'OpenRouter',url:'https://openrouter.ai/keys'},
] as const;
type CloudProvider=typeof providers[number]['id'];

export function ApiKeySettings(){
    const [keys,setKeys]=useState<Record<CloudProvider,string>>({gemini:'',groq:'',openrouter:''});
    const [error,setError]=useState(''),[saving,setSaving]=useState(false),[saved,setSaved]=useState<CloudProvider>();
    const save=async(provider:CloudProvider)=>{
        const key=keys[provider].trim();if(!key)return;
        setSaving(true);setError('');
        try{
            await request('STORE_API_KEY',{provider,key});
            setKeys(current=>({...current,[provider]:''}));setSaved(provider);
            setTimeout(()=>setSaved(undefined),3000);
        }catch(e){setError((e as Error).message)}finally{setSaving(false)}
    };
    return <div className="space-y-4 p-4">
        <h2 className="text-sm font-semibold text-white uppercase tracking-wider">API Keys</h2>
        <p className="text-xs text-gray-400">Saved through VS Code SecretStorage. Session-only keys are available in the assistant prompt.</p>
        {error&&<p role="alert">{error}</p>}
        {saved&&<p>Saved securely; provider usability is checked on your next query.</p>}
        {providers.map(provider=><div key={provider.id} className="border border-gray-700 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
                <span className="text-sm text-white">{provider.name}<span className="ml-2 text-xs text-gray-400">{provider.id==='openrouter'?'Free models only':'Cloud provider'}</span></span>
                <button onClick={()=>vscode?.postMessage({type:'OPEN_EXTERNAL',payload:provider.url})} className="text-xs text-blue-400 hover:underline">Get API key ↗</button>
            </div>
            <div className="flex gap-2">
                <input type="password" aria-label={provider.name+' API key'} value={keys[provider.id]} onChange={e=>setKeys(current=>({...current,[provider.id]:e.target.value}))}
                    placeholder={'Paste your '+provider.name+' API key'} className="flex-1 bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm font-mono text-gray-200 focus:border-blue-500 focus:outline-none"/>
                <button onClick={()=>save(provider.id)} disabled={!keys[provider.id].trim()||saving} className="px-3 py-1.5 rounded text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-40 transition-colors">{saved===provider.id?'✓ Saved':'Save'}</button>
            </div>
        </div>)}
        <p className="text-xs text-gray-500">Change provider: VS Code Settings → Verbis → LLM Provider. For OpenRouter, choose a free model in OpenRouter Model.</p>
    </div>;
}
export default ApiKeySettings;
