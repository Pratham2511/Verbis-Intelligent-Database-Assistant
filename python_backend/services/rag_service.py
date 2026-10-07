"""Offline, connection-scoped schema index. No implicit model downloads."""
import json
import re
import threading
from pathlib import Path

class RAGService:
    def __init__(self, persist_dir: str):
        self._lock = threading.RLock()
        self._path = Path(persist_dir) / 'schema-index.json'
        try: self._schemas = json.loads(self._path.read_text())
        except (OSError, ValueError): self._schemas = {}

    def index_schema(self, tables: list[dict], connection_id: str = 'default') -> bool:
        with self._lock:
            self._schemas[connection_id] = tables
            self._path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self._path.with_suffix('.tmp')
            tmp.write_text(json.dumps(self._schemas, default=str))
            tmp.replace(self._path)
            return True

    def _build_doc(self, table):
        cols = ', '.join(f"{c['name']} {c['type']}" for c in table.get('columns', []))
        fks = ', '.join(f"{f['column']} -> {f['referencedTable']}.{f['referencedColumn']}"
                        for f in table.get('foreignKeys', []))
        return f"Table {table['tableName']}: {cols}. Relationships: {fks}"

    def retrieve_relevant(self, nl_input: str, top_k: int = 8, connection_id: str = 'default'):
        words = set(re.findall(r'\w+', nl_input.lower()))
        tables = self._schemas.get(connection_id, [])
        ranked = sorted(tables, key=lambda t: len(words & set(re.findall(r'\w+', self._build_doc(t).lower()))), reverse=True)
        return [{**t, 'doc': self._build_doc(t)} for t in ranked[:top_k]]

    def close(self): pass
