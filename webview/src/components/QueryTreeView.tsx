// ============================================================================
// QueryTreeView.tsx — ReactFlow DAG with fork/compare/merge actions
// Implements Novel Contribution #14 (Interactive Query Tree with Visual Branching).
// ============================================================================
import { useEffect, useState, useCallback } from 'react';
import ReactFlow, {
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeChange,
  applyNodeChanges,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { QueryTree as QueryTreeData, QueryNode } from '../../../src/types';
import { onMessage, postMessage,request } from '../vscode';

const STATUS_COLOR: Record<QueryNode['status'], string> = {
  success: '#4ec9b0',
  failed: '#f14c4c',
  warning: '#d4a017',
  unexecuted: '#888',
};

export default function QueryTreeView() {
  const [tree, setTree] = useState<QueryTreeData>({ nodes: {}, rootIds: [], checkpoints: [] });
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [rfNodes, setRfNodes] = useState<Node[]>([]);
  const [comparison,setComparison]=useState(''),[label,setLabel]=useState(''),[error,setError]=useState('');
  const [rfEdges, setRfEdges] = useState<Edge[]>([]);

  useEffect(() => {
    const off = onMessage(msg => {
      if (msg.type === 'TREE_UPDATED') {
        setTree(msg.payload as QueryTreeData);
      }
    });
    postMessage('LOAD_TREE', {});
    return off;
  }, []);

  // Convert tree → reactflow nodes/edges
  useEffect(() => {
    const nodes: Node[] = Object.values(tree.nodes).map(node => ({
      id: node.id,
      selected: selectedNodeIds.includes(node.id),
      type: 'default',
      position: computePosition(node, tree),
      data: {
        label: (
          <div className="text-xs">
            <div className="font-semibold truncate max-w-[200px]">{node.nlInput}</div>
            <div className="opacity-60">{node.sql.slice(0, 60)}…</div>
            <div className="flex gap-2 mt-1">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: STATUS_COLOR[node.status] }}
              />
              {node.executionTimeMs && (
                <span className="opacity-70">{node.executionTimeMs}ms</span>
              )}
              {node.checkpointLabel && (
                <span className="text-qm-accent">📌 {node.checkpointLabel}</span>
              )}
            </div>
          </div>
        ),
      },
      style: { borderColor: STATUS_COLOR[node.status] },
    }));

    const edges: Edge[] = Object.values(tree.nodes)
      .filter(n => n.parentId)
      .map(n => ({
        id: `${n.parentId}->${n.id}`,
        source: n.parentId!,
        target: n.id,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed },
      }));

    setRfNodes(nodes);
    setRfEdges(edges);
  }, [tree, selectedNodeIds]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setRfNodes(nds => applyNodeChanges(changes, nds)),
    []
  );

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    setSelectedNodeIds(prev => {
      if (prev.includes(node.id)) {
        return prev.filter(id => id !== node.id);
      }
      if (prev.length === 2) {
        return [prev[1], node.id];
      }
      return [...prev, node.id];
    });
  }, []);

  const mutate=async(action:string,payload:any)=>{try{setTree(await request('WORKSPACE_ACTION',{action,payload}));setError('')}catch(e){setError((e as Error).message)}};
  const fork=()=>selectedNodeIds.length===1&&mutate('tree_fork',{nodeId:selectedNodeIds[0]});
  const checkpoint=()=>selectedNodeIds.length===1&&mutate('tree_checkpoint',{nodeId:selectedNodeIds[0],label});
  const compare=()=>{if(selectedNodeIds.length!==2)return;setComparison(selectedNodeIds.map(id=>{const n=tree.nodes[id];return `${n.nlInput}\nConnection: ${(n as any).connectionId}\n${n.sql}\nStatus: ${n.status}; ${n.executionTimeMs??'not measured'} ms; ${n.rowCount??'not measured'} rows`}).join('\n\nCompared with:\n\n'))};

  return (
    <section className="workspace-section query-history"><h1>Query history</h1><p className="page-intro">Select one query to copy its branch or mark a useful version. Select two queries to compare their saved SQL and execution details.</p>
      {(comparison||error)&&<div className="p-4"><pre style={{whiteSpace:'pre-wrap'}}>{comparison}</pre><p role="alert">{error}</p></div>}
      {/* Toolbar */}
      <div className="workspace-actions">
        <button
          onClick={fork}
          disabled={selectedNodeIds.length !== 1}
          className="text-xs px-2 py-1 border border-qm-border rounded disabled:opacity-30"
        >
          Copy query branch
        </button>
        <button
          onClick={compare}
          disabled={selectedNodeIds.length !== 2}
          className="text-xs px-2 py-1 border border-qm-border rounded disabled:opacity-30"
        >
          Compare saved SQL
        </button>
        <input aria-label="Version name" placeholder="Name this version" value={label} onChange={e=>setLabel(e.target.value)}/>
        <button
          onClick={checkpoint}
          disabled={selectedNodeIds.length !== 1 || !label.trim()}
          className="text-xs px-2 py-1 border border-qm-border rounded disabled:opacity-30"
        >
          Mark version
        </button>
        <span className="text-xs opacity-60 ml-2 self-center">
          {selectedNodeIds.length} selected
        </span>
      </div>

      {rfNodes.length === 0 ? (
        <div className="empty-state">
          No queries yet. Ask a question in “Ask your data”; its query will appear here.
        </div>
      ) : (
        <div className="query-diagram"><ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          onNodesChange={onNodesChange}
          onNodeClick={onNodeClick}
          fitView
        >
          <Background />
          <Controls />
        </ReactFlow></div>
      )}
    </section>
  );
}

function computePosition(node: QueryNode, tree: QueryTreeData): { x: number; y: number } {
  // Simple top-down layout by depth + sibling index
  let depth = 0;
  let current: QueryNode | undefined = node;
  while (current?.parentId) {
    depth++;
    current = tree.nodes[current.parentId];
  }
  const siblingsAtDepth = Object.values(tree.nodes).filter(n => {
    let d = 0;
    let cur: QueryNode | undefined = n;
    while (cur?.parentId) {
      d++;
      cur = tree.nodes[cur.parentId];
    }
    return d === depth;
  });
  const siblingIdx = siblingsAtDepth.findIndex(n => n.id === node.id);
  return {
    x: 100 + siblingIdx * 280,
    y: 80 + depth * 140,
  };
}
