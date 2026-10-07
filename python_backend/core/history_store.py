"""History + Query Tree store — .qmind/history.json + .qmind/query_tree.json.

Implements Novel Contribution #3 (Query Genealogy) and the persistence layer
for Novel Contribution #14 (Interactive Query Tree DAG).
"""

from __future__ import annotations

import time
import uuid
from pathlib import Path
from typing import Dict, List, Optional
from services.workspace_store import WorkspaceStore


class HistoryStore:
    def __init__(self, history_path: Path, tree_path: Path) -> None:
        self._history_path = history_path
        self._tree_path = tree_path
        self._history = WorkspaceStore(history_path)
        self._tree = WorkspaceStore(tree_path)
        self._lock = self._tree.lock

    # ─── history.json ────────────────────────────────────────────────
    def read_history(self) -> List[dict]:
        if not self._history_path.exists():
            return []
        try:
            value = self._history.read([])
            if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
                raise ValueError('Expected a list of history entries')
            return value
        except Exception as exc:
            raise RuntimeError('History file is unreadable; existing data was preserved') from exc

    def append_history(self, entry: dict) -> None:
        with self._history.lock:
            history = self.read_history()
            history.append(entry)
            history = history[-5000:]
            self._history.write(history)

    # ─── query_tree.json ─────────────────────────────────────────────
    def read_tree(self) -> Dict:
        if not self._tree_path.exists():
            return {'nodes': {}, 'rootIds': [], 'checkpoints': []}
        try:
            value = self._tree.read({})
            if not isinstance(value, dict) or not isinstance(value.get('nodes'), dict) or not isinstance(value.get('rootIds'), list) or not isinstance(value.get('checkpoints'), list):
                raise ValueError('Expected a query tree')
            return value
        except Exception as exc:
            raise RuntimeError('Query tree is unreadable; existing data was preserved') from exc

    def write_tree(self, tree: Dict) -> None:
        with self._lock:
            self._tree.write(tree)

    def append_query_tree_node(
        self,
        nl_input: str,
        sql: str,
        confidence: float,
        status: str = 'unexecuted',
        connection_id=None, session_id=None, schema_fingerprint=None,
    ) -> str:
        with self._lock:
            node_id = str(uuid.uuid4())
            tree = self.read_tree()
            parents = [n for n in tree['nodes'].values() if n.get('sessionId') == session_id and n.get('connectionId') == connection_id]
            parent_id = parents[-1]['id'] if parents and session_id else None
            tree['nodes'][node_id] = {
                'id': node_id,
                'parentId': parent_id,
                'connectionId': connection_id, 'sessionId': session_id, 'schemaFingerprint': schema_fingerprint,
                'nlInput': nl_input,
                'sql': sql,
                'confidence': confidence,
                'status': status,
                'timestamp': time.time() * 1000,
                'annotationCount': 0,
            }
            if parent_id: tree['nodes'][parent_id].setdefault('childrenIds', []).append(node_id)
            else: tree['rootIds'].append(node_id)
            self.write_tree(tree)
            return node_id

    def update_query_tree_node_status(
        self,
        sql: str,
        status: str,
        execution_time_ms: Optional[float] = None,
        row_count: Optional[int] = None,
        connection_id: Optional[str] = None,
    ) -> None:
        with self._lock:
            tree = self.read_tree()
            # Find most recent node with matching SQL
            for node in reversed(list(tree['nodes'].values())):
                if _normalize_sql(node.get('sql', '')) == _normalize_sql(sql) and (connection_id is None or node.get('connectionId') == connection_id):
                    node['status'] = status
                    if execution_time_ms is not None:
                        node['executionTimeMs'] = execution_time_ms
                    if row_count is not None:
                        node['rowCount'] = row_count
                    # Append perf sparkline entry
                    sparkline = node.get('perfSparkline', [])
                    if execution_time_ms is not None:
                        sparkline.append(execution_time_ms)
                        node['perfSparkline'] = sparkline[-10:]
                    break
            self.write_tree(tree)

    def checkpoint(self,node_id,label):
        if not label.strip() or len(label)>120:raise ValueError('Checkpoint label must be 1–120 characters')
        with self._lock:
            tree=self.read_tree()
            if node_id not in tree['nodes']:raise ValueError('Query node no longer exists')
            tree['nodes'][node_id]['checkpointLabel']=label
            if node_id not in tree['checkpoints']:tree['checkpoints'].append(node_id)
            self.write_tree(tree);return tree
    def fork(self,node_id):
        with self._lock:
            tree=self.read_tree()
            if node_id not in tree['nodes']:raise ValueError('Query node no longer exists')
            node=tree['nodes'][node_id].copy();id=str(uuid.uuid4())
            node.update(id=id,parentId=node_id,childrenIds=[],status='unexecuted',timestamp=time.time()*1000)
            for key in ('executionTimeMs','rowCount','perfSparkline','checkpointLabel'):node.pop(key,None)
            tree['nodes'][id]=node;tree['nodes'][node_id].setdefault('childrenIds',[]).append(id)
            self.write_tree(tree);return tree


def _normalize_sql(sql: str) -> str:
    return ' '.join(sql.lower().split())
