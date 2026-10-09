import {useState, useEffect} from 'react';
import {MermaidDiagram} from './MermaidDiagram';
import {request, onMessage} from '../vscode';
import {EmptyState, useConnectionList} from './WorkspaceGuide';
export default function SchemaExplorer() {
  const [info, setInfo] = useState<any>(), [error, setError] = useState(''), [source, setSource] = useState(''), [busy, setBusy] = useState(false);
  const {connections} = useConnectionList();
  const load = () => {setError(''); setBusy(true); request('LOAD_SCHEMA', {}).then(setInfo, e => setError(e.message)).finally(() => setBusy(false));};
  useEffect(() => {load(); return onMessage(m => {if (m.type === 'CONNECTIONS_UPDATED') load();});}, []);
  useEffect(() => {
    if (!info?.tables?.length) {setSource(''); return;}
    const safe = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_');
    const lines = ['erDiagram'];
    for (const t of info.tables) {lines.push(` ${safe(t.tableName)} {`); for (const c of t.columns) lines.push(`  ${safe(c.type)} ${safe(c.name)} ${c.isPrimaryKey ? 'PK' : c.isForeignKey ? 'FK' : ''}`); lines.push(' }'); for (const f of t.foreignKeys) lines.push(` ${safe(t.tableName)} }o--|| ${safe(f.referencedTable)} : "${safe(f.column)}"`);}
    setSource(lines.join('\n'));
  }, [info]);
  return <section className="workspace-section"><h1>Tables and columns</h1><p className="page-intro">See how your selected database is organized. A primary key identifies a row; a foreign key links it to another table.</p>
    <button className="secondary" disabled={busy} onClick={load}>{busy ? 'Loading tables…' : 'Refresh tables'}</button>
    {error && <p role="alert">{error}</p>}{info && <p>Database: <strong>{connections.find(c => c.id === info.connectionId)?.name ?? info.connectionId}</strong> · {info.tables.length} tables</p>}
    {info && !info.tables.length && <EmptyState title="No tables found">Choose another database, import a CSV, or use “Design new tables” under More tools.</EmptyState>}
    {info?.tables?.map((t: any) => <article className="table-description" key={t.tableName}><h2>{t.tableName}</h2><div className="grid-scroll"><table className="result-table"><thead><tr><th>Column</th><th>Data type</th><th>Row identifier / link</th><th>Empty allowed</th></tr></thead><tbody>{t.columns.map((c: any) => <tr key={c.name}><td>{c.name}</td><td>{c.type}</td><td>{c.isPrimaryKey ? 'Primary key' : c.isForeignKey ? 'Foreign key' : '—'}</td><td>{c.isNullable ? 'Yes' : 'No'}</td></tr>)}</tbody></table></div></article>)}
    {source && <><h2>How tables connect</h2><MermaidDiagram source={source}/></>}
    {info && <details><summary>Technical schema details</summary><p>Revision: {info.fingerprint} · Schema index: {info.indexed ? 'ready' : 'unavailable'}</p></details>}
  </section>;
}
