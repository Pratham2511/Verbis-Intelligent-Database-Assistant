import {afterEach,describe,expect,it,vi} from 'vitest';
import {createLocalJWKSet,exportJWK,generateKeyPair,SignJWT} from 'jose';
const ui=vi.hoisted(()=>({pick:vi.fn(async(items:any[])=>items[0]),welcome:vi.fn(async()=> 'Got it')}));
vi.mock('vscode',()=>({
 EventEmitter:class {listeners=new Set<any>();event=(fn:any)=>{this.listeners.add(fn);return {dispose:()=>this.listeners.delete(fn)}};fire(value:any){for(const fn of this.listeners)fn(value)}dispose(){this.listeners.clear()}},
 window:{showQuickPick:ui.pick,showInformationMessage:ui.welcome,showWarningMessage:vi.fn()},
 workspace:{getConfiguration:()=>({get:()=> 'chatgpt'})},
}));
import {ChatGPTService,validateChatGPTIdentity} from '../src/services/ChatGPTService';
const services:ChatGPTService[]=[];
afterEach(()=>{for(const s of services)s.dispose();services.length=0;vi.useRealTimers()});
function fixture(options:{scope?:string;verifyFails?:boolean;callback?:boolean;wrongState?:boolean}={}){
 const stored=new Map<string,any>();let authorization:URL;const calls:{url:string;fields?:URLSearchParams}[]=[];const callbackStatuses:number[]=[];
 const request=vi.fn(async(input:any,init:any)=>{
  const url=String(input);const fields=init?.body instanceof URLSearchParams?init.body:undefined;calls.push({url,fields});
  if(url.endsWith('/models'))return new Response(JSON.stringify({models:[{slug:'fixture-model',display_name:'Fixture model',visibility:'list'},{slug:'hidden',display_name:'Hidden',visibility:'hide'}]}));
  if(url.endsWith('/revoke'))return new Response(null,{status:200});
  return new Response(JSON.stringify({access_token:fields?.get('grant_type')==='refresh_token'?'refreshed-fixture-token':'access-fixture-token',refresh_token:'refresh-fixture-token',id_token:'id-fixture-token',token_type:'Bearer',expires_in:3600,scope:options.scope??'openid resource.invoke chatgpt.tokens.use.direct'}));
 });
 const open=vi.fn(async(url:string)=>{
  authorization=new URL(url);
  if(options.callback!==false)setTimeout(async()=>{
   const callback=new URL(authorization.searchParams.get('redirect_uri')!);
   if(options.wrongState){callback.search=new URLSearchParams({state:'wrong',code:'unused',client_id:'oaiapp_fixture_client'}).toString();callbackStatuses.push((await fetch(callback)).status);}
   callback.search=new URLSearchParams({state:authorization.searchParams.get('state')!,code:'fixture-code',client_id:'oaiapp_fixture_client'}).toString();
   callbackStatuses.push((await fetch(callback)).status);
  },1);
  return true;
 });
 const verify=vi.fn(async()=>{if(options.verifyFails)throw new Error('invalid signature');return {subject:'fixture-subject',email:'fixture@example.com'}});
 const context={globalState:{get:(k:string,d?:any)=>stored.get(k)??d,update:async(k:string,v:any)=>{stored.set(k,v)}}};
 const service=new ChatGPTService(context as any,{fetch:request as any,open,verify});services.push(service);
 return {service,stored,calls,open,verify,callbackStatuses,get authorization(){return authorization!}};
}
describe('ChatGPT browser sign-in and test usage boundary (controlled host)',()=>{
 it('binds PKCE/state/nonce to a loopback callback and exchanges only the issued client ID without inference',async()=>{
  const f=fixture({wrongState:true});const status=await f.service.signIn();
  expect(f.authorization.origin).toBe('https://auth.openai.com');
  expect(f.authorization.searchParams.get('client_id')).toBe('dynamic_agent_client');
  expect(f.authorization.searchParams.get('agent_name_hint')).toBe('Verbis');
  expect(f.authorization.searchParams.get('code_challenge_method')).toBe('S256');
  const redirect=new URL(f.authorization.searchParams.get('redirect_uri')!);expect(redirect.hostname).toBe('127.0.0.1');expect(redirect.pathname).toBe('/auth/callback');
  expect(f.callbackStatuses).toContain(400);expect(f.calls[0].fields?.get('client_id')).toBe('oaiapp_fixture_client');
  expect(f.calls[0].fields?.get('redirect_uri')).toBe(redirect.href);
  expect(f.verify).toHaveBeenCalledWith('id-fixture-token','oaiapp_fixture_client',f.authorization.searchParams.get('nonce'));
  expect(status).toMatchObject({connected:true,planEnabled:true,requestsUsed:0,requestLimit:1,model:undefined});
  expect(status.models.map(m=>m.slug)).toEqual(['fixture-model']);
  expect(f.calls.some(c=>c.url.includes('/responses'))).toBe(false);
  const persisted=JSON.stringify([...f.stored.values()]);for(const token of ['access-fixture-token','refresh-fixture-token','id-fixture-token'])expect(persisted).not.toContain(token);
  expect(JSON.stringify(status)).not.toContain('fixture-token');
 });
 it('rejects invalid identity before activating or persisting a registration',async()=>{
  const f=fixture({verifyFails:true});await expect(f.service.signIn()).rejects.toThrow('identity validation');
  expect(f.service.snapshot().connected).toBe(false);expect(f.stored.has('verbis.chatgpt.registrations')).toBe(false);expect(f.calls).toHaveLength(1);
 });
 it('retains identity-only sign-in while preventing model listing and inference without the granted plan scope',async()=>{
  const f=fixture({scope:'openid resource.invoke'});expect((await f.service.signIn()).planEnabled).toBe(false);
  await expect(f.service.accessToken()).rejects.toThrow('not granted');expect(f.calls).toHaveLength(1);
 });
 it('cancels browser waiting without token exchange or inference',async()=>{
  const f=fixture({callback:false});const pending=f.service.signIn();const rejected=expect(pending).rejects.toThrow('cancelled');
  await vi.waitFor(()=>expect(f.open).toHaveBeenCalled());f.service.cancelSignIn();await rejected;
  expect(f.calls).toHaveLength(0);expect(f.service.snapshot()).toMatchObject({connected:false,busy:false,requestsUsed:0});
 });
 it('requires model selection and atomically permits only one attempted request, including concurrent callers',async()=>{
  const f=fixture();await f.service.signIn();await expect(f.service.claimRequest()).rejects.toThrow('Select a ChatGPT model');
  expect(()=>f.service.selectModel('unlisted')).toThrow('catalog');f.service.selectModel('fixture-model');
  expect(()=>f.service.allowOneMoreRequest()).toThrow('not been used');
  const results=await Promise.allSettled([f.service.claimRequest('fixture-model'),f.service.claimRequest('fixture-model')]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(f.service.snapshot().requestsUsed).toBe(1);
  await expect(f.service.claimRequest('fixture-model')).rejects.toThrow('limit reached');
  f.service.allowOneMoreRequest();await f.service.claimRequest('fixture-model');expect(f.service.snapshot().requestsUsed).toBe(2);
 });
 it('serializes expiry refresh, rotates credentials in memory and revokes the renewable session on sign-out',async()=>{
  const f=fixture();await f.service.signIn();vi.useFakeTimers();vi.setSystemTime(Date.now()+3700000);
  const tokens=await Promise.all([f.service.accessToken(),f.service.accessToken()]);expect(tokens).toEqual(['refreshed-fixture-token','refreshed-fixture-token']);
  expect(f.calls.filter(c=>c.fields?.get('grant_type')==='refresh_token')).toHaveLength(1);
  await f.service.signOut();expect(f.calls.at(-1)?.url).toMatch(/\/revoke$/);expect(f.calls.at(-1)?.fields?.get('client_id')).toBe('oaiapp_fixture_client');
  expect(f.service.snapshot().connected).toBe(false);await expect(f.service.accessToken()).rejects.toThrow('Continue with ChatGPT');
 });
});

describe('actual JWT signature and identity checks with ephemeral test keys',()=>{
 it.each(['nonce','audience','issuer','expiry','signature'])('rejects a wrong %s',async(kind)=>{
  const key=await generateKeyPair('RS256');const different=kind==='signature'?await generateKeyPair('RS256'):key;
  const publicKey=await exportJWK(key.publicKey);publicKey.kid='fixture';publicKey.alg='RS256';
  const token=await new SignJWT({nonce:kind==='nonce'?'wrong':'expected'}).setProtectedHeader({alg:'RS256',kid:'fixture'})
   .setSubject('fixture').setAudience(kind==='audience'?'wrong':'oaiapp_fixture').setIssuer(kind==='issuer'?'https://wrong.example':'https://auth.openai.com')
   .setIssuedAt().setExpirationTime(kind==='expiry'?Math.floor(Date.now()/1000)-20:'1h').sign(different.privateKey);
  await expect(validateChatGPTIdentity(token,'oaiapp_fixture','expected',createLocalJWKSet({keys:[publicKey]}))).rejects.toThrow();
 });
 it('accepts only the correctly signed expected account identity',async()=>{
  const key=await generateKeyPair('RS256');const publicKey=await exportJWK(key.publicKey);publicKey.kid='fixture';
  const token=await new SignJWT({nonce:'expected',email:'fixture@example.com'}).setProtectedHeader({alg:'RS256',kid:'fixture'})
   .setSubject('fixture').setAudience('oaiapp_fixture').setIssuer('https://auth.openai.com').setIssuedAt().setExpirationTime('1h').sign(key.privateKey);
  expect(await validateChatGPTIdentity(token,'oaiapp_fixture','expected',createLocalJWKSet({keys:[publicKey]}))).toEqual({subject:'fixture',email:'fixture@example.com'});
 });
});
