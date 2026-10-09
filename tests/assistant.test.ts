import {describe,it,expect,vi,beforeEach} from 'vitest';
const ui=vi.hoisted(()=>({provider:'gemini',pick:vi.fn(),input:vi.fn(),command:vi.fn()}));
vi.mock('vscode',()=>({workspace:{getConfiguration:()=>({get:(name:string,def:any)=>name==='llm.provider'?ui.provider:name==='llm.openrouterModel'?'thinkingmachines/inkling:free':def})},window:{showQuickPick:ui.pick,showInputBox:ui.input,showWarningMessage:vi.fn()},commands:{executeCommand:ui.command}}));
import {AssistantSession} from '../src/assistant/AssistantSession';
import {VerbisTerminal} from '../src/terminal/VerbisTerminal';
function fixture(){
 let active='hr';let key:string|undefined;
 const secrets={getActiveApiKey:vi.fn(async(p?:string)=>p==='groq'?'groq-fixture-key':key),markVerified:vi.fn()};
 const workspace={getActiveConnectionId:vi.fn(async()=>active),readConfig:vi.fn(async()=>({connections:[{id:'hr',name:'HR'},{id:'other',name:'Other'}]})),upsertConversation:vi.fn(),appendHistory:vi.fn(),getActiveConversation:vi.fn(),setActiveConversation:vi.fn(async()=>{})};
 const client={generate:vi.fn(async()=>({sql:'SELECT id FROM employees',schemaFingerprint:'v1'})),execute:vi.fn(async()=>({columns:['id'],rows:[{id:3}],rowCount:1,executionTimeMs:1,truncated:false})),getSchema:vi.fn(async()=>({fingerprint:'v1'})),cancelExecution:vi.fn(async()=>{})};
 const session=new AssistantSession(()=>client as any,secrets as any,workspace as any);
 return {session,secrets,workspace,client,setActive:(id:string)=>active=id,setKey:(value:string)=>key=value};
}
beforeEach(()=>{ui.provider='gemini';ui.pick.mockReset();ui.input.mockReset();ui.command.mockReset()});
describe('assistant acceptance contracts (controlled host)',()=>{
 it('uses ChatGPT sign-in without an API-key prompt and consumes one host reservation for generation',async()=>{
  ui.provider='chatgpt';const f=fixture();
  Object.assign(f.secrets,{chatgpt:{snapshot:()=>({connected:true,planEnabled:true,model:'fixture-model'})},claimProviderRequest:vi.fn(async()=> 'chatgpt-fixture-bearer')});
  expect((await f.session.ask('employees above 8000')).kind).toBe('sql');
  expect(ui.pick).not.toHaveBeenCalled();expect(ui.input).not.toHaveBeenCalled();
  expect((f.secrets as any).claimProviderRequest).toHaveBeenCalledOnce();
  expect(f.client.generate.mock.calls[0][0]).toMatchObject({provider:'chatgpt',model:'fixture-model',apiKey:'chatgpt-fixture-bearer'});
 });
 it('blocks SQL and schema generation before backend calls when the ChatGPT test limit is exhausted',async()=>{
  ui.provider='chatgpt';const f=fixture();
  Object.assign(f.secrets,{chatgpt:{snapshot:()=>({connected:true,planEnabled:true,model:'fixture-model'})},claimProviderRequest:vi.fn(async()=>{throw new Error('ChatGPT test request limit reached')})});
  expect((await f.session.ask('employees')).message).toContain('limit reached');expect(f.client.generate).not.toHaveBeenCalled();
  const schema=vi.fn();await expect(f.session.withProvider(schema)).rejects.toThrow('limit reached');expect(schema).not.toHaveBeenCalled();
 });
 it('resumes the first question once after key management',async()=>{const f=fixture();ui.pick.mockResolvedValue({value:'manage'});ui.command.mockImplementation(async()=>f.setKey('valid-fixture-key'));expect((await f.session.ask('employees above 8000')).kind).toBe('sql');expect(f.client.generate).toHaveBeenCalledTimes(1);expect(f.client.generate.mock.calls[0][0].nlInput).toBe('employees above 8000')});
 it('resumes OpenRouter once with its free model and discards its session key on a switch',async()=>{
  ui.provider='openrouter';const f=fixture();ui.pick.mockResolvedValue({value:'session'});ui.input.mockResolvedValueOnce('openrouter-session-fixture').mockResolvedValueOnce('gemini-session-fixture');
  await f.session.ask('employees above 8000');expect(f.client.generate).toHaveBeenCalledTimes(1);
  expect(f.client.generate.mock.calls[0][0]).toEqual(expect.objectContaining({provider:'openrouter',model:'thinkingmachines/inkling:free',apiKey:'openrouter-session-fixture'}));
  ui.provider='gemini';await f.session.ask('employees');expect(f.client.generate.mock.calls[1][0].apiKey).toBe('gemini-session-fixture');
 });
 it('requires no credential choice or cloud key in local mode',async()=>{ui.provider='local';const f=fixture();await f.session.ask('employees');expect(ui.pick).not.toHaveBeenCalled();expect(f.client.generate.mock.calls[0][0].apiKey).toBeUndefined()});
 it('sets busy before credential selection and prevents a duplicate',async()=>{const f=fixture();let choose:(v:any)=>void=()=>{};ui.pick.mockImplementation(()=>new Promise(r=>choose=r));const first=f.session.ask('employees');await vi.waitFor(()=>expect(ui.pick).toHaveBeenCalled());expect(f.session.isBusy).toBe(true);expect((await f.session.ask('duplicate')).kind).toBe('message');choose(undefined);await first;expect(f.client.generate).not.toHaveBeenCalled()});
 it('discards the session key on provider switch',async()=>{const f=fixture();ui.pick.mockResolvedValueOnce({value:'session'}).mockResolvedValueOnce({value:'configured'});ui.input.mockResolvedValue('gemini-session-fixture');await f.session.ask('employees');ui.provider='groq';await f.session.ask('only IT');expect(f.client.generate.mock.calls[1][0].apiKey).toBe('groq-fixture-key')});
 it('does not send a key if the provider changes while its prompt is open',async()=>{const f=fixture();ui.pick.mockResolvedValue({value:'session'});ui.input.mockImplementation(async()=>{ui.provider='groq';return 'gemini-session-fixture'});const r=await f.session.ask('employees');expect(r.kind).toBe('message');expect(f.client.generate).not.toHaveBeenCalled();expect(f.session.credentialSourceLabel).toBe('Not chosen yet')});
 it('runs generated SQL on its original target and clears follow-up context on a new target',async()=>{ui.provider='local';const f=fixture();await f.session.ask('employees');f.setActive('other');await f.session.execute('SELECT id FROM employees');expect(f.client.execute.mock.calls[0][0].dbConfigId).toBe('hr');await f.session.ask('products');expect(f.client.generate.mock.calls[1][0].conversation).toEqual([])});
 it('keeps earlier filters in the supplied conversation',async()=>{ui.provider='local';const f=fixture();await f.session.ask('employees above 8000');await f.session.ask('only IT');expect(f.client.generate.mock.calls[1][0].conversation).toEqual(expect.arrayContaining([{role:'user',content:'employees above 8000'},{role:'assistant',content:'SELECT id FROM employees'}]))});
 it('refuses execution after schema revision changes',async()=>{ui.provider='local';const f=fixture();await f.session.ask('employees');f.client.getSchema.mockResolvedValue({fingerprint:'v2'});expect((await f.session.execute('SELECT id FROM employees')).kind).toBe('error');expect(f.client.execute).not.toHaveBeenCalled()});
 it('reset aborts the request and a late response cannot restore pending SQL',async()=>{ui.provider='local';const f=fixture();let resolve:(v:any)=>void=()=>{};f.client.generate.mockImplementation(()=>new Promise(r=>resolve=r));const pending=f.session.ask('employees');await vi.waitFor(()=>expect(f.client.generate).toHaveBeenCalled());const signal=f.client.generate.mock.calls[0][1];f.session.reset();expect(signal.aborted).toBe(true);resolve({sql:'SELECT 1'});expect((await pending).kind).toBe('cancelled');expect(f.session.restoredSql).toBeUndefined()});
 it('records a failed execution honestly',async()=>{ui.provider='local';const f=fixture();await f.session.ask('employees');f.client.execute.mockRejectedValue(new Error('bad query'));await f.session.execute('SELECT id FROM employees');expect(f.workspace.appendHistory).toHaveBeenCalledWith(expect.objectContaining({success:false,connectionId:'hr'}))});
 it.each(['clarification','offtopic','error'])('invalidates old SQL when a new question ends with %s',async outcome=>{
  ui.provider='local';const f=fixture();await f.session.ask('employees above 8000');
  if(outcome==='error')f.client.generate.mockRejectedValueOnce(new Error('provider unavailable'));
  else f.client.generate.mockResolvedValueOnce({message:'What threshold?',offtopic:outcome==='offtopic'} as any);
  await f.session.ask('Who earns a lot?');expect(f.session.restoredSql).toBeUndefined();
  expect((await f.session.execute('SELECT id FROM employees')).kind).toBe('error');expect(f.client.execute).not.toHaveBeenCalled();
 });
 it('verifies credentials only after a provider response, never from a deterministic guard',async()=>{
  const f=fixture();f.setKey('fixture-key');ui.pick.mockResolvedValue({value:'configured'});
  f.client.generate.mockResolvedValueOnce({offtopic:true,message:'Ask a database question',providerVerified:false} as any);
  await f.session.ask('tell me a joke');expect(f.secrets.markVerified).not.toHaveBeenCalled();
  f.client.generate.mockResolvedValueOnce({message:'Which threshold?',providerVerified:true} as any);
  await f.session.ask('Who earns a lot?');expect(f.secrets.markVerified).toHaveBeenCalledTimes(1);
 });
 it.each(['cancel','provider'])('does not return a late schema operation after %s',async change=>{
  const f=fixture();f.setKey('fixture-key');ui.pick.mockResolvedValue({value:'configured'});
  let resolve:(v:any)=>void=()=>{};const operation=vi.fn(()=>new Promise(r=>resolve=r));
  const pending=f.session.withProvider(operation);await vi.waitFor(()=>expect(operation).toHaveBeenCalled());
  const rejected=expect(pending).rejects.toThrow(change==='cancel'?'Cancelled':'Provider changed');
  if(change==='cancel')f.session.cancel();else ui.provider='groq';
  resolve({ddl:'CREATE TABLE late(id INT)'});await rejected;expect(f.secrets.markVerified).not.toHaveBeenCalled();
 });
 it.each(['clarification','error'])('does not revive old executable SQL on reload after %s',async outcome=>{
  const f=fixture();f.workspace.getActiveConversation.mockResolvedValue({id:'chat',connectionId:'hr',turns:[{role:'user',content:'employees above 8000'},{role:'assistant',content:'SQL',sql:'SELECT id FROM employees',connectionId:'hr'},{role:'user',content:'Who earns a lot?'},...(outcome==='clarification'?[{role:'assistant',content:'Which threshold?'}]:[])]} as any);
  await f.session.restoreLastSession();expect(f.session.restoredSql).toBeUndefined();
 });
 it('restores bindings after an execution status without a newer question',async()=>{
  const f=fixture();f.workspace.getActiveConversation.mockResolvedValue({id:'chat',connectionId:'hr',turns:[{role:'user',content:'employees above 8000'},{role:'assistant',content:'SQL',sql:'SELECT id FROM employees WHERE salary>:threshold',parameters:{threshold:8000},connectionId:'hr'},{role:'assistant',content:'Executed: 2 rows'}]} as any);
  await f.session.restoreLastSession();await f.session.execute('SELECT id FROM employees WHERE salary>:threshold');expect(f.client.execute.mock.calls[0][0].parameters).toEqual({threshold:8000});
 });
 it('cannot overwrite recalled SQL or reset with a late conversation restore',async()=>{
  const f=fixture();let resolve:(v:any)=>void=()=>{};
  f.workspace.getActiveConversation.mockImplementation(()=>new Promise(r=>resolve=r));
  const restore=f.session.restoreLastSession();
  f.session.bindSql('SELECT id FROM employees WHERE id = :id','hr','v1',{id:3});
  resolve({id:'old',turns:[{role:'assistant',content:'old',sql:'SELECT 99',connectionId:'other'}]});
  expect(await restore).toBe(0);
  await f.session.execute('SELECT id FROM employees WHERE id = :id');
  expect(f.client.execute.mock.calls[0][0]).toMatchObject({dbConfigId:'hr',parameters:{id:3}});
  f.session.reset();const afterReset=f.session.restoreLastSession();f.session.reset();
  resolve({id:'old',turns:[{role:'assistant',content:'old',sql:'SELECT 99',connectionId:'other'}]});
  expect(await afterReset).toBe(0);expect(f.session.restoredSql).toBeUndefined();
 });
});
