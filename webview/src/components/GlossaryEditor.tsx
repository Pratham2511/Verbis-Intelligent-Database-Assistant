import {useState, useEffect, type ReactNode} from 'react';
import type {GlossaryTerm} from '../../../src/types';
import {request} from '../vscode';
import {useConnectionList, EmptyState} from './WorkspaceGuide';
import {UnitsEditor} from './ValueEditors';

export default function GlossaryEditor() {
  const [terms, setTerms] = useState<GlossaryTerm[]>([]), [editing, setEditing] = useState<GlossaryTerm | null>(null);
  const [unitsText, setUnitsText] = useState('{}'), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const {connections, active: activeId} = useConnectionList();
  const active = connections.find(c => c.id === activeId);
  useEffect(() => {request('GET_GLOSSARY', {}).then(x => setTerms(x.terms), e => setError(e.message));}, []);
  const beginEdit = (term: GlossaryTerm) => {setEditing({...term}); setUnitsText(JSON.stringify(term.units ?? {})); setError('');};
  const startNew = () => beginEdit({term: '', sqlTemplate: '', aliases: [], description: '', dialect: active?.dialect || 'sqlite', connectionId: active?.id, units: {}, owner: 'me', lastValidated: new Date().toISOString().slice(0, 10)});
  const save = async () => {
    if (!editing?.term.trim()) return;
    setBusy(true); setError('');
    try {
      let units; try {units = JSON.parse(unitsText);} catch {throw new Error('Check the column units before saving.');}
      if (!units || Array.isArray(units) || Object.values(units).some(v => typeof v !== 'string')) throw new Error('Column units must be text, such as INR/monthly.');
      await request('GLOSSARY_SAVED', {...editing, units}); const store = await request('GET_GLOSSARY', {}); setTerms(store.terms); setEditing(null);
    } catch (e) {setError((e as Error).message);} finally {setBusy(false);}
  };
  return <section className="workspace-section"><h1>Business definitions</h1><p className="page-intro">Give business terms a consistent meaning. For example, define “high salary” once so matching questions use your reviewed salary rule.</p>
    {!editing && <button onClick={startNew}>Add a definition</button>}
    {error && <p role="alert">{error}</p>}
    {editing ? <div className="definition-editor"><h2>{terms.some(t => t.term === editing.term) ? 'Edit definition' : 'New definition'}</h2>
      <Field label="Term people will ask about"><input value={editing.term} onChange={e => setEditing({...editing, term: e.target.value})} placeholder="high salary"/></Field>
      <Field label="Meaning in plain language"><input value={editing.description} onChange={e => setEditing({...editing, description: e.target.value})} placeholder="Monthly salary above 9,000 INR"/></Field>
      <Field label="Reviewed SQL rule"><textarea value={editing.sqlTemplate} onChange={e => setEditing({...editing, sqlTemplate: e.target.value})} className="sql-editor" rows={3} placeholder="salary > 9000"/></Field>
      <p className="help-text">Use a read-only SQL expression or a complete SELECT query. Review it against the correct database before saving.</p>
      <Field label="Database this rule belongs to"><select value={editing.connectionId || ''} onChange={e => setEditing({...editing, connectionId: e.target.value || undefined, dialect: connections.find(c => c.id === e.target.value)?.dialect || editing.dialect})}><option value="">All databases — check the rule works for each</option>{connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="Other names for this term (optional)"><input value={editing.aliases.join(', ')} onChange={e => setEditing({...editing, aliases: e.target.value.split(',').map(s => s.trim()).filter(Boolean)})} placeholder="high income, highly paid"/></Field>
      <UnitsEditor value={unitsText} onChange={setUnitsText}/>
      <details><summary>Optional: SQL type and owner</summary><div className="form-columns"><Field label="SQL database type"><select value={editing.dialect} onChange={e => setEditing({...editing, dialect: e.target.value})}><option value="sqlite">SQLite</option><option value="postgresql">PostgreSQL</option><option value="mysql">MySQL</option></select></Field><Field label="Reviewed by"><input value={editing.owner} onChange={e => setEditing({...editing, owner: e.target.value})}/></Field></div></details>
      <div className="workspace-actions"><button onClick={save} disabled={busy || !editing.term.trim() || !editing.sqlTemplate.trim()}>{busy ? 'Saving…' : 'Save reviewed definition'}</button><button className="secondary" disabled={busy} onClick={() => {setEditing(null); setError('');}}>Cancel</button></div>
    </div> : <>{!terms.length && <EmptyState title="No definitions saved yet">Add a term, describe its meaning, and enter a reviewed SQL rule. Saving a definition does not run AI.</EmptyState>}
      {terms.map(t => <article className="saved-item" key={`${t.connectionId ?? '*'}:${t.term}`}><h2>{t.term}</h2><p>{t.description || 'No description provided.'}</p><p className="help-text">{connections.find(c => c.id === t.connectionId)?.name ?? (t.connectionId || 'All databases')}{t.aliases.length ? ' · Also called: ' + t.aliases.join(', ') : ''}</p>
        <details><summary>View SQL rule</summary><pre>{t.sqlTemplate}</pre></details><button className="secondary" onClick={() => beginEdit(t)}>Edit definition</button></article>)}</>}
  </section>;
}
function Field({label, children}: {label: string; children: ReactNode}) {return <label><span>{label}</span>{children}</label>;}
