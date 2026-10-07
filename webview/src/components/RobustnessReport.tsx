// ============================================================================
// RobustnessReport.tsx — Schema evolution test result display
// Implements Novel Contribution #16 (Schema Evolution Simulationing Suite).
// ============================================================================
import { useState } from 'react';
import type { RobustnessReport as Report } from '../../../src/types';
import { request } from '../vscode';

const PERTURBATION_LABELS: Record<string, string> = {
  column_rename: 'Column Rename',
  column_type_change: 'Column Type Change',
  column_delete: 'Column Deletion',
  table_rename: 'Table Rename',
  table_delete: 'Table Deletion',
  fk_change: 'Foreign Key Add/Remove',
  index_change: 'Index Add/Remove',
  nullable_change: 'NOT NULL Constraint Change',
  default_value_change: 'Default Value Change',
  view_change: 'View Definition Change',
};

export default function RobustnessReport() {
  const [report, setReport] = useState<Report | null>(null);
  const [running, setRunning] = useState(false);

  const [error,setError]=useState('');
  const run = async () => {
    setRunning(true);setError('');
    try{setReport(await request('ROBUSTNESS_REQUESTED',{}))}catch(e){setError((e as Error).message)}finally{setRunning(false)}
  };

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-base font-semibold">Schema Evolution Simulation</h2>
        <button
          onClick={run}
          disabled={running}
          className="bg-qm-accent text-white text-xs px-3 py-1 rounded disabled:opacity-50"
        >
          {running ? 'Running…' : 'Run Test'}
        </button>
      </div>

      <p className="text-xs opacity-70 mb-4">
        Static heuristic simulation over your saved queries. No schema copies or queries are executed.
        Use Change Rehearsal for measured checks on a disposable SQLite snapshot.
      </p>

      {error&&<p role="alert">{error}</p>}
      {!report && !running && (
        <p className="text-xs italic opacity-60">
          Click "Run Test" to inspect static predictions for your saved queries.
        </p>
      )}

      {report && (
        <>
          <div className="border border-qm-border rounded p-3 mb-3">
            <div className="flex items-center gap-4">
              <div className="text-3xl font-bold text-qm-accent">{report.overallScore}%</div>
              <div className="text-xs">
                <p><strong>{report.survivedAll}</strong> of <strong>{report.totalQueries}</strong> queries are predicted to survive.</p>
                <p className="mt-1 opacity-70">
                  Most fragile: <span className="text-qm-bad">{report.mostFragile}</span>
                </p>
                <p className="opacity-70">
                  Most resilient: <span className="text-qm-good">{report.mostResilient}</span>
                </p>
              </div>
            </div>
          </div>

          <table className="w-full text-xs border border-qm-border rounded">
            <thead>
              <tr className="bg-[var(--vscode-editorWidget-background)]">
                <th className="text-left p-2">Perturbation</th>
                <th className="text-right p-2">Predicted breakage</th>
                <th className="text-left p-2">Affected Queries</th>
              </tr>
            </thead>
            <tbody>
              {report.perPerturbation.map(p => (
                <tr key={p.perturbationType} className="border-t border-qm-border">
                  <td className="p-2">{PERTURBATION_LABELS[p.perturbationType] || p.perturbationType}</td>
                  <td className="p-2 text-right" style={{ color: p.breakageRate > 10 ? '#f14c4c' : '#4ec9b0' }}>
                    {p.breakageRate}%
                  </td>
                  <td className="p-2 text-xs opacity-70">
                    {p.affectedQueries.length > 0 ? p.affectedQueries.join(', ') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4">
            <h3 className="text-sm font-semibold mb-2">Recommendations</h3>
            <ul className="text-xs space-y-1 list-disc pl-5">
              {report.recommendations.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
