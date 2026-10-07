import {useState,useEffect} from 'react';
import {MermaidDiagram} from './MermaidDiagram';
import {request,onMessage} from '../vscode';
export default function SchemaExplorer(){
 const [info,setInfo]=useState<any>();const [error,setError]=useState('');const [source,setSource]=useState('');
 const load=()=>{setError('');request('LOAD_SCHEMA',{}).then(setInfo,e=>setError(e.message))};
 useEffect(()=>{load();return onMessage(m=>{if(m.type==='CONNECTIONS_UPDATED')load()})},[]);
 useEffect(()=>{if(!info?.tables?.length){setSource('');return}
  const safe=(s:string)=>s.replace(/[^A-Za-z0-9_]/g,'_');
  const lines=['erDiagram'];for(const t of info.tables){lines.push(` ${safe(t.tableName)} {`);for(const c of t.columns)lines.push(`  ${safe(c.type)} ${safe(c.name)} ${c.isPrimaryKey?'PK':c.isForeignKey?'FK':''}`);lines.push(' }');for(const f of t.foreignKeys)lines.push(` ${safe(t.tableName)} }o--|| ${safe(f.referencedTable)} : "${safe(f.column)}"`)}
  setSource(lines.join('\n'));
 },[info]);
 return <section className="p-4"><h2>Schema & ER Diagram</h2><button onClick={load}>Refresh schema</button>{error&&<p role="alert">{error}</p>}{info&&<p>Connection: {info.connectionId} · Revision: {info.fingerprint} · Index: {info.indexed?'ready':'unavailable'}</p>}{info?.tables?.map((t:any)=><div key={t.tableName}><h3>{t.tableName}</h3><table><thead><tr><th>Column</th><th>Type</th><th>Key</th><th>Nullable</th></tr></thead><tbody>{t.columns.map((c:any)=><tr key={c.name}><td>{c.name}</td><td>{c.type}</td><td>{c.isPrimaryKey?'PK':c.isForeignKey?'FK':''}</td><td>{String(c.isNullable)}</td></tr>)}</tbody></table></div>)}<MermaidDiagram source={source}/></section>;
}
