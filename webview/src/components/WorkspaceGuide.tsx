import {useEffect, useState, type ReactNode} from 'react';
import {onMessage, postMessage} from '../vscode';
import type {DBConfig} from '../../../src/types';

export function Step({number, title, children}: {number: number; title: string; children: ReactNode}) {
  return <section className="workflow-step" aria-label={`Step ${number}: ${title}`}>
    <h3><span className="step-number" aria-hidden="true">{number}</span>{title}</h3>{children}
  </section>;
}
export function EmptyState({title, children}: {title: string; children: ReactNode}) {
  return <div className="empty-state"><strong>{title}</strong><p>{children}</p></div>;
}
export function useConnectionList() {
  const [connections, setConnections] = useState<DBConfig[]>([]);
  const [active, setActive] = useState('');
  useEffect(() => {
    const off = onMessage(m => {
      if (m.type === 'CONNECTIONS_UPDATED') {
        const p = m.payload as {connections: DBConfig[]; activeConnectionId?: string};
        setConnections(p.connections); setActive(p.activeConnectionId ?? '');
      }
    });
    postMessage('GET_CONNECTIONS', {});
    return off;
  }, []);
  return {connections, active};
}
export function ConnectionChoice({label, value, onChange, connections}: {
  label: string; value: string; onChange: (value: string) => void; connections: DBConfig[];
}) {
  return <label>{label}<select value={value} onChange={e => onChange(e.target.value)}>
    <option value="">Choose a database</option>
    {connections.map(c => <option key={c.id} value={c.id}>{c.name} · {c.dialect === 'sqlite' ? 'SQLite' : c.dialect === 'mysql' ? 'MySQL' : 'PostgreSQL'}</option>)}
  </select></label>;
}
