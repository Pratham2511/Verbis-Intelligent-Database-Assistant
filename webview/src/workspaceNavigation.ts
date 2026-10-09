export const pages = {
  home: {label: 'Start', description: 'Connect your data, choose AI, and ask your first question.'},
  analysis: {label: 'Ask your data', description: 'Ask a question, review the SQL, then run it.'},
  datasets: {label: 'Import CSV', description: 'Preview a file and check its columns before importing.'},
  schema: {label: 'Tables', description: 'Browse your database tables, columns, and relationships.'},
  connections: {label: 'Settings', description: 'Choose your database and AI provider.'},
  project: {label: 'Find code references', description: 'Find Python, SQLAlchemy, and SQL references to your data.'},
  forensics: {label: 'Explain query results', description: 'Check why records appear, disappear, or repeat.'},
  rehearsal: {label: 'Test database changes', description: 'Try supported changes on a temporary SQLite copy.'},
  reconcile: {label: 'Compare datasets', description: 'Match two query results and review differences.'},
  createdb: {label: 'Design new tables', description: 'Describe tables, review generated SQL, then choose whether to apply it.'},
  tree: {label: 'Query history', description: 'Revisit questions, compare queries, and mark useful versions.'},
  glossary: {label: 'Business definitions', description: 'Teach Verbis the reviewed meaning of terms such as “high salary.”'},
  robustness: {label: 'Predict change impact', description: 'View estimates for saved queries. This tool does not execute tests.'},
} as const;
export type WorkspacePage = keyof typeof pages;
export const mainPages: WorkspacePage[] = ['home', 'analysis', 'datasets', 'schema', 'connections'];
export const toolPages: WorkspacePage[] = ['project', 'forensics', 'rehearsal', 'reconcile', 'createdb', 'tree', 'glossary', 'robustness'];
export function isWorkspacePage(value: unknown): value is WorkspacePage {
  return typeof value === 'string' && Object.hasOwn(pages, value);
}
