import {useState} from 'react';
import {vscode,request} from '../vscode';

const providers=[
    {id:'gemini',name:'Google Gemini',url:'https://aistudio.google.com/app/apikey'},
    {id:'groq',name:'Groq',url:'https://console.groq.com/keys'},
    {id:'openrouter',name:'OpenRouter',url:'https://openrouter.ai/keys'},
] as const;
type CloudProvider=typeof providers[number]['id'];

export function ApiKeySettings({provider: selectedProvider}: {provider?: CloudProvider}){
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
    return <div className="api-key-settings">
        <h3>API key</h3>
        <p className="help-text">Save your key in the system keychain. To use it only for this session, leave this blank and choose that option when Verbis asks for a key.</p>
        {error&&<p role="alert">{error}</p>}
        {saved&&<p>Saved securely; provider usability is checked on your next query.</p>}
        {providers.filter(p=>!selectedProvider || p.id===selectedProvider).map(provider=><div key={provider.id} className="space-y-2">
            <div className="flex items-center justify-between">
                <span>{provider.name}</span>
                <button onClick={()=>vscode?.postMessage({type:'OPEN_EXTERNAL',payload:provider.url})} className="text-xs text-blue-400 hover:underline">Get API key ↗</button>
            </div>
            <div className="flex gap-2">
                <input type="password" aria-label={provider.name+' API key'} value={keys[provider.id]} onChange={e=>setKeys(current=>({...current,[provider.id]:e.target.value}))}
                    placeholder={'Paste your '+provider.name+' API key'} className="flex-1 min-w-0"/>
                <button onClick={()=>save(provider.id)} disabled={!keys[provider.id].trim()||saving}>{saved===provider.id?'Saved':'Save key'}</button>
            </div>
        </div>)}
    </div>;
}
export default ApiKeySettings;
