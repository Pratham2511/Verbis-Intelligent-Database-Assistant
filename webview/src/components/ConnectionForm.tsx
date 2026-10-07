// ============================================================================
// ConnectionForm.tsx — DB connection form (no password stored here)
// ============================================================================
import { useState, useEffect } from 'react';
import { request, postMessage, onMessage } from '../vscode';

const DIALECTS = ['postgresql', 'mysql', 'sqlite'] as const;
const emptyForm=()=>({id:'',sslCa:'',name:'',dialect:'postgresql' as typeof DIALECTS[number],host:'localhost',port:5432,database:'',user:'',password:'',ssl:false});

export default function ConnectionForm({editingConnection}:{editingConnection?:any}) {
  const [form, setForm] = useState(emptyForm);
  useEffect(()=>{if(editingConnection)setForm({...editingConnection,password:'',sslCa:editingConnection.sslCa||''})},[editingConnection]);
  const [saved,setSaved]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [connections,setConnections]=useState<any[]>([]);
  useEffect(()=>{const off=onMessage(m=>{if(m.type==='CONNECTIONS_UPDATED')setConnections((m.payload as any).connections)});postMessage('GET_CONNECTIONS',{});return off},[]);

  const submit = async () => {
    if (!form.name || !form.database || (form.dialect!=='sqlite'&&!form.user)) return;
    setBusy(true);setError('');setSaved(false);
    try {const result=await request('CONNECTION_FORM_SAVE',form);setSaved(true);setForm({...form,id:result.connectionId,password:''});}
    catch(e){setError((e as Error).message)}finally{setBusy(false)}
  };
  const remove=async(id:string)=>{setBusy(true);setError('');try{const result=await request('DELETE_CONNECTION',{id});if(result.deleted&&form.id===id){setForm(emptyForm());setSaved(false)}}catch(e){setError((e as Error).message)}finally{setBusy(false)}};

  return (
    <div className="p-4 max-w-xl">
      <button disabled={busy} onClick={()=>{setForm(emptyForm());setSaved(false);setError('')}}>Add another connection</button>
      {connections.map(c=><div key={c.id} className="flex gap-3 mb-2"><strong>{c.name}</strong><span>{c.dialect}</span><button disabled={busy} onClick={()=>postMessage('SELECT_CONNECTION',{id:c.id})}>Select</button><button disabled={busy} onClick={()=>{setForm({...c,password:'',sslCa:c.sslCa||''});setSaved(false)}}>Edit</button><button disabled={busy} onClick={()=>remove(c.id)}>Delete</button></div>)}
      {error&&<p role="alert">{error}</p>}
      <h2 className="text-base font-semibold mb-3">{form.id?'Edit Database Connection':'Add Database Connection'}</h2>
      <p className="text-xs opacity-70 mb-4">
        Passwords are stored in VS Code SecretStorage (backed by the OS keychain).
        They never appear in any file under <code>.qmind/</code>.
      </p>

      <div className="space-y-3 text-xs">
        <Row label="Connection name">
          <input
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="Production Postgres"
            className="w-full bg-transparent border border-qm-border rounded px-2 py-1"
          />
        </Row>
        <Row label="Dialect">
          <select
            value={form.dialect}
            onChange={e => setForm({ ...form, dialect: e.target.value as any, port: e.target.value === 'mysql' ? 3306 : e.target.value === 'postgresql' ? 5432 : 0, ...(e.target.value==='sqlite'?{user:'',password:'',ssl:false,sslCa:''}:{}) })}
            className="bg-transparent border border-qm-border rounded px-2 py-1"
          >
            {DIALECTS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </Row>
        {form.dialect!=='sqlite'&&<div className="grid grid-cols-2 gap-3">
          <Row label="Host">
            <input
              value={form.host}
              onChange={e => setForm({ ...form, host: e.target.value })}
              className="w-full bg-transparent border border-qm-border rounded px-2 py-1"
            />
          </Row>
          <Row label="Port">
            <input
              type="number"
              value={form.port}
              onChange={e => setForm({ ...form, port: parseInt(e.target.value || '5432', 10) })}
              className="w-full bg-transparent border border-qm-border rounded px-2 py-1"
            />
          </Row>
        </div>}
        <Row label="Database / SQLite path">
          <input
            value={form.database}
            onChange={e => setForm({ ...form, database: e.target.value })}
            className="w-full bg-transparent border border-qm-border rounded px-2 py-1"
          />
        </Row>
        {form.dialect!=='sqlite'&&<><Row label="User">
          <input
            value={form.user}
            onChange={e => setForm({ ...form, user: e.target.value })}
            className="w-full bg-transparent border border-qm-border rounded px-2 py-1"
          />
        </Row>
        <Row label="Password (stored in OS keychain)">
          <input
            type="password"
            value={form.password}
            onChange={e => setForm({ ...form, password: e.target.value })}
            className="w-full bg-transparent border border-qm-border rounded px-2 py-1"
          />
        </Row>
        <Row label="SSL">
          <input
            type="checkbox"
            checked={form.ssl}
            onChange={e => setForm({ ...form, ssl: e.target.checked })}
          />
        </Row>
        {form.ssl&&<Row label="CA certificate path (optional; certificates and hostnames are verified)"><input value={form.sslCa} onChange={e=>setForm({...form,sslCa:e.target.value})}/></Row>}
        </>}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={submit}
            disabled={busy || !form.name || !form.database || (form.dialect!=='sqlite'&&!form.user)}
            className="bg-qm-accent text-white px-4 py-1 rounded disabled:opacity-50"
          >
            {busy?'Validating…':'Save'}
          </button>
          {saved && <span className="text-qm-good">✓ Saved</span>}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block opacity-70 mb-1">{label}</span>
      {children}
    </label>
  );
}
