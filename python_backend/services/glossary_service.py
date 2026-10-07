"""Business Glossary Service — Component 10.

Implements Novel Contribution #10 (Semantic Layer with Business Glossary).

Includes:
    - Glossary term CRUD (stored in .qmind/glossary.json)
    - Semantic Router: similarity-based deterministic vs. LLM path selection
    - Graph-structured Join Path store (BFS for shortest join path)
    - Auto-discovery: weekly scan of query logs for repeated patterns
"""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from collections import deque
from dataclasses import dataclass
from loguru import logger

from models.requests import GlossaryTerm, GlossaryStore, JoinPath
from services.sql_generator import SQLCandidate


class GlossaryService:
    _locks = {}
    _registry_lock = threading.Lock()
    SIMILARITY_HIGH = 0.80   # deterministic template SQL
    SIMILARITY_MID = 0.50    # few-shot hint

    def __init__(self, glossary_path: Path) -> None:
        self._path = glossary_path
        with self._registry_lock:
            self._lock = self._locks.setdefault(str(glossary_path.resolve()), threading.RLock())

    # ─── CRUD ──────────────────────────────────────────────────────────
    def read(self) -> GlossaryStore:
        if not self._path.exists():
            return GlossaryStore(terms=[])
        try:
            data = json.loads(self._path.read_text())
            return GlossaryStore(**data)
        except Exception as exc:
            raise ValueError('Glossary file is unreadable; existing definitions were preserved') from exc

    def write(self, store: GlossaryStore) -> None:
        with self._lock:
            tmp = self._path.with_suffix('.json.tmp')
            tmp.write_text(json.dumps(store.model_dump(), indent=2))
            tmp.replace(self._path)

    def upsert(self, term: GlossaryTerm) -> None:
        if isinstance(term, dict): term = GlossaryTerm.model_validate(term)
        with self._lock:
            store = self.read()
            store.terms = [t for t in store.terms if (t.term,t.connectionId) != (term.term,term.connectionId)]
            store.terms.append(term)
            self.write(store)

    # ─── Semantic Router (Novel #10) ───────────────────────────────────
    def route(self, nl_input: str) -> Optional[SQLCandidate]:
        """Return a deterministic SQL candidate if similarity > HIGH threshold.

        Returns None if no glossary term matches.
        """
        store = self.read()
        if not store.terms:
            return None

        best: Optional[Tuple[float, GlossaryTerm]] = None
        nl_lower = nl_input.lower()
        for term in store.terms:
            # Cheap similarity: token-overlap ratio
            aliases = term.aliases + [term.term]
            best_sim = max(
                _token_overlap(nl_lower, alias.lower()) for alias in aliases
            )
            if best_sim >= self.SIMILARITY_HIGH:
                if best is None or best_sim > best[0]:
                    best = (best_sim, term)

        if best:
            term = best[1]
            return SQLCandidate(
                sql=term.sqlTemplate,
                interpretation=f'Glossary term "{term.term}" (similarity {best[0]:.2f})',
                confidence=0.95,
                strategy='glossary',
            )
        return None

    # ─── Graph-structured Join Path BFS ─────────────────────────────────
    def shortest_join_path(self, from_table: str, to_table: str) -> List[JoinPath]:
        """BFS over the join graph to find the shortest path between two tables."""
        store = self.read()
        adj: Dict[str, List[JoinPath]] = {}
        for jp in store.joinPaths:
            adj.setdefault(jp.fromTable, []).append(jp)

        queue = deque([(from_table, [])])
        visited = {from_table}
        while queue:
            current, path = queue.popleft()
            if current == to_table:
                return path
            for jp in adj.get(current, []):
                if jp.toTable not in visited:
                    visited.add(jp.toTable)
                    queue.append((jp.toTable, path + [jp]))
        return []

    # ─── Auto-Discovery (Novel #10) ────────────────────────────────────
    def discover_repeated_patterns(self, history_store) -> List[Dict]:
        """Scan query history for patterns appearing >5 times. Suggest promoting
        them to glossary terms."""
        history = history_store.read_history()
        # Normalize SQL and count occurrences
        counts: Dict[str, List[Dict]] = {}
        for entry in history:
            normalized = ' '.join(entry.get('sql', '').lower().split())
            if not normalized:
                continue
            counts.setdefault(normalized, []).append(entry)

        suggestions: List[Dict] = []
        for sql, entries in counts.items():
            if len(entries) >= 5:
                suggestions.append({
                    'pattern': sql[:200],
                    'occurrences': len(entries),
                    'firstSeen': entries[0].get('timestamp'),
                    'lastSeen': entries[-1].get('timestamp'),
                    'suggestedName': _suggest_term_name(sql),
                })
        return suggestions


def _token_overlap(a: str, b: str) -> float:
    """Cheap cosine-like token overlap."""
    ta, tb = set(a.split()), set(b.split())
    if not ta and not tb:
        return 1.0
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def _suggest_term_name(sql: str) -> str:
    """Generate a snake_case name suggestion from the SQL."""
    # Look for aggregate functions or table names
    if 'sum(' in sql:
        return 'aggregated_total'
    if 'count(' in sql:
        return 'record_count'
    if 'avg(' in sql:
        return 'average_metric'
    return 'frequent_query'
