"""Performance Regression Detector — Component 7 (sub-module).

Implements Novel Contribution #11 (Performance Regression Detector).

Maintains a rolling baseline (last N executions per query fingerprint).
If current_time > baseline * 1.20, generates a regression alert and
auto-triggers the Optimizer (Component 6 Step 4).
"""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Dict, List, Optional, Any

from loguru import logger
import hashlib


class PerfTracker:
    def __init__(self, log_path: Path, baseline_window: int = 10,
                 threshold_pct: float = 20.0) -> None:
        self._log_path = log_path
        self._baseline_window = baseline_window
        self._threshold_pct = threshold_pct
        self._lock = threading.Lock()
        self._cache: Optional[List[Dict]] = None

    # ─── Public API ─────────────────────────────────────────────────────
    def record(self, fingerprint: str, execution_time_ms: float,
               rows_scanned: Optional[int] = None) -> Optional[Dict[str, Any]]:
        """Append to perf_log.json and return a regression alert if applicable."""
        entry = {
            'queryFingerprint': fingerprint,
            'timestamp': time.time(),
            'executionTimeMs': execution_time_ms,
            'rowsScanned': rows_scanned,
        }
        self._append_log(entry)

        baseline = self._compute_baseline(fingerprint)
        if baseline is None:
            return None

        if execution_time_ms >= 50 and execution_time_ms-baseline >= 20 and execution_time_ms > baseline * (1 + self._threshold_pct / 100):
            pct_slower = round((execution_time_ms / baseline - 1) * 100, 1)
            return {
                'percentSlower': pct_slower,
                'baselineMs': round(baseline, 1),
                'currentMs': round(execution_time_ms, 1),
                'possibleCauses': [
                    'Data growth since last run',
                    'Missing or stale index',
                    'Schema change since last run',
                    'Concurrent load on the database',
                ],
                'suggestedFix': 'Re-run the Query Optimizer to recheck indexes and plan similarity.',
            }
        return None

    # ─── Internal helpers ─────────────────────────────────────────────
    def _append_log(self, entry: Dict) -> None:
        with self._lock:
            log = self._read_log_unlocked()
            log.append(entry)
            log = log[-10000:]
            tmp = self._log_path.with_suffix('.json.tmp')
            tmp.write_text(json.dumps(log, indent=2))
            tmp.replace(self._log_path)
            self._cache = log

    def _read_log_unlocked(self) -> List[Dict]:
        if self._cache is not None:
            return self._cache
        if not self._log_path.exists():
            return []
        try:
            return json.loads(self._log_path.read_text())
        except Exception:
            return []

    def _compute_baseline(self, fingerprint: str) -> Optional[float]:
        log = self._read_log_unlocked()
        relevant = [e for e in log if e.get('queryFingerprint') == fingerprint]
        relevant = relevant[-self._baseline_window:]
        if len(relevant) < 3:
            return None  # Not enough samples yet
        return sum(e['executionTimeMs'] for e in relevant) / len(relevant)
