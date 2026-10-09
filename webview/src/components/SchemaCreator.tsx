import {useState} from 'react';
import {request, postMessage} from '../vscode';
import {MermaidDiagram} from './MermaidDiagram';
import {Step} from './WorkspaceGuide';
export function SchemaCreator({aiHelp, onOpenSettings}: {aiHelp?: string; onOpenSettings?: () => void} = {}) {
  const [description, setDescription] = useState(''), [dialect, setDialect] = useState('sqlite'), [generatedDialect, setGeneratedDialect] = useState('');
  const [schema, setSchema] = useState<any>(), [ddl, setDdl] = useState(''), [mermaid, setMermaid] = useState(''), [refinement, setRefinement] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const run = async (fn: () => Promise<void>) => {setBusy(true); setError(''); try {await fn();} catch (e) {setError((e as Error).message);} finally {setBusy(false);}};
  const design = (refine = false) => run(async () => {
    const usedDialect = refine ? generatedDialect : dialect;
    const r = await request(refine ? 'SCHEMA_REFINE' : 'SCHEMA_CREATE', refine ? {schema, refinement, dialect: usedDialect} : {description, dialect: usedDialect});
    setGeneratedDialect(usedDialect); setSchema(r.schema); setDdl(r.ddl); setMermaid(r.mermaid); setRefinement(''); setStatus(r.table_count + ' tables designed. Review them below.');
  });
  return <section className="workspace-section"><h1>Design new tables</h1><p className="page-intro">Describe what you need. Verbis uses AI to design tables, then lets you review and export the SQL or apply it to your selected database.</p>
    <Step number={1} title="Describe your tables"><label>What do you want to store?<textarea rows={5} value={description} onChange={e => setDescription(e.target.value)} placeholder="Customers have names and email addresses. Each customer can place orders with dates and amounts."/></label>
      <div className="workspace-actions"><label>Database type<select value={dialect} onChange={e => setDialect(e.target.value)}><option value="sqlite">SQLite</option><option value="postgresql">PostgreSQL</option><option value="mysql">MySQL</option></select></label><button disabled={busy || !description.trim() || !!aiHelp} onClick={() => design()}>Design tables with AI</button>{busy && <button className="secondary" onClick={() => postMessage('CANCEL_REQUEST', {})}>Cancel</button>}</div><p className="help-text">Designing or revising tables uses an AI attempt.</p>
      {aiHelp && <div className="setup-notice"><p>{aiHelp}</p><button className="text-button" onClick={onOpenSettings}>Open AI settings</button></div>}
    </Step>
    {status && <p role="status">{status}</p>}{error && <p role="alert">{error}</p>}{busy && <p role="status">Working on your request…</p>}
    {schema && <><Step number={2} title="Review the design"><MermaidDiagram source={mermaid}/><label>SQL that creates these tables<textarea className="sql-editor" rows={10} value={ddl} onChange={e => setDdl(e.target.value)}/></label>
      <details><summary>Ask AI to revise the design</summary><label>What should change?<input value={refinement} onChange={e => setRefinement(e.target.value)} placeholder="Add a shipping address to orders"/></label><button disabled={busy || !refinement.trim() || !!aiHelp} onClick={() => design(true)}>Revise design with AI</button></details>
    </Step><Step number={3} title="Export or apply the reviewed SQL"><p>Exporting saves a file. Applying creates tables on the database selected above and asks for confirmation. Read-only mode blocks database changes.</p>
      <div className="workspace-actions"><button className="secondary" disabled={busy} onClick={() => run(async () => {await request('EXPORT_FILE', {name: 'verbis-reviewed-schema.sql', content: ddl});})}>Export SQL file</button><button disabled={busy || !ddl.trim()} onClick={() => run(async () => {const result = await request('SCHEMA_EXECUTE', {ddl, dialect: generatedDialect}); setStatus(result.refreshed ? 'Tables created and refreshed. Open Tables to see them.' : 'SQL applied, but refreshing failed. Open Tables and refresh before generating another query.');})}>Apply SQL to selected database</button></div>
    </Step></>}
  </section>;
}
export default SchemaCreator;
