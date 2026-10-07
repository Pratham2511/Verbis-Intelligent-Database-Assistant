import {describe,it,expect,vi,afterEach} from 'vitest';
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.resetModules()});
async function fixture(){
 vi.useFakeTimers();const posted:any[]=[];const window=new EventTarget() as any;
 window.acquireVsCodeApi=()=>({postMessage:(message:any)=>posted.push(message),getState:()=>({}),setState:()=>{}});
 vi.stubGlobal('window',window);const {request}=await import('../webview/src/vscode');
 const reply=(payload:any)=>{const event=new Event('message');Object.defineProperty(event,'data',{value:{type:'SQL_GENERATED',requestId:posted[0].requestId,payload}});window.dispatchEvent(event)};
 return {request,posted,reply};
}
describe('webview request deadlines',()=>{
 it('waits for a slow credential choice and resumes its original first question exactly once',async()=>{
  const f=await fixture();const pending=f.request('GENERATE_SQL',{input:'employees above 8000'});let settled=false;pending.then(()=>settled=true,()=>settled=true);
  await vi.advanceTimersByTimeAsync(120000);expect(settled).toBe(false);expect(f.posted).toHaveLength(1);
  f.reply({sql:'SELECT id FROM employees WHERE salary > :threshold',parameters:{threshold:8000}});
  expect(await pending).toMatchObject({parameters:{threshold:8000}});expect(f.posted).toHaveLength(1);
 });
 it('still cancels an execution when its final transport fallback expires',async()=>{
  const f=await fixture();const pending=f.request('EXECUTE_SQL',{sql:'SELECT 1'});const rejection=expect(pending).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(610000);await rejection;expect(f.posted[1].type).toBe('CANCEL_REQUEST');
 });
});
