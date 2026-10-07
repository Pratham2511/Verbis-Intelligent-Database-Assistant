import {describe,it,expect,vi} from 'vitest';
vi.mock('vscode',()=>({EventEmitter:class{event=()=>({dispose(){}});fire(){}},workspace:{getConfiguration:()=>({get:(_:string,d:any)=>d})},window:{}}));
import {VerbisTerminal} from '../src/terminal/VerbisTerminal';
function terminal(){const session={isBusy:false,ask:vi.fn(async()=>({kind:'message',message:'Done'})),cancel:vi.fn(),discardSessionKey:vi.fn(),getStatusSnapshot:vi.fn(async()=>({})),credentialSourceLabel:'local'};return {session,pty:new VerbisTerminal(session as any,()=>({state:'ready'}),()=>{})};}
describe('terminal input regressions (PTY controller)',()=>{
 it('handles split arrows, insert, Home, End and Delete without injecting escape fragments',async()=>{const {session,pty}=terminal();pty.handleInput('abcd');pty.handleInput('\x1b[');pty.handleInput('D');pty.handleInput('\x1b[D');pty.handleInput('X');pty.handleInput('\x1b[H');pty.handleInput('\x1b[3~');pty.handleInput('\x1b[F');pty.handleInput('!\r');expect(session.ask).toHaveBeenCalledWith('bXcd!')});
 it('edits Unicode without splitting surrogate pairs and recalls input history',async()=>{const {session,pty}=terminal();pty.handleInput('A🙂B\x1b[D\x7f\r');expect(session.ask).toHaveBeenCalledWith('AB');pty.handleInput('\x1b[A\r');expect(session.ask).toHaveBeenLastCalledWith('AB')});
 it('accepts cancellation while busy and suppresses a second question',()=>{const {session,pty}=terminal();session.isBusy=true;pty.handleInput('duplicate\r/cancel\r\x03');expect(session.ask).not.toHaveBeenCalled();expect(session.cancel).toHaveBeenCalledTimes(2)});
 it('does not offer an old query to /run after a clarification',async()=>{
  const {session,pty}=terminal();const execute=vi.fn();Object.assign(session,{execute});
  session.ask.mockResolvedValueOnce({kind:'sql',sql:'SELECT 1'} as any).mockResolvedValueOnce({kind:'message',message:'Which threshold?'});
  await (pty as any).evaluate('employees above 8000');await (pty as any).evaluate('Who earns a lot?');
  await (pty as any).evaluate('/run');expect(execute).not.toHaveBeenCalled();
 });
});
