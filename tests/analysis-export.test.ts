import {describe,it,expect} from 'vitest';
import {captureAnalysis,resultCsv,analysisReport} from '../webview/src/analysisExport';
describe('measured analysis exports',()=>{
 it('retains executed parameters and rows when editable state changes',()=>{
  const draft={question:'Above 8000',sql:'SELECT salary FROM employees WHERE salary > :threshold',connectionId:'hr',parameters:{threshold:8000},definitions:[{term:'salary',units:{salary:'INR/monthly'}}],result:{columns:['salary'],rows:[{salary:8001}],rowCount:1,executionTimeMs:12,truncated:false}};
  const measured=captureAnalysis(draft);draft.parameters.threshold=12000;draft.result.rows[0].salary=99000;draft.definitions[0].units.salary='USD/annual';
  const report=analysisReport(measured,'High earners');
  expect(report).toContain('"threshold":8000');expect(report).toContain('| 8001 |');expect(report).toContain('INR/monthly');expect(report).not.toContain('99000');
 });
 it('quotes CSV text, neutralizes text formulas, preserves negative numbers and labels missing provenance',()=>{
  const measured=captureAnalysis({question:'',sql:'SELECT value',connectionId:'fixture',parameters:{},result:{columns:['value'],rows:[{value:'=HYPERLINK("bad")'},{value:-12},{value:'a,b\nline'}],rowCount:3,executionTimeMs:2,truncated:true}});
  expect(resultCsv(measured)).toBe('"value"\r\n"\'=HYPERLINK(""bad"")"\r\n"-12"\r\n"a,b\nline"');
  expect(analysisReport(measured,'Loaded')).toContain('Not captured for this execution.');
 });
});
