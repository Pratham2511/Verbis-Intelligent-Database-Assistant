import {useEffect, useState} from 'react';
import {InvestigationWorkspace} from './components/InvestigationWorkspace';
import {DatasetWorkspace, ProjectNavigator, AnalysisWorkspace} from './components/WorkspaceViews';
import SchemaExplorer from './components/SchemaExplorer';
import QueryTreeView from './components/QueryTreeView';
import GlossaryEditor from './components/GlossaryEditor';
import ConnectionForm from './components/ConnectionForm';
import ProviderSettings from './components/ProviderSettings';
import {SchemaCreator} from './components/SchemaCreator';
import RobustnessReport from './components/RobustnessReport';
import StartWorkspace from './components/StartWorkspace';
import {useConnectionList} from './components/WorkspaceGuide';
import type {BackendStatus} from '../../src/types';
import type {ChatGPTStatus} from '../../src/services/ChatGPTService';
import {onMessage, postMessage} from './vscode';
import {pages, mainPages, toolPages, isWorkspacePage, type WorkspacePage} from './workspaceNavigation';

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspacePage>('home');
  const [visited, setVisited] = useState<WorkspacePage[]>(['home']);
  const [editingConnection, setEditingConnection] = useState<any>();
  const [backendStatus, setBackendStatus] = useState<BackendStatus>({state: 'starting'});
  const [chatgptStatus, setChatgptStatus] = useState<ChatGPTStatus>();
  const {connections, active} = useConnectionList();
  const activeConnection = connections.find(c => c.id === active);
  useEffect(() => {setVisited(v => v.includes(activeTab) ? v : [...v, activeTab]);}, [activeTab]);
  useEffect(() => {
    const off = onMessage(msg => {
      if (msg.type === 'CHATGPT_STATUS') setChatgptStatus(msg.payload as ChatGPTStatus);
      if (msg.type === 'EDIT_CONNECTION') {setEditingConnection(msg.payload); setActiveTab('connections');}
      if (msg.type === 'OPEN_TAB') {
        const tab = (msg.payload as {tab: unknown}).tab;
        if (isWorkspacePage(tab)) setActiveTab(tab);
      }
      if (msg.type === 'BACKEND_STATUS') setBackendStatus(msg.payload as BackendStatus);
    });
    postMessage('PANEL_READY', {});
    return off;
  }, []);
  const backendLabel = backendStatus.state === 'ready' ? 'Ready' : backendStatus.state === 'starting' ? 'Starting…' : 'Backend needs attention';
  const aiHelp = chatgptStatus?.providerActive ? !chatgptStatus.planEnabled ? 'Sign in to ChatGPT in Settings before using AI.' : !chatgptStatus.model ? 'Choose a ChatGPT model in Settings before using AI.' : chatgptStatus.requestsUsed >= chatgptStatus.requestLimit ? 'AI testing is paused. Allow another attempt in Settings when you are ready.' : undefined : undefined;
  return <div className="verbis-app">
    <a href="#workspace-content" className="skip-link">Skip to workspace</a>
    <header className="workspace-header">
      <div className="workspace-brand"><strong>Verbis</strong><span>Your database workspace</span></div>
      <span className={`backend-status ${backendStatus.state}`} role="status">{backendLabel}</span>
    </header>
    <nav className="workspace-nav" aria-label="Workspace navigation">
      {mainPages.map(tab => <button key={tab} onClick={() => setActiveTab(tab)} aria-current={activeTab === tab ? 'page' : undefined}>{pages[tab].label}</button>)}
      <label className="tools-menu"><span className="sr-only">More tools</span>
        <select aria-label="More tools" value={toolPages.includes(activeTab) ? activeTab : ''} onChange={e => {if (isWorkspacePage(e.target.value)) setActiveTab(e.target.value);}}>
          <option value="">More tools</option>{toolPages.map(tab => <option key={tab} value={tab}>{pages[tab].label}</option>)}
        </select>
      </label>
    </nav>
    <div className="workspace-context">
      <label>Database <select aria-label="Active database" value={active} disabled={backendStatus.state !== 'ready' || !connections.length}
        onChange={e => postMessage('SELECT_CONNECTION', {id: e.target.value})}>
        <option value="">{connections.length ? 'Choose a database' : 'No database connected'}</option>
        {connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select></label>
      {chatgptStatus?.providerActive && <div className="ai-context">
        <span>{chatgptStatus.planEnabled ? 'ChatGPT connected' : 'ChatGPT sign-in needed'} · {Math.max(0, chatgptStatus.requestLimit - chatgptStatus.requestsUsed)} AI {chatgptStatus.requestLimit - chatgptStatus.requestsUsed === 1 ? 'attempt' : 'attempts'} available</span>
        <button className="text-button" onClick={() => setActiveTab('connections')}>{chatgptStatus.model ? 'AI settings' : 'Choose a model'}</button>
      </div>}
    </div>
    {backendStatus.state !== 'ready' && backendStatus.state !== 'starting' && <div className="setup-notice" role="status">Open the command palette (Ctrl+Shift+P) and run <strong>Verbis: Restart Python Backend</strong>. For first-time setup, run <strong>Verbis: Install / Reinstall Backend</strong>.</div>}
    <main id="workspace-content" tabIndex={-1} className="workspace-content" aria-label={pages[activeTab].label}>
      {activeTab === 'home' && <StartWorkspace connection={activeConnection} backend={backendStatus} chatgpt={chatgptStatus} navigate={setActiveTab}/>}
      {visited.includes('datasets') && <div hidden={activeTab !== 'datasets'}><DatasetWorkspace/></div>}
      {visited.includes('project') && <div hidden={activeTab !== 'project'}><ProjectNavigator/></div>}
      {visited.includes('analysis') && <div hidden={activeTab !== 'analysis'}><AnalysisWorkspace aiHelp={aiHelp} onOpenSettings={() => setActiveTab('connections')}/></div>}
      {(['forensics', 'rehearsal', 'reconcile'] as const).map(mode => visited.includes(mode) && <div key={mode} hidden={activeTab !== mode}><InvestigationWorkspace mode={mode}/></div>)}
      {activeTab === 'schema' && <SchemaExplorer/>}
      {visited.includes('createdb') && <div hidden={activeTab !== 'createdb'}><SchemaCreator aiHelp={aiHelp} onOpenSettings={() => setActiveTab('connections')}/></div>}
      {activeTab === 'tree' && <QueryTreeView/>}
      {activeTab === 'glossary' && <GlossaryEditor/>}
      {activeTab === 'robustness' && <RobustnessReport/>}
      {activeTab === 'connections' && <section className="workspace-section settings-workspace">
        <h1>Settings</h1><p className="page-intro">Connect your data and choose one AI provider. You can change these choices at any time.</p>
        <ConnectionForm editingConnection={editingConnection}/><ProviderSettings/>
      </section>}
    </main>
  </div>;
}
