// ============================================================================
// App.tsx — Root component: routes between Chat / Schema / Tree / Glossary
// ============================================================================
import {InvestigationWorkspace} from './components/InvestigationWorkspace';
import {DatasetWorkspace,ProjectNavigator,AnalysisWorkspace} from './components/WorkspaceViews';
import { useEffect, useState } from 'react';
import SchemaExplorer from './components/SchemaExplorer';
import QueryTreeView from './components/QueryTreeView';
import GlossaryEditor from './components/GlossaryEditor';
import ConnectionForm from './components/ConnectionForm';
import { ApiKeySettings } from './components/ApiKeySettings';
import { SchemaCreator } from './components/SchemaCreator';
import RobustnessReport from './components/RobustnessReport';
import type { BackendStatus } from '../../src/types';
import { onMessage,postMessage } from './vscode';
import ChatGPTSettings from './components/ChatGPTSettings';
import type {ChatGPTStatus} from '../../src/services/ChatGPTService';

type Tab = 'forensics' | 'rehearsal' | 'reconcile' | 'datasets' | 'project' | 'analysis' | 'schema' | 'createdb' | 'tree' | 'glossary' | 'robustness' | 'connections';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('connections');
  const [visited,setVisited]=useState<Tab[]>(['connections']);
  useEffect(()=>{setVisited(v=>v.includes(activeTab)?v:[...v,activeTab])},[activeTab]);
  const [editingConnection,setEditingConnection]=useState<any>();
  const [backendStatus, setBackendStatus] = useState<BackendStatus>({ state: 'starting' });
  const [chatgptStatus,setChatgptStatus]=useState<ChatGPTStatus>();

  useEffect(() => {
    const off = onMessage(msg => {
      if(msg.type==='CHATGPT_STATUS')setChatgptStatus(msg.payload as ChatGPTStatus);
      if(msg.type==='EDIT_CONNECTION')setEditingConnection(msg.payload);
      if(msg.type==='OPEN_TAB')setActiveTab((msg.payload as {tab:Tab}).tab);
      if (msg.type === 'BACKEND_STATUS') {
        setBackendStatus(msg.payload as BackendStatus);
      }
    });
    postMessage('PANEL_READY',{});
    return off;
  }, []);

  return (
    <div className="flex flex-col h-screen">
      {/* Top tab bar */}
      <nav className="flex border-b border-qm-border text-xs">
        {(['datasets','project','analysis','forensics','rehearsal','reconcile','schema', 'createdb', 'tree', 'glossary', 'robustness', 'connections'] as Tab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-2 border-r border-qm-border ${
              activeTab === tab ? 'bg-qm-hover text-qm-accent' : 'text-qm-fg'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
        <div className="ml-auto px-3 py-2 text-qm-fg">
          <span
            className="inline-block w-2 h-2 rounded-full mr-2"
            style={{
              background:
                backendStatus.state === 'ready'
                  ? '#4ec9b0'
                  : backendStatus.state === 'starting'
                  ? '#d4a017'
                  : '#f14c4c',
            }}
          />
          Backend: {backendStatus.state}
        </div>
      </nav>
      {chatgptStatus?.providerActive && <div className="px-4 py-2 border-b border-qm-border text-xs flex gap-3">
        <span>{chatgptStatus.planEnabled ? 'Using ChatGPT plan' : 'ChatGPT sign-in required'} · AI attempts {chatgptStatus.requestsUsed}/{chatgptStatus.requestLimit}</span>
        <button onClick={()=>postMessage('CHATGPT_MANAGE_USAGE',{})} className="text-qm-accent">Manage usage ↗</button>
      </div>}

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {visited.includes('datasets') && <div hidden={activeTab!=='datasets'}><DatasetWorkspace /></div>}
        {visited.includes('project') && <div hidden={activeTab!=='project'}><ProjectNavigator /></div>}
        {visited.includes('analysis') && <div hidden={activeTab!=='analysis'}><AnalysisWorkspace /></div>}
        {(['forensics','rehearsal','reconcile'] as const).map(mode=>visited.includes(mode)&&<div key={mode} hidden={activeTab!==mode}><InvestigationWorkspace mode={mode}/></div>)}
        {activeTab === 'schema' && <SchemaExplorer />}
        {visited.includes('createdb') && <div hidden={activeTab!=='createdb'}><SchemaCreator /></div>}
        {activeTab === 'tree' && <QueryTreeView />}
        {activeTab === 'glossary' && <GlossaryEditor />}
        {activeTab === 'robustness' && <RobustnessReport />}
        {activeTab === 'connections' && (
          <>
            <ChatGPTSettings />
            <ApiKeySettings />
            <ConnectionForm editingConnection={editingConnection}/>
          </>
        )}
      </div>
    </div>
  );
}
