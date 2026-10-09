import {describe, expect, it} from 'vitest';
import {readParameters, parameterValue, readFieldMappings} from '../webview/src/formValues';
describe('simple fields preserve backend value types', () => {
  it('keeps numeric, boolean, empty and textual parameters distinct', () => {
    const values = {threshold: parameterValue('-8000.5', 'number'), department: parameterValue('IT', 'string'), active: parameterValue('false', 'boolean'), missing: parameterValue('', 'null')};
    expect(readParameters(JSON.stringify(values))).toEqual({threshold: -8000.5, department: 'IT', active: false, missing: null});
  });
  it.each(['', 'Infinity', 'NaN', '-'])('rejects invalid numeric input %j instead of sending a stale or empty value', value => {
    expect(() => parameterValue(value, 'number')).toThrow('valid number');
  });
  it.each(['[]', '{"nested":{}}', '{', 'null', '{"threshold":1e309}'])('rejects invalid parameter structures %j', value => {
    expect(() => readParameters(value)).toThrow();
  });
  it('retains explicit comparison units, date formats and extra reviewed fields', () => {
    const mappings = [{left: 'salary', right: 'amount', leftPeriod: 'annual', rightPeriod: 'monthly', leftCurrency: 'INR', rightCurrency: 'INR', reviewed: true}];
    expect(readFieldMappings(JSON.stringify(mappings))).toEqual(mappings);
    expect(() => readFieldMappings('{}')).toThrow('list');
  });
});
