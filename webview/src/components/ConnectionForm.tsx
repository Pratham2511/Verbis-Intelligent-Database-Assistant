import {useState, useEffect, type ReactNode} from 'react';
import {request, postMessage} from '../vscode';
import {useConnectionList, EmptyState} from './WorkspaceGuide';

const emptyForm = () => ({id: '', sslCa: '', name: '', dialect: 'sqlite', host: 'localhost', port: 0, database: '', user: '', password: '', ssl: false});
export default function ConnectionForm({editingConnection}: {editingConnection?: any}) {
  const [form, setForm] = useState(emptyForm), [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const {connections, active} = useConnectionList();
  useEffect(() => {if (editingConnection) {setForm({...editingConnection, password: '', sslCa: editingConnection.sslCa || ''}); setOpen(true);}}, [editingConnection]);
  const submit = async () => {
    setBusy(true); setError(''); setSaved(false);
    try {const result = await request('CONNECTION_FORM_SAVE', form); setSaved(true); setForm({...form, id: result.connectionId, password: ''}); setOpen(false);}
    catch (e) {setError((e as Error).message);}
    finally {setBusy(false);}
  };
  const edit = (c: any) => {setForm({...c, password: '', sslCa: c.sslCa || ''}); setOpen(true); setSaved(false); setError('');};
  const remove = async (id: string) => {
    setBusy(true); setError('');
    try {const result = await request('DELETE_CONNECTION', {id}); if (result.deleted && form.id === id) {setForm(emptyForm()); setOpen(false); setSaved(false);}}
    catch (e) {setError((e as Error).message);}
    finally {setBusy(false);}
  };
  const pickFile = async () => {
    setBusy(true); setError('');
    try {const r = await request('PICK_DATABASE_FILE', {}); if (r.path) setForm({...form, database: r.path});}
    catch (e) {setError((e as Error).message);}
    finally {setBusy(false);}
  };
  return <section className="settings-group" aria-label="Database settings">
    <h2>Your databases</h2><p>Choose the database Verbis should use. Adding a connection checks that Verbis can read its tables.</p>
    {!connections.length && <EmptyState title="No database connected yet">Add an existing database below, or use Import CSV to create a local dataset.</EmptyState>}
    <div className="connection-list">{connections.map(c => <article key={c.id} className="connection-row">
      <div><strong>{c.name}</strong><span className="help-text">{c.dialect === 'sqlite' ? 'SQLite file' : c.dialect === 'mysql' ? 'MySQL server' : 'PostgreSQL server'}{c.id === active ? ' · Selected' : ''}</span></div>
      <div className="workspace-actions"><button className="secondary" disabled={busy || c.id === active} onClick={() => postMessage('SELECT_CONNECTION', {id: c.id})}>{c.id === active ? 'Selected' : 'Use this database'}</button>
        <button className="text-button" disabled={busy} onClick={() => edit(c)}>Edit</button><button className="text-button" disabled={busy} onClick={() => remove(c.id)}>Remove connection</button></div>
    </article>)}</div>
    <button className="secondary" disabled={busy} onClick={() => {setForm(emptyForm()); setOpen(true); setSaved(false); setError('');}}>Add a database</button>
    {saved && <p role="status" className="connection-success">Database checked and saved. Choose “Use this database” to select it.</p>}
    {error && <p role="alert">{error}</p>}
    {(open || !connections.length) && <div className="connection-editor">
      <h3>{form.id ? 'Edit database' : 'Connect a database'}</h3>
      <Row label="Name to show in Verbis"><input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="My employee database"/></Row>
      <Row label="Database type"><select value={form.dialect} onChange={e => setForm({...form, dialect: e.target.value, port: e.target.value === 'mysql' ? 3306 : e.target.value === 'postgresql' ? 5432 : 0, ...(e.target.value === 'sqlite' ? {user: '', password: '', ssl: false, sslCa: ''} : {})})}>
        <option value="sqlite">SQLite — a file on your computer</option><option value="postgresql">PostgreSQL — a database server</option><option value="mysql">MySQL — a database server</option>
      </select></Row>
      {form.dialect === 'sqlite' ? <Row label="SQLite database file"><div className="workspace-actions"><input aria-label="SQLite database file" value={form.database} onChange={e => setForm({...form, database: e.target.value})} placeholder="Choose an existing .db or .sqlite file"/><button className="secondary" disabled={busy} onClick={pickFile}>Choose file</button></div></Row> : <>
        <div className="form-columns"><Row label="Server address"><input value={form.host} onChange={e => setForm({...form, host: e.target.value})} placeholder="localhost"/></Row>
          <Row label="Port"><input type="number" value={form.port} onChange={e => setForm({...form, port: Number(e.target.value)})}/></Row></div>
        <Row label="Database name"><input value={form.database} onChange={e => setForm({...form, database: e.target.value})}/></Row>
        <Row label="Username"><input value={form.user} onChange={e => setForm({...form, user: e.target.value})}/></Row>
        <Row label="Password"><input type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} placeholder={form.id ? 'Leave blank to keep the saved password' : ''}/></Row>
        <p className="help-text">Passwords are saved in your system keychain. If secure storage is unavailable, Verbis will report it.</p>
        <label className="checkbox-label"><input type="checkbox" checked={form.ssl} onChange={e => setForm({...form, ssl: e.target.checked})}/>Use an encrypted connection (TLS)</label>
        {form.ssl && <Row label="CA certificate file (optional)"><input value={form.sslCa} onChange={e => setForm({...form, sslCa: e.target.value})}/><span className="help-text">Verbis checks certificates and server names.</span></Row>}
      </>}
      <div className="workspace-actions"><button onClick={submit} disabled={busy || !form.name.trim() || !form.database.trim() || (form.dialect !== 'sqlite' && !form.user.trim())}>{busy ? 'Checking database…' : 'Check and save database'}</button>
        {connections.length > 0 && <button className="secondary" disabled={busy} onClick={() => {setOpen(false); setForm(emptyForm()); setError('');}}>Cancel</button>}</div>
      {(!form.name.trim() || !form.database.trim() || (form.dialect !== 'sqlite' && !form.user.trim())) && <p className="help-text">Enter a name and {form.dialect === 'sqlite' ? 'choose a database file' : 'fill in the database name and username'} to continue.</p>}
    </div>}
  </section>;
}
function Row({label, children}: {label: string; children: ReactNode}) {
  return <label><span>{label}</span>{children}</label>;
}
