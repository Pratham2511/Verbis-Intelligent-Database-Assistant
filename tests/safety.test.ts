import {describe,it,expect,vi} from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
vi.mock('vscode',()=>({EventEmitter:class{event=()=>({dispose(){}});fire(){}},window:{showWarningMessage:vi.fn()}}));
import {WorkspaceService} from '../src/services/WorkspaceService';
import {BackendClient,BackendClientError} from '../src/services/BackendClient';
describe('persistence and transport regressions',()=>{
 it('retains all simultaneous history writes across instances',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'verbis-test-'));
  try{
   const a=new WorkspaceService(dir),b=new WorkspaceService(dir);
   await Promise.all(Array.from({length:25},(_,i)=>(i%2?a:b).appendHistory({id:String(i),sql:'SELECT 1',nlInput:'test',success:true,timestamp:i})));
   expect((await a.readHistory()).length).toBe(25);
   await Promise.all(Array.from({length:20},(_,i)=>a.upsertConversation('chat',[{role:'user',content:String(i),timestamp:i}])));
   expect((await a.getActiveConversation())?.turns).toHaveLength(20);
  }finally{await fs.rm(dir,{recursive:true,force:true})}
 });
 it('preserves malformed persisted data and reports the failure',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'verbis-corrupt-'));try{const a=new WorkspaceService(dir);const file=path.join(dir,'.qmind','history.json');await fs.writeFile(file,'{invalid');await expect(a.appendHistory({id:'1',sql:'SELECT 1',nlInput:'test',success:true,timestamp:1})).rejects.toThrow('preserved');expect(await fs.readFile(file,'utf8')).toBe('{invalid')}finally{await fs.rm(dir,{recursive:true,force:true})}
 });
 it('passes caller cancellation to fetch and preserves its reason',async()=>{
  const controller=new AbortController();
  vi.stubGlobal('fetch',vi.fn((_:unknown,o:{signal:AbortSignal})=>new Promise((_,reject)=>{o.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')))})));
  const pending=new BackendClient('http://localhost').execute({sql:'SELECT 1',dbConfigId:'hr'},controller.signal);
  controller.abort();await expect(pending).rejects.toMatchObject({kind:'cancelled'});vi.unstubAllGlobals();
 });
 it('sends the impact contract with its bound connection',async()=>{
  const fetcher=vi.fn(async()=>({ok:true,json:async()=>({})}));vi.stubGlobal('fetch',fetcher);
  await new BackendClient('http://localhost').analyzeImpact({ddl:'ALTER TABLE t DROP COLUMN x',dbConfigId:'hr'});
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({proposed_ddl:'ALTER TABLE t DROP COLUMN x',db_config_id:'hr'});vi.unstubAllGlobals();
 });
});
