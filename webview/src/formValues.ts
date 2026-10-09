export type ParameterValue = string | number | boolean | null;
export function readParameters(text: string): Record<string, ParameterValue> {
  let parsed: unknown;
  try {parsed = JSON.parse(text);} catch {throw new Error('Check parameter values: the advanced JSON is not valid.');}
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Parameters must contain named values, not a list.');
  if (Object.values(parsed).some(v => (v !== null && !['string', 'number', 'boolean'].includes(typeof v)) || (typeof v === 'number' && !Number.isFinite(v)))) throw new Error('Use text, finite numbers, true/false, or an empty value for each parameter.');
  return parsed as Record<string, ParameterValue>;
}
export function parameterValue(text: string, type: string): ParameterValue {
  if (type === 'null') return null;
  if (type === 'boolean') {
    if (!['true', 'false'].includes(text)) throw new Error('Choose true or false.');
    return text === 'true';
  }
  if (type === 'number') {
    if (!text.trim() || !Number.isFinite(Number(text))) throw new Error('Enter a valid number.');
    return Number(text);
  }
  return text;
}
export function readFieldMappings(text: string): Record<string, any>[] {
  let parsed: unknown;
  try {parsed = JSON.parse(text);} catch {throw new Error('Check comparison columns: the advanced JSON is not valid.');}
  if (!Array.isArray(parsed) || parsed.some(v => !v || Array.isArray(v) || typeof v !== 'object')) throw new Error('Comparison columns must be a list of column mappings.');
  return parsed;
}
