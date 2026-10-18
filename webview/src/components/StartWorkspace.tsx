import type {BackendStatus, DBConfig} from '../../../src/types';
import type {ChatGPTStatus} from '../../../src/services/ChatGPTService';
import type {WorkspacePage} from '../workspaceNavigation';
import {Step} from './WorkspaceGuide';

export default function StartWorkspace({connection, backend, chatgpt, navigate}: {
  connection?: DBConfig; backend: BackendStatus; chatgpt?: ChatGPTStatus;
  navigate: (page: WorkspacePage) => void;
}) {
  return <section className="workspace-section start-workspace">
    <h1>Ask questions about your data</h1>
    <p className="page-intro">Verbis turns your question into SQL. You review it before running it on your database.</p>
    <Step number={1} title="Choose your data">
      <p>{connection ? `Selected: ${connection.name}.` : 'Connect an existing database, or import a CSV file to start.'}</p>
      <div className="workspace-actions"><button onClick={() => navigate('connections')}>{connection ? 'Change database' : 'Connect a database'}</button>
        <button className="secondary" onClick={() => navigate('datasets')}>Import a CSV file</button></div>
    </Step>
    <Step number={2} title="Choose how AI connects">
      <p>{chatgpt?.planEnabled ? (chatgpt.model ? 'Your ChatGPT plan and model are selected.' : 'Your ChatGPT plan is connected. Choose a model in Settings before your first question.') : 'Use ChatGPT Plus or Pro by signing in, or choose a provider with an API key in Settings.'}</p>
      <button onClick={() => navigate('connections')}>{chatgpt?.model ? 'Review AI settings' : 'Set up AI'}</button>
      <p className="help-text">Signing in makes no AI request. Generating an answer uses your provider allowance.</p>
      <p className="help-text">You can also choose “Write SQL myself” on Ask your data. Writing, running and saving your own queries needs no AI account.</p>
    </Step>
    <Step number={3} title="Ask, review, then run">
      <p>Try a question such as “Show employees earning more than 8,000.” Verbis writes a query; it runs only when you choose <strong>Run query</strong>.</p>
      <button disabled={!connection || backend.state !== 'ready'} onClick={() => navigate('analysis')}>Ask your first question</button>
      {(!connection || backend.state !== 'ready') && <p className="help-text">{!connection ? 'Choose your data in step 1 first.' : 'Wait for the backend to become ready before querying.'}</p>}
    </Step>
    <p className="help-text">Already set up? Use the navigation above. Extra tools live under <strong>More tools</strong>.</p>
  </section>;
}
