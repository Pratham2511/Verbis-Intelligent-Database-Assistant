import {describe, expect, it, vi} from 'vitest';
const state = vi.hoisted(() => ({values: new Map<string, unknown>(), update: vi.fn()}));
vi.mock('vscode', () => ({
  ConfigurationTarget: {Workspace: 2},
  workspace: {getConfiguration: () => ({get: (key: string, fallback: unknown) => state.values.get(key) ?? fallback, update: state.update})},
}));
import {VerbisPanel} from '../src/panels/VerbisPanel';
function fixture() {
  state.values.clear(); state.values.set('llm.provider', 'chatgpt');
  state.update.mockReset(); state.update.mockImplementation(async (key: string, value: unknown) => {state.values.set(key, value);});
  const panel = Object.create(VerbisPanel.prototype) as any;
  const post = vi.fn(); panel.panel = {webview: {postMessage: post}};
  return {post, act: (payload: unknown) => panel.onMessage({type: 'UPDATE_PROVIDER_SETTINGS', requestId: 'settings', payload})};
}
describe('in-workspace provider configuration', () => {
  it('updates provider/model without requiring a backend, login or an AI request', async () => {
    const f = fixture(); await f.act({provider: 'groq', model: ' reviewed-model '});
    expect(state.values.get('llm.provider')).toBe('groq'); expect(state.values.get('llm.groqModel')).toBe('reviewed-model');
    expect(f.post).toHaveBeenCalledWith({type: 'PROVIDER_SETTINGS', requestId: 'settings', payload: {provider: 'groq', model: 'reviewed-model'}});
  });
  it.each([{provider: 'unknown'}, {provider: 'openrouter', model: 'paid-model'}, {provider: 'chatgpt', model: 'arbitrary-model'}, {provider: 'groq', model: 7}])('rejects invalid configuration before changing the selected provider: %j', async payload => {
    const f = fixture(); await f.act(payload);
    expect(state.update).not.toHaveBeenCalled(); expect(state.values.get('llm.provider')).toBe('chatgpt');
    expect(f.post).toHaveBeenCalledWith(expect.objectContaining({type: 'ERROR', requestId: 'settings'}));
  });
});
