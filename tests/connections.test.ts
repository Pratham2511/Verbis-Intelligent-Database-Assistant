import {describe,it,expect,vi} from 'vitest';
vi.mock('vscode',()=>({}));
import {saveConnection} from '../src/services/ConnectionService';
function fixture(){
 const old={id:'db',name:'Original',dialect:'postgresql',host:'localhost',port:5432,database:'original',user:'user',ssl:true};
 const changed={...old,name:'Edited',database:'edited'};
 const client={registerConnection:vi.fn(async()=>{}),deleteConnection:vi.fn(async()=>{})};
 const workspace={readConfig:vi.fn(async()=>({connections:[old]})),upsertConnection:vi.fn(async()=>{})};
 const secrets={getDbPassword:vi.fn(async()=> 'old-fixture-password'),storeDbPassword:vi.fn(async()=>{}),deleteDbPassword:vi.fn(async()=>{})};
 return {old,changed,client,workspace,secrets,run:()=>saveConnection(client as any,workspace as any,secrets as any,changed,'new-fixture-password')};
}
describe('connection transaction boundaries',()=>{
 it('does not change pool, password or persisted configuration when dry-run fails',async()=>{const f=fixture();f.client.registerConnection.mockRejectedValueOnce(new Error('Invalid credentials'));await expect(f.run()).rejects.toThrow('Invalid credentials');expect(f.client.registerConnection).toHaveBeenCalledTimes(1);expect(f.secrets.storeDbPassword).not.toHaveBeenCalled();expect(f.workspace.upsertConnection).not.toHaveBeenCalled()});
 it('restores the old registered pool and secret when config persistence fails',async()=>{const f=fixture();f.workspace.upsertConnection.mockRejectedValueOnce(new Error('Disk full'));await expect(f.run()).rejects.toThrow('Disk full');expect(f.client.registerConnection.mock.calls).toEqual([[f.changed,'new-fixture-password',true],[f.changed,'new-fixture-password'],[f.old,'old-fixture-password']]);expect(f.secrets.storeDbPassword.mock.calls).toEqual([['db','new-fixture-password'],['db','old-fixture-password']])});
 it('rejects unavailable secure storage without persisting a new connection',async()=>{const f=fixture();f.secrets.storeDbPassword.mockRejectedValueOnce(new Error('Keyring unavailable'));await expect(f.run()).rejects.toThrow('Keyring unavailable');expect(f.workspace.upsertConnection).not.toHaveBeenCalled();expect(f.client.registerConnection).toHaveBeenLastCalledWith(f.old,'old-fixture-password')});
 it('keeps the saved password on a blank edit and skips credentials for SQLite',async()=>{const f=fixture();await saveConnection(f.client as any,f.workspace as any,f.secrets as any,f.changed,'');expect(f.client.registerConnection).toHaveBeenLastCalledWith(f.changed,'old-fixture-password');expect(f.secrets.storeDbPassword).not.toHaveBeenCalled();f.secrets.getDbPassword.mockClear();const sqlite={...f.changed,dialect:'sqlite'};await saveConnection(f.client as any,f.workspace as any,f.secrets as any,sqlite,'');expect(f.secrets.getDbPassword).not.toHaveBeenCalled();expect(f.client.registerConnection).toHaveBeenLastCalledWith(sqlite,'')});
});
