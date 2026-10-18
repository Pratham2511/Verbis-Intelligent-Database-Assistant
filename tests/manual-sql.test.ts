import {describe,expect,it,vi} from 'vitest';
vi.mock('vscode',()=>({workspace:{getConfiguration:()=>({get:(_name:string,fallback:unknown)=>fallback})}}));
import {VerbisPanel} from '../src/panels/VerbisPanel';

function fixture(){
  let active='demo';
  const client={getSchema:vi.fn(async()=>({fingerprint:'demo-revision'})),generate:vi.fn(),execute:vi.fn()};
  const session={startSqlEditor:vi.fn((connectionId:string,schemaFingerprint:string)=>({connectionId,schemaFingerprint})),restoreAnalysis:vi.fn()};
  const workspace={getActiveConnectionId:vi.fn(async()=>active),setActiveConnection:vi.fn(async(id:string)=>{active=id}),readConfig:vi.fn(async()=>({connections:[{id:'demo'},{id:'other'}]}))};
  const post=vi.fn();const panel=Object.create(VerbisPanel.prototype) as any;
  Object.assign(panel,{initialClient:client,session,workspace,panel:{webview:{postMessage:post}}});
  return {panel,client,session,workspace,post,setActive:(id:string)=>{active=id},start:()=>panel.onMessage({type:'START_SQL_EDITOR',requestId:'manual',payload:{}})};
}
describe('manual SQL entry and explicit database binding',()=>{
  it('preserves a real starting state when the workspace opens before readiness',async()=>{
    const f=fixture();Object.assign(f.panel,{getBackendStatus:()=>({state:'starting'}),restored:Promise.resolve(0),secrets:{},requestedTab:'home'});
    await f.panel.onMessage({type:'PANEL_READY',payload:{}});
    expect(f.post).toHaveBeenCalledWith({type:'BACKEND_STATUS',payload:{state:'starting'}});
  });
  it('opens against the actual schema without generating or executing anything',async()=>{
    const f=fixture();await f.start();
    expect(f.client.getSchema).toHaveBeenCalledWith('demo');expect(f.session.startSqlEditor).toHaveBeenCalledWith('demo','demo-revision');
    expect(f.post).toHaveBeenCalledWith({type:'WORKSPACE_RESULT',requestId:'manual',payload:{connectionId:'demo',schemaFingerprint:'demo-revision'}});
    expect(f.client.generate).not.toHaveBeenCalled();expect(f.client.execute).not.toHaveBeenCalled();
  });
  it('requires a selected connection and reports backend failures',async()=>{
    const f=fixture();f.setActive('');await f.start();expect(f.client.getSchema).not.toHaveBeenCalled();
    expect(f.post).toHaveBeenLastCalledWith(expect.objectContaining({type:'ERROR',payload:{message:expect.stringContaining('Connect a database')}}));
    f.setActive('demo');f.client.getSchema.mockRejectedValueOnce(new Error('Backend unavailable'));await f.start();expect(f.session.startSqlEditor).not.toHaveBeenCalled();
  });
  it('does not bind a database switched during schema loading',async()=>{
    const f=fixture();f.client.getSchema.mockImplementationOnce(async()=>{f.setActive('other');return {fingerprint:'demo-revision'}});
    await f.start();expect(f.session.startSqlEditor).not.toHaveBeenCalled();expect(f.post).toHaveBeenLastCalledWith(expect.objectContaining({type:'ERROR'}));
  });
  it('broadcasts the saved analysis connection and returns its latest stored definition',async()=>{
    const f=fixture();const entry={id:'saved',connectionId:'other',sql:'SELECT 2'};
    Object.assign(f.client,{workspaceAction:vi.fn(async()=>({analyses:[entry]}))});
    await f.panel.onMessage({type:'OPEN_ANALYSIS',requestId:'open',payload:{id:'saved'}});
    expect(f.session.restoreAnalysis).toHaveBeenCalledWith(entry);
    expect(f.post).toHaveBeenCalledWith(expect.objectContaining({type:'CONNECTIONS_UPDATED',payload:expect.objectContaining({activeConnectionId:'other'})}));
    expect(f.post).toHaveBeenLastCalledWith({type:'WORKSPACE_RESULT',requestId:'open',payload:entry});
  });
});
