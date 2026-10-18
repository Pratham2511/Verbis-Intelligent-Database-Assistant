import {EventEmitter} from 'events';
import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
const state=vi.hoisted(()=>({children:[] as any[],shutdown:vi.fn(),health:vi.fn()}));
vi.mock('vscode',()=>({window:{createOutputChannel:()=>({append:vi.fn(),appendLine:vi.fn()}),showErrorMessage:vi.fn(async()=>undefined)}}));
vi.mock('net',()=>({createServer:()=>({unref(){},on(){},listen(_port:number,_host:string,cb:()=>void){cb()},close(cb:()=>void){cb()}})}));
vi.mock('child_process',()=>({spawn:()=>{const child:any=new EventEmitter();child.pid=state.children.length+1;child.exitCode=null;child.signalCode=null;child.killed=false;child.stderr=new EventEmitter();child.kill=vi.fn((signal:string)=>{child.killed=true;child.signalCode=signal;child.emit('exit',null,signal);return true});state.children.push(child);return child}}));
vi.mock('../src/services/BackendClient',()=>({BackendClient:class{health=()=>state.health();shutdown=()=>state.shutdown()}}));
import {BackendManager} from '../src/BackendManager';
const create=()=>new BackendManager('/test/main.py','/test','/workspace','/test/python');
beforeEach(()=>{vi.useFakeTimers();state.children=[];state.shutdown.mockReset().mockResolvedValue({});state.health.mockReset().mockResolvedValue({status:'ok',version:'1.5.0'})});
afterEach(()=>vi.useRealTimers());
describe('backend lifecycle regressions (controlled subprocess)',()=>{
 it('allows cold readiness beyond ten seconds while retaining a bounded startup',async()=>{
  const start=Date.now();state.health.mockImplementation(async()=>{if(Date.now()-start<12000)throw new Error('Still importing');return {status:'ok',version:'1.5.0'}});
  const manager=create();const starting=manager.start();await vi.advanceTimersByTimeAsync(12500);
  expect((await starting).state).toBe('ready');expect(state.children).toHaveLength(1);expect(state.children[0].kill).not.toHaveBeenCalled();
  const stop=manager.stop();await vi.advanceTimersByTimeAsync(600);await stop;
 });
 it('cleans up a server that never becomes ready instead of leaving an orphan',async()=>{
  state.health.mockRejectedValue(new Error('Not ready'));const manager=create();const starting=manager.start();
  await vi.advanceTimersByTimeAsync(48000);expect((await starting).state).toBe('crashed');expect(manager.getClient()).toBeNull();
  expect(state.children[0].kill).toHaveBeenCalledWith('SIGTERM');await vi.advanceTimersByTimeAsync(2000);expect(state.children).toHaveLength(1);
 });
 it('does not overwrite a newer startup while cleaning up a timed-out server',async()=>{
  state.health.mockRejectedValue(new Error('Not ready'));let release!:()=>void;
  state.shutdown.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve}));
  const manager=create(),oldStart=manager.start();await vi.advanceTimersByTimeAsync(45100);
  expect(state.shutdown).toHaveBeenCalledTimes(1);state.health.mockResolvedValue({status:'ok',version:'1.5.0'});
  expect((await manager.start()).state).toBe('ready');release();await vi.advanceTimersByTimeAsync(600);await oldStart;
  expect(manager.getStatus()).toMatchObject({state:'ready',pid:2});expect(manager.getClient()).not.toBeNull();
  const stop=manager.stop();await vi.advanceTimersByTimeAsync(600);await stop;
 });
 it('restarts when the old process exits during the shutdown wait',async()=>{const manager=create();await manager.start();const child=state.children[0];const restarting=manager.restart();setTimeout(()=>{child.exitCode=0;child.emit('exit',0,null)},100);await vi.advanceTimersByTimeAsync(600);expect((await restarting).state).toBe('ready');expect(state.children).toHaveLength(2);expect(manager.getClient()).not.toBeNull();const stopped=manager.stop();await vi.advanceTimersByTimeAsync(2000);await stopped});
 it('does not erase a new startup when an older stop completes',async()=>{const manager=create();await manager.start();const stopping=manager.stop();await manager.start();await vi.advanceTimersByTimeAsync(600);await stopping;expect(manager.getStatus()).toMatchObject({state:'ready',pid:2});expect(manager.getClient()).not.toBeNull();const stopped=manager.stop();await vi.advanceTimersByTimeAsync(600);await stopped});
 it('invalidates readiness on crash, retries once and requires manual recovery after a repeated crash',async()=>{const manager=create();await manager.start();state.children[0].exitCode=1;state.children[0].emit('exit',1,null);expect(manager.getStatus().state).toBe('crashed');expect(manager.getClient()).toBeNull();await vi.advanceTimersByTimeAsync(1100);expect(manager.getStatus()).toMatchObject({state:'ready',pid:2});state.children[1].exitCode=1;state.children[1].emit('exit',1,null);await vi.advanceTimersByTimeAsync(1100);expect(state.children).toHaveLength(2);expect(manager.getStatus().state).toBe('crashed');await manager.restart();expect(manager.getStatus()).toMatchObject({state:'ready',pid:3});const stopped=manager.stop();await vi.advanceTimersByTimeAsync(600);await stopped});
});
