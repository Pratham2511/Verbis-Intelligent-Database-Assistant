import {describe,expect,it,vi} from 'vitest';
vi.mock('vscode',()=>({}));
import {SecretsService} from '../src/services/SecretsService';
function fixture(){
 const data=new Map<string,string>();
 const storage={get:vi.fn(async(id:string)=>data.get(id)),store:vi.fn(async(id:string,value:string)=>{data.set(id,value)}),delete:vi.fn(async(id:string)=>{data.delete(id)})};
 const secrets=new SecretsService({secrets:storage} as any);
 return {data,storage,secrets};
}
describe('cloud provider secret isolation',()=>{
 it('stores and retrieves OpenRouter separately from Gemini and Groq',async()=>{
  const f=fixture();await f.secrets.storeGeminiKey('gemini-fixture');await f.secrets.storeGroqKey('groq-fixture');await f.secrets.storeOpenRouterKey(' openrouter-fixture ');
  expect(await f.secrets.getActiveApiKey('openrouter')).toBe('openrouter-fixture');
  expect(await f.secrets.getActiveApiKey('gemini')).toBe('gemini-fixture');
  expect(await f.secrets.getActiveApiKey('groq')).toBe('groq-fixture');
  await f.secrets.deleteOpenRouterKey();expect(await f.secrets.getActiveApiKey('openrouter')).toBeUndefined();
  expect(await f.secrets.getActiveApiKey('gemini')).toBe('gemini-fixture');
 });
 it('never falls back to a Gemini credential for an unknown provider',async()=>{
  const f=fixture();await f.secrets.storeGeminiKey('gemini-fixture');f.storage.get.mockClear();
  expect(await f.secrets.getActiveApiKey('unknown')).toBeUndefined();
  expect(await f.secrets.getActiveApiKey('local')).toBeUndefined();expect(f.storage.get).not.toHaveBeenCalled();
 });
});
