import {useEffect, useState} from 'react';
import {readParameters, parameterValue, readFieldMappings, type ParameterValue} from '../formValues';

export function ParametersEditor({value, onChange, label = 'Query values', onValidityChange}: {value: string; onChange: (v: string) => void; label?: string; onValidityChange?: (valid: boolean) => void}) {
  const [newName, setNewName] = useState(''), [errors, setErrors] = useState<Record<string, string>>({});
  let values: Record<string, ParameterValue> = {}, invalid = '';
  try {values = readParameters(value);} catch (e) {invalid = (e as Error).message;}
  const currentErrors = Object.entries(errors).filter(([name]) => Object.hasOwn(values, name));
  const valid = !invalid && !currentErrors.length;
  useEffect(() => {onValidityChange?.(valid);}, [valid, onValidityChange]);
  const update = (key: string, text: string, type: string) => {
    try {const next = parameterValue(text, type); onChange(JSON.stringify({...values, [key]: next})); setErrors(old => {const next = {...old}; delete next[key]; return next;});}
    catch (e) {setErrors(old => ({...old, [key]: (e as Error).message}));}
  };
  return <details className="optional-fields" open={!!invalid || undefined}>
    <summary>{label} {Object.keys(values).length ? `(${Object.keys(values).length})` : '(optional)'}</summary>
    <p className="help-text">For SQL with values such as <code>:threshold</code>, add the name <code>threshold</code> and its value below. Leave this empty if your query has no named values.</p>
    {Object.entries(values).map(([name, val]) => <div className="parameter-row" key={name}>
      <ParameterInput name={name} label={label} value={val} onChange={text => update(name, text, typeof val)}/>
      <label>Value type<select aria-label={`${name} value type`} value={val === null ? 'null' : typeof val} onChange={e => update(name, e.target.value === 'number' ? '0' : e.target.value === 'boolean' ? 'true' : String(val ?? ''), e.target.value)}>
        <option value="string">Text</option><option value="number">Number</option><option value="boolean">True / false</option><option value="null">Empty (NULL)</option>
      </select></label>
      <button className="text-button" onClick={() => {const next = {...values}; delete next[name]; onChange(JSON.stringify(next)); setErrors(old => {const next = {...old}; delete next[name]; return next;});}}>Remove {name}</button>
    </div>)}
    <div className="workspace-actions"><label>Value name<input value={newName} onChange={e => setNewName(e.target.value)} placeholder="threshold"/></label>
      <button className="secondary" disabled={!!invalid || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(newName) || Object.hasOwn(values, newName)} onClick={() => {onChange(JSON.stringify({...values, [newName]: ''})); setNewName('');}}>Add value</button></div>
    {invalid && <p role="alert">{invalid}</p>}{currentErrors.map(([name, error]) => <p role="alert" key={name}>{name}: {error}</p>)}
    <details><summary>Advanced: edit JSON</summary><label>Named values as JSON<textarea aria-label={`${label} JSON`} value={value} onChange={e => onChange(e.target.value)} rows={3}/></label></details>
  </details>;
}
function ParameterInput({name, label, value, onChange}: {name: string; label: string; value: ParameterValue; onChange: (text: string) => void}) {
  const [draft, setDraft] = useState(String(value ?? ''));
  useEffect(() => {setDraft(String(value ?? ''));}, [value]);
  return <label>{name}{typeof value === 'boolean' ? <select aria-label={`${label}: ${name}`} value={String(value)} onChange={e => onChange(e.target.value)}><option value="true">True</option><option value="false">False</option></select>
    : <input aria-label={`${label}: ${name}`} value={draft} disabled={value === null} inputMode={typeof value === 'number' ? 'decimal' : undefined} onChange={e => {setDraft(e.target.value); onChange(e.target.value);}}/>}</label>;
}
const periods = [{value: 'unknown', label: 'Choose a period'}, {value: 'monthly', label: 'Monthly'}, {value: 'annual', label: 'Yearly'}, {value: 'none', label: 'Not an amount'}];
export function FieldMappingsEditor({value, onChange}: {value: string; onChange: (v: string) => void}) {
  let mappings: Record<string, any>[] = [], error = '';
  try {mappings = readFieldMappings(value);} catch (e) {error = (e as Error).message;}
  const update = (i: number, name: string, next: string) => onChange(JSON.stringify(mappings.map((m, n) => n === i ? {...m, [name]: next} : m)));
  return <section className="mapping-editor" aria-label="Columns to compare">
    <h3>Columns to compare</h3><p>Choose matching column names from both query results. For amounts, confirm the period and currency on each side.</p>
    {mappings.map((m, i) => <fieldset key={i}><legend>Comparison {i + 1}</legend>
      <div className="form-columns">{(['left', 'right'] as const).map(side => <div key={side}>
        <label>{side === 'left' ? 'First' : 'Second'} column<input value={m[side] ?? ''} onChange={e => update(i, side, e.target.value)} placeholder="salary"/></label>
        <label>Period<select value={m[`${side}Period`] ?? 'unknown'} onChange={e => update(i, `${side}Period`, e.target.value)}>{periods.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
        <label>Currency (if an amount)<input value={m[`${side}Currency`] ?? ''} onChange={e => update(i, `${side}Currency`, e.target.value)} placeholder="INR, USD, EUR…"/></label>
      </div>)}</div>
      <details><summary>Date columns</summary><label>Compare as<select value={m.type ?? ''} onChange={e => update(i, 'type', e.target.value)}><option value="">Number or text</option><option value="date">Date</option></select></label>
        {m.type === 'date' && <div className="form-columns"><label>First date format<input value={m.leftDateFormat ?? ''} onChange={e => update(i, 'leftDateFormat', e.target.value)} placeholder="%Y-%m-%d"/></label><label>Second date format<input value={m.rightDateFormat ?? ''} onChange={e => update(i, 'rightDateFormat', e.target.value)} placeholder="%Y-%m-%d"/></label></div>}
      </details>
      <button className="text-button" onClick={() => onChange(JSON.stringify(mappings.filter((_, n) => n !== i)))}>Remove comparison {i + 1}</button>
    </fieldset>)}
    {error && <p role="alert">{error}</p>}
    <button className="secondary" disabled={!!error} onClick={() => onChange(JSON.stringify([...mappings, {left: '', right: '', leftPeriod: 'unknown', rightPeriod: 'unknown', leftCurrency: '', rightCurrency: ''}]))}>Add a column comparison</button>
    <p className="help-text">Yearly amounts are divided by 12 when compared with monthly amounts. Currencies must match; Verbis does not convert exchange rates. Choose “Not an amount” for text or dates.</p>
    <details><summary>Advanced: edit mappings as JSON</summary><label>Column mappings JSON<textarea value={value} onChange={e => onChange(e.target.value)} rows={4}/></label></details>
  </section>;
}

export function UnitsEditor({value, onChange}: {value: string; onChange: (value: string) => void}) {
  const [newName, setNewName] = useState('');
  let units: Record<string, string> = {}, error = '';
  try {const parsed = readParameters(value); if (Object.values(parsed).some(v => typeof v !== 'string')) throw new Error('Each unit must be text, such as INR/monthly.'); units = parsed as Record<string, string>;}
  catch (e) {error = (e as Error).message;}
  return <details><summary>Optional: define units for columns</summary><p className="help-text">For example, column “salary” with unit “INR/monthly.” Confirm units with your data owner before saving.</p>
    {Object.entries(units).map(([column, unit]) => <div className="workspace-actions" key={column}><label>{column}<input value={unit} onChange={e => onChange(JSON.stringify({...units, [column]: e.target.value}))} placeholder="INR/monthly"/></label><button className="text-button" onClick={() => {const next = {...units}; delete next[column]; onChange(JSON.stringify(next));}}>Remove {column}</button></div>)}
    <div className="workspace-actions"><label>Column name<input value={newName} onChange={e => setNewName(e.target.value)} placeholder="salary"/></label><button className="secondary" disabled={!!error || !newName.trim() || Object.hasOwn(units, newName.trim())} onClick={() => {onChange(JSON.stringify({...units, [newName.trim()]: ''})); setNewName('');}}>Add column unit</button></div>
    {error && <p role="alert">{error}</p>}<details><summary>Advanced: units as JSON</summary><label>Units JSON<textarea value={value} onChange={e => onChange(e.target.value)}/></label></details>
  </details>;
}
