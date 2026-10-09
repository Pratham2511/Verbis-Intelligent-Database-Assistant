import {useEffect, useState} from 'react';
import {request, postMessage, onMessage} from '../vscode';
import {captureAnalysis, resultCsv, analysisReport, type AnalysisSnapshot} from '../analysisExport';
import {Step, EmptyState, useConnectionList} from './WorkspaceGuide';
import {ParametersEditor} from './ValueEditors';
import {readParameters} from '../formValues';
export const action = (name: string, payload: unknown = {}) => request('WORKSPACE_ACTION', {action: name, payload});
export function DataGrid({columns, rows, labels = {}}: {columns: string[]; rows: Record<string, unknown>[]; labels?: Record<string, string>}) {
  const [page, setPage] = useState(0); useEffect(() => setPage(0), [rows]);
  const pages = Math.max(1, Math.ceil(rows.length / 50));
  if (!rows.length) return <EmptyState title="No matching rows">The query returned no rows. Check its conditions and the selected database.</EmptyState>;
  return <><div className="grid-scroll"><table className="result-table"><thead><tr>{columns.map(c => <th scope="col" key={c}>{labels[c] ?? c}</th>)}</tr></thead>
    <tbody>{rows.slice(page * 50, page * 50 + 50).map((r, i) => <tr key={i}>{columns.map(c => <td key={c} title={String(r[c] ?? 'NULL')}>{r[c] === null ? <em>NULL</em> : String(r[c] ?? '')}</td>)}</tr>)}</tbody></table></div>
    {pages > 1 && <div className="workspace-actions"><button className="secondary" disabled={!page} onClick={() => setPage(page - 1)}>Previous page</button><span>Page {page + 1} of {pages} · {rows.length} loaded rows</span><button className="secondary" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next page</button></div>}</>;
}
export function DatasetWorkspace() {
  const [content, setContent] = useState(''), [source, setSource] = useState('pasted CSV'), [encoding, setEncoding] = useState('utf-8'), [delimiter, setDelimiter] = useState('');
  const [table, setTable] = useState('employees'), [key, setKey] = useState(''), [policy, setPolicy] = useState('create');
  const [refreshMapping, setRefreshMapping] = useState(false), [relationships, setRelationships] = useState<any[]>([]), [mapping, setMapping] = useState<any[]>();
  const [preview, setPreview] = useState<any>(), [catalog, setCatalog] = useState<any[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), [report, setReport] = useState<any>();
  const load = () => action('dataset_catalog').then(r => setCatalog(r.tables), e => setError(e.message)); useEffect(() => {load();}, []);
  const payload = () => ({content, source, encoding, delimiter, mapping, key, table, policy, relationships});
  const run = async (fn: () => Promise<void>) => {setBusy(true); setError(''); try {await fn();} catch (e) {setError((e as Error).message);} finally {setBusy(false);}};
  const profile = () => run(async () => {const r = await action('dataset_preview', payload()); setMapping(r.mapping); setPreview(r);});
  const change = (index: number, field: string, value: unknown) => {setMapping(mapping?.map((m, i) => i === index ? {...m, [field]: value} : m)); setPreview(undefined);};
  return <section className="workspace-section"><h1>Import a CSV file</h1><p className="page-intro">Choose a file, check its columns, then import the reviewed rows into a local SQLite dataset. No AI is used.</p>
    <Step number={1} title="Choose your CSV">
      <button disabled={busy} onClick={() => run(async () => {const r = await request('PICK_CSV', {encoding}); if (!r.cancelled) {setContent(r.content); setSource(r.source); if (!refreshMapping) {setMapping(undefined); setRelationships([]);} setPreview(undefined); setReport(undefined);}})}>Choose CSV file</button>
      {content && <p className="help-text">Source: {source === 'pasted CSV' ? source : source.split(/[\\/]/).pop()}</p>}
      <details><summary>Paste CSV text instead</summary><label>CSV contents<textarea aria-label="CSV contents" rows={5} value={content} placeholder={'id,name,salary\n1,Employee A,8000'} onChange={e => {setContent(e.target.value); setPreview(undefined); if (!refreshMapping) {setMapping(undefined); setRelationships([]);} setSource('pasted CSV'); setReport(undefined);}}/></label></details>
      <details><summary>File format options</summary><div className="form-columns"><label>Text encoding<select value={encoding} onChange={e => setEncoding(e.target.value)}><option>utf-8</option><option>utf-16le</option><option>windows-1252</option></select></label>
        <label>Column separator<select value={delimiter} onChange={e => {setDelimiter(e.target.value); setPreview(undefined);}}><option value="">Detect automatically</option><option value=",">Comma</option><option value=";">Semicolon</option><option value={'\t'}>Tab</option><option value="|">Pipe</option></select></label></div></details>
      <div className="workspace-actions"><button disabled={busy || !content} onClick={profile}>{mapping ? 'Check my column choices' : 'Review columns'}</button></div>
    </Step>
    {mapping && <Step number={2} title="Check columns and import choices">
      <p>Confirm the names and data types. “Empty allowed” means a missing value can be stored as NULL.</p>
      <div className="grid-scroll"><table className="result-table"><thead><tr>{['CSV column', 'Name in database', 'Data type', 'Empty allowed'].map(h => <th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{mapping.map((m, i) => <tr key={m.source}><td>{m.source}</td><td><input aria-label={`${m.source} database name`} value={m.name} onChange={e => change(i, 'name', e.target.value)}/></td><td><select aria-label={`${m.source} data type`} value={m.type} onChange={e => change(i, 'type', e.target.value)}>{[{id: 'TEXT', label: 'Text'}, {id: 'INTEGER', label: 'Whole number'}, {id: 'REAL', label: 'Decimal'}, {id: 'DATE', label: 'Date'}].map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></td><td><input aria-label={`${m.source} empty allowed`} type="checkbox" checked={m.nullable} onChange={e => change(i, 'nullable', e.target.checked)}/></td></tr>)}</tbody></table></div>
      <details><summary>Amounts, periods, and date formats</summary><p className="help-text">Confirm units here when a column contains money or dates. Verbis leaves currency and salary period unspecified until you choose them.</p>
        {mapping.map((m, i) => <fieldset key={m.source}><legend>{m.name}</legend><div className="form-columns"><label>Currency<select value={m.currency ?? ''} onChange={e => change(i, 'currency', e.target.value)}>{['', 'INR', 'USD', 'EUR', 'GBP'].map(c => <option key={c} value={c}>{c || 'Not specified'}</option>)}</select></label>
          <label>Amount period<select value={m.period} onChange={e => change(i, 'period', e.target.value)}><option value="unknown">Not specified</option><option value="monthly">Monthly</option><option value="annual">Yearly</option><option value="none">Not an amount</option></select></label>
          <label>Thousands separator<select value={m.groupSeparator} onChange={e => change(i, 'groupSeparator', e.target.value)}>{['', ',', ' ', '.'].map(g => <option key={g} value={g}>{g === '' ? 'None' : g === ' ' ? 'Space' : g}</option>)}</select></label>
          <label>Decimal separator<select value={m.decimalSeparator} onChange={e => change(i, 'decimalSeparator', e.target.value)}><option>.</option><option>,</option></select></label>
          <label>Date format<input placeholder="%Y-%m-%d" value={m.dateFormat ?? ''} onChange={e => change(i, 'dateFormat', e.target.value)}/><span className="help-text">Year-month-day: %Y-%m-%d. Day/month/year: %d/%m/%Y.</span></label></div></fieldset>)}</details>
      <div className="form-columns"><label>Table name<input value={table} onChange={e => {setTable(e.target.value); setPreview(undefined);}}/></label>
        <label>Unique row identifier<select value={key} onChange={e => {setKey(e.target.value); setPreview(undefined);}}><option value="">No unique identifier</option>{mapping.map(m => <option key={m.name}>{m.name}</option>)}</select></label>
        <label>What should this import do?<select value={policy} onChange={e => {setPolicy(e.target.value); setPreview(undefined);}}><option value="create">Create a new table</option><option value="append">Add rows to an imported table</option><option value="replace">Replace an imported table's rows</option></select></label></div>
      {policy === 'replace' && <p className="setup-notice">This replaces the selected imported table's rows. Check the preview before importing.</p>}
      {refreshMapping && <p>Saved choices for {table} are loaded. Choose the updated CSV and review it. <button className="text-button" onClick={() => {setRefreshMapping(false); setMapping(undefined); setRelationships([]); setPreview(undefined);}}>Start a new import instead</button></p>}
      <details><summary>Optional: link to another imported table</summary><p>Only add a link you have checked. Verbis validates it during import.</p>
        {relationships.map((r, i) => <div className="workspace-actions" key={i}><label>This column<select value={r.column} onChange={e => {setRelationships(relationships.map((x, n) => n === i ? {...x, column: e.target.value} : x)); setPreview(undefined);}}><option value="">Choose column</option>{mapping.map(m => <option key={m.name}>{m.name}</option>)}</select></label>
          <label>Links to table<select value={r.table} onChange={e => {const t = catalog.find(t => t.table === e.target.value); setRelationships(relationships.map((x, n) => n === i ? {...x, table: e.target.value, targetColumn: t?.key || ''} : x)); setPreview(undefined);}}><option value="">Choose imported table</option>{catalog.filter(t => t.key).map(t => <option key={t.table}>{t.table}</option>)}</select></label><span>Identifier: {r.targetColumn || 'Choose a table'}</span><button className="text-button" onClick={() => {setRelationships(relationships.filter((_, n) => n !== i)); setPreview(undefined);}}>Remove link</button></div>)}
        <button className="secondary" onClick={() => {setRelationships([...relationships, {column: '', table: '', targetColumn: ''}]); setPreview(undefined);}}>Add table link</button></details>
      <button disabled={busy || !content} onClick={profile}>Check my choices and preview rows</button>
    </Step>}
    {preview && <Step number={3} title="Review rows, then import">
      <p>{preview.rowCount} rows found · {preview.conversionErrorCount} values could not be converted · {preview.duplicateKeyRows.length} duplicate identifiers.</p>
      <p className="help-text">Empty values: {Object.entries(preview.nulls).map(([column, count]) => `${column}: ${count}`).join(' · ') || 'none'}.</p>
      {(preview.conversionErrorCount > 0 || preview.duplicateKeyRows.length > 0) && <p role="alert">Fix conversion errors or duplicate identifiers before importing. You can change a column type or choose a different unique identifier above.</p>}
      {preview.conversionErrors.length > 0 && <details><summary>View conversion errors</summary><pre>{JSON.stringify(preview.conversionErrors, null, 2)}</pre></details>}
      <DataGrid columns={preview.mapping.map((m: any) => m.name)} rows={preview.preview}/>
      <button disabled={busy || preview.conversionErrorCount > 0 || preview.duplicateKeyRows.length > 0} onClick={() => run(async () => {const r = await action('dataset_import', {...payload(), previewHash: preview.previewHash}); setReport(r.report); setPreview(undefined); load();})}>{policy === 'replace' ? 'Replace with these reviewed rows' : policy === 'append' ? 'Add these reviewed rows' : 'Import these reviewed rows'}</button>
    </Step>}
    {busy && <p role="status">Checking your file…</p>}{error && <p role="alert">{error}</p>}{report && <p role="status" className="connection-success">Imported {report.rowCount} rows into {report.table}. It now has {report.totalRows} rows.</p>}
    <h2>Your imported tables</h2>{!catalog.length && <EmptyState title="No CSV files imported yet">Choose a file above. Your imported tables will appear here.</EmptyState>}
    {catalog.map(t => <article className="saved-item" key={t.table}><strong>{t.table}</strong><p>{t.totalRows} rows · {t.source.split(/[\\/]/).pop()}</p>
      <details><summary>Column choices</summary><p>{t.mapping.map((m: any) => `${m.name}: ${m.type} ${m.currency || ''} ${m.period}`).join(' · ')}</p></details>
      <button className="secondary" onClick={() => {setRefreshMapping(true); setContent(''); setSource(t.source); setTable(t.table); setKey(t.key); setRelationships(t.relationships ?? []); setMapping(t.mapping); setDelimiter(t.delimiter); setEncoding(t.encoding); setPolicy('replace'); setPreview(undefined); setReport(undefined);}}>Refresh this table from a new CSV</button></article>)}
  </section>;
}
export function ProjectNavigator() {
  const [index, setIndex] = useState<any>(), [error, setError] = useState(''), [busy, setBusy] = useState(false), [filter, setFilter] = useState('');
  const scan = () => {setBusy(true); setError(''); action('project_scan').then(setIndex, e => setError(e.message)).finally(() => setBusy(false));};
  useEffect(() => {scan(); return onMessage(m => {if (m.type === 'PROJECT_CHANGED') scan();});}, []);
  const entries = index?.entries.filter((e: any) => [e.table, ...e.columns, e.symbol].join(' ').toLowerCase().includes(filter.toLowerCase())) ?? [];
  return <section className="workspace-section"><h1>Find code references</h1><p className="page-intro">Find where your project uses tables and columns. Verbis reads Python, SQLAlchemy, and SQL files without running your application.</p>
    <div className="workspace-actions"><button disabled={busy} onClick={scan}>Refresh references</button><label>Find a table or column<input value={filter} onChange={e => setFilter(e.target.value)} placeholder="employees or salary"/></label></div>
    {error && <p role="alert">{error}</p>}{busy && <p role="status">Reading project files…</p>}
    {index && <><p>{index.coverage}</p>{!entries.length ? <EmptyState title="No matching references">Try another table name, or open a project containing Python or SQL files and refresh.</EmptyState> : <div className="grid-scroll"><table className="result-table"><thead><tr><th>Table / columns</th><th>How it is used</th><th>Open source file</th><th>Evidence</th></tr></thead><tbody>{entries.map((e: any, i: number) => <tr key={i}><td>{e.table || 'Definition'} {e.columns.join(', ')}</td><td>{e.kind} · {e.symbol}</td><td><button className="text-button" onClick={() => postMessage('OPEN_SOURCE', {path: e.path, line: e.line})}>{e.path}:{e.line}</button></td><td>{e.evidence}</td></tr>)}</tbody></table></div>}
      <details><summary>References needing manual review ({index.unresolved.length})</summary><p>Dynamic SQL and unsupported patterns cannot be resolved with a file scan.</p>{index.unresolved.map((u: any, i: number) => <p key={i}><button className="text-button" onClick={() => u.path && postMessage('OPEN_SOURCE', {path: u.path, line: u.line || 1})}>{u.path}:{u.line}</button> {u.reason}</p>)}</details></>}
  </section>;
}
export function AnalysisWorkspace({aiHelp, onOpenSettings}: {aiHelp?: string; onOpenSettings?: () => void} = {}) {
  const [measured, setMeasured] = useState<AnalysisSnapshot>();
  const [question, setQuestion] = useState(''), [sql, setSql] = useState(''), [binding, setBinding] = useState<any>(), [result, setResult] = useState<any>();
  const [name, setName] = useState(''), [parameters, setParameters] = useState('{}'), [saved, setSaved] = useState<any[]>([]), [selected, setSelected] = useState<any>();
  const [status, setStatus] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [task, setTask] = useState(''), [parametersValid, setParametersValid] = useState(true);
  const {connections} = useConnectionList();
  const target = connections.find(c => c.id === binding?.connectionId)?.name ?? binding?.connectionId;
  const loadLast = () => action('last_result').then(r => {if (r.sql) {setQuestion(''); setSql(r.sql); setBinding({connectionId: r.connectionId}); setParameters(JSON.stringify(r.parameters ?? {})); setResult(r.result); setMeasured(captureAnalysis({question: '', sql: r.sql, connectionId: r.connectionId, parameters: r.parameters ?? {}, result: r.result})); setSelected(undefined); setStatus('Loaded the last executed query.');} else setStatus('No query has been run yet. Ask a question below.');}, e => setError(e.message));
  const load = () => action('analysis_list').then(r => setSaved(r.analyses), e => setError(e.message));
  useEffect(() => {load(); loadLast();}, []);
  const run = async (label: string, fn: () => Promise<void>) => {setBusy(true); setTask(label); setError(''); try {await fn();} catch (e) {setError((e as Error).message);} finally {setBusy(false); setTask('');}};
  const ask = () => run('AI is writing your SQL…', async () => {setResult(undefined); setMeasured(undefined); setSql(''); setBinding(undefined); setParameters('{}'); setSelected(undefined); setStatus(''); const r = await request('GENERATE_SQL', {input: question}); setStatus(r.message || 'SQL is ready. Review it in step 2.'); if (r.sql) {setSql(r.sql); setBinding(r); setParameters(JSON.stringify(r.parameters ?? {}));}});
  const execute = () => run('Running your reviewed query…', async () => {
    setResult(undefined); setStatus(''); if (!binding?.connectionId) throw new Error('Generate a query or open a saved analysis to choose its database.');
    const reviewed = {question, sql, connectionId: binding.connectionId, parameters: readParameters(parameters)};
    const current = await request('GET_GLOSSARY', {}); if (selected && current.revision !== selected.glossaryRevision) throw new Error('Business definitions changed. Review them and save this analysis again before running.');
    const definitions = current.terms.filter((t: any) => !t.connectionId || t.connectionId === reviewed.connectionId);
    const r = await request('EXECUTE_SQL', {sql: reviewed.sql, dbConfigId: reviewed.connectionId, schemaFingerprint: binding.schemaFingerprint, parameters: reviewed.parameters});
    setResult(r); setMeasured(captureAnalysis({...reviewed, definitions, result: r})); setStatus('Query finished on ' + target + '.');
  });
  const save = () => run('Saving this analysis…', async () => {const entry = await action('analysis_save', {id: selected?.id, name, question, sql, connectionId: binding?.connectionId, parameters: readParameters(parameters)}); setSelected(entry); setBinding(entry); setStatus('Analysis saved with the current schema and business definitions.'); load();});
  const exportData = () => run('Exporting results…', async () => {if (measured) await request('EXPORT_FILE', {name: (name || 'verbis-results') + '.csv', content: resultCsv(measured)});});
  const exportReport = () => run('Exporting your report…', async () => {if (measured) await request('EXPORT_FILE', {name: (name || 'verbis-analysis') + '.md', content: analysisReport(measured, name || 'Verbis analysis')});});
  return <section className="workspace-section"><h1>Ask your data</h1><p className="page-intro">Ask in plain language. Review the SQL before running it. Follow-up questions keep the current conversation context.</p>
    <Step number={1} title="Ask a question"><label>Your question or follow-up<textarea aria-label="Your question or follow-up" rows={3} value={question} onChange={e => setQuestion(e.target.value)} placeholder="Show employees earning more than 8,000"/></label>
      <div className="workspace-actions"><button disabled={busy || !question.trim() || !!aiHelp} onClick={ask}>Write SQL with AI</button>{busy && <button className="secondary" onClick={() => postMessage('CANCEL_REQUEST', {})}>Cancel</button>}</div><p className="help-text">This action uses AI allowance. A follow-up can be “Only those in IT.”</p>
      {aiHelp && <div className="setup-notice"><p>{aiHelp}</p><button className="text-button" onClick={onOpenSettings}>Open AI settings</button></div>}
    </Step>
    {sql && <Step number={2} title="Review the query, then run it"><p>Database: <strong>{target || 'Not selected'}</strong>. Running this SQL does not use AI.</p>
      <label>Review SQL<textarea aria-label="Review SQL" rows={7} className="sql-editor" value={sql} onChange={e => {setSql(e.target.value); setResult(undefined);}}/></label>
      <ParametersEditor value={parameters} onChange={v => {setParameters(v); setResult(undefined);}} onValidityChange={setParametersValid}/>
      <details><summary>Query context</summary><p>Bound database: {binding?.connectionId}. {binding?.schemaFingerprint ? 'Schema revision: ' + binding.schemaFingerprint : 'The schema is checked when you run.'}</p></details>
      <button disabled={busy || !sql || !binding || !parametersValid} onClick={execute}>Run query</button>
    </Step>}
    {status && <p role="status">{status}</p>}{error && <p role="alert">{error}</p>}{busy && <p role="status">{task}</p>}
    {result && <Step number={3} title="View and save results"><p>{result.rowCount} rows · {result.executionTimeMs} ms · {result.truncated ? 'Result limit reached. Narrow the query to see a complete result.' : 'All returned rows are shown within the query limit.'}</p>
      <DataGrid columns={result.columns} rows={result.rows}/>{result.chart && <figure><figcaption>{result.chart.valueColumn} by {result.chart.labelColumn} · {result.chart.reason}</figcaption>{result.chart.points.map((p: any, i: number) => <div className="measured-bar" key={i}><span>{p[result.chart.labelColumn]}</span><meter aria-label={String(p[result.chart.labelColumn])} min={0} max={Math.max(1, ...result.chart.points.map((r: any) => r[result.chart.valueColumn]))} value={p[result.chart.valueColumn]}/><span>{p[result.chart.valueColumn]}</span></div>)}</figure>}
      <div className="workspace-actions"><button className="secondary" disabled={busy} onClick={exportData}>Download CSV</button><button className="secondary" disabled={busy} onClick={exportReport}>Export readable report</button></div>
    </Step>}
    {sql && <details><summary>Save this analysis for later</summary><p>Save the query and its reviewed business definitions. Saved analyses can be reopened and run again.</p><div className="workspace-actions"><label>Analysis name<input value={name} onChange={e => setName(e.target.value)} placeholder="IT salary review"/></label><button disabled={busy || !name.trim() || !binding || !parametersValid} onClick={save}>Save analysis</button></div></details>}
    <h2>Saved analyses</h2>{!saved.length && <EmptyState title="No saved analyses yet">Generate a query, then use “Save this analysis for later.”</EmptyState>}
    {saved.map(a => <article className="saved-item" key={a.id}><strong>{a.name}</strong><p>{connections.find(c => c.id === a.connectionId)?.name ?? a.connectionId}</p><div className="workspace-actions"><button className="secondary" disabled={busy} onClick={() => run('Opening analysis…', async () => {await request('OPEN_ANALYSIS', {id: a.id}); setSelected(a); setName(a.name); setQuestion(a.question); setSql(a.sql); setBinding(a); setParameters(JSON.stringify(a.parameters)); setResult(undefined); setStatus('Opened analysis. Review the query before running.');})}>Open analysis</button><button className="text-button" disabled={busy} onClick={() => run('Removing saved analysis…', async () => {await action('analysis_delete', {id: a.id}); load();})}>Remove saved analysis</button></div></article>)}
    <button className="text-button" disabled={busy} onClick={loadLast}>Load the last query and results</button>
    {selected && <details><summary>Definitions saved with this analysis</summary><pre>{JSON.stringify(selected.definitions, null, 2)}</pre></details>}
  </section>;
}
