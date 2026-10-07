import {beforeEach,describe,expect,it,vi} from 'vitest';

const host=vi.hoisted(()=>({confirm:vi.fn()}));
vi.mock('vscode',()=>({
 window:{showWarningMessage:host.confirm},
 workspace:{getConfiguration:()=>({get:(name:string,fallback:unknown)=>name==='execution.timeoutSeconds'?37:fallback})},
}));
import {VerbisPanel} from '../src/panels/VerbisPanel';

function fixture(dialect='sqlite'){
 // Invoke the actual message handler with a controlled host, without rendering.
 const panel=Object.create(VerbisPanel.prototype) as any;
 const client={execute:vi.fn(async()=>({})),refreshSchema:vi.fn(async()=>({}))};
 const post=vi.fn();
 Object.assign(panel,{initialClient:client,panel:{webview:{postMessage:post}},workspace:{
  getActiveConnectionId:async()=> 'reviewed-target',
  readConfig:async()=>({connections:[{id:'reviewed-target',dialect}]}),
 }});
 const apply=()=>panel.onMessage({type:'SCHEMA_EXECUTE',requestId:'ddl-review',payload:{ddl:'CREATE TABLE reviewed(id INTEGER)',dialect:'sqlite'}});
 return {client,post,apply};
}

describe('reviewed schema application acknowledgements',()=>{
 beforeEach(()=>{host.confirm.mockReset();host.confirm.mockResolvedValue('Apply DDL')});
 it('rejects a different database dialect before confirmation or execution',async()=>{
  const f=fixture('postgresql');await f.apply();
  expect(host.confirm).not.toHaveBeenCalled();expect(f.client.execute).not.toHaveBeenCalled();
  expect(f.post).toHaveBeenCalledWith(expect.objectContaining({type:'ERROR',requestId:'ddl-review',payload:{message:expect.stringContaining('dialect does not match')}}));
 });
 it('acknowledges cancelled native confirmation without executing',async()=>{
  host.confirm.mockResolvedValue(undefined);const f=fixture();await f.apply();
  expect(f.client.execute).not.toHaveBeenCalled();
  expect(f.post).toHaveBeenCalledWith({type:'ERROR',requestId:'ddl-review',payload:{message:'Cancelled.'}});
 });
 it('reports applied DDL separately from a failed schema refresh',async()=>{
  const f=fixture();f.client.refreshSchema.mockRejectedValue(new Error('Introspection unavailable'));
  const warning=vi.spyOn(console,'warn').mockImplementation(()=>{});
  try{await f.apply()}finally{warning.mockRestore()}
  expect(f.client.execute).toHaveBeenCalledWith(expect.objectContaining({dbConfigId:'reviewed-target',readOnly:true,timeoutSeconds:37}));
  expect(f.post).toHaveBeenCalledWith({type:'SCHEMA_EXECUTED',requestId:'ddl-review',payload:{refreshed:false}});
 });
 it('reports write rejection without refresh or a success acknowledgement',async()=>{
  const f=fixture();f.client.execute.mockRejectedValue(new Error('Read-only transaction'));
  await f.apply();expect(f.client.refreshSchema).not.toHaveBeenCalled();
  expect(f.post).toHaveBeenCalledTimes(1);
  expect(f.post).toHaveBeenCalledWith({type:'ERROR',requestId:'ddl-review',payload:{message:'Read-only transaction'}});
 });
});
