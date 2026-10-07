/** Export the measured execution, even while the next question is being edited. */
export interface AnalysisSnapshot {
  question: string;
  sql: string;
  connectionId: string;
  parameters: Record<string, unknown>;
  definitions?: unknown[];
  result: {columns: string[]; rows: Record<string, unknown>[]; rowCount: number; executionTimeMs: number; truncated: boolean};
}
export const captureAnalysis = (value: AnalysisSnapshot): AnalysisSnapshot => structuredClone(value);
const csvCell = (value: unknown) => {
  let text = String(value ?? '');
  // Quoting alone does not stop spreadsheet formula interpretation.
  if (typeof value === 'string' && /^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
};
export function resultCsv(snapshot: AnalysisSnapshot): string {
  const {columns, rows} = snapshot.result;
  return [columns.map(csvCell).join(','), ...rows.map(row => columns.map(c => csvCell(row[c])).join(','))].join('\r\n');
}
const tableCell = (value: unknown) => String(value ?? 'NULL').replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ');
export function analysisReport(snapshot: AnalysisSnapshot, title: string): string {
  const {result} = snapshot;
  const fence = '`'.repeat(Math.max(3, ...(snapshot.sql.match(/`+/g) ?? []).map(s => s.length + 1)));
  return `# ${title.replace(/[\r\n]+/g, ' ')}\n\nQuestion: ${snapshot.question || 'Original question was not captured for this execution.'}\n\nConnection: ${snapshot.connectionId}\n\n## Executed SQL\n\n${fence}sql\n${snapshot.sql}\n${fence}\n\nExecuted parameters: ${JSON.stringify(snapshot.parameters)}\n\nReviewed definitions at execution: ${snapshot.definitions ? JSON.stringify(snapshot.definitions) : 'Not captured for this execution.'}\n\n${result.rowCount} rows returned in ${result.executionTimeMs} ms. Truncated: ${result.truncated}.\n\n| ${result.columns.map(tableCell).join(' | ')} |\n| ${result.columns.map(() => '---').join(' | ')} |\n${result.rows.map(row => '| ' + result.columns.map(c => tableCell(row[c])).join(' | ') + ' |').join('\n')}`;
}
