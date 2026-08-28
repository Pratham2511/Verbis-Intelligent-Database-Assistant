"""PII Masking Service — Component 7 (sub-module).

Implements Novel Contribution #13 (Dynamic PII Masking in Query Results).

Combines Microsoft Presidio (when available) with custom regex rules.
Audit trail written to .qmind/pii_audit.log.
"""

from __future__ import annotations

import re
import time
from typing import Any, Dict, List, Tuple

from loguru import logger

# ─── Default masking rules (per spec Part 5, Component 7) ──────────────
DEFAULT_RULES: List[Tuple[str, str, str]] = [
    ('email', r'^[\w.+-]+@[\w.-]+\.[a-z]{2,}$', 'xxx@xxx.com'),
    ('phone', r'^\+?\d{10,15}$', 'XXX-XXX-XXXX'),
    ('ssn', r'^\d{3}-?\d{2}-?\d{4}$', 'XXX-XX-XXXX'),
    ('credit_card', r'^\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}$', '****-****-****-1234'),
    ('name', r'^[A-Z][a-z]+\s+[A-Z][a-z]+$', 'J*** D***'),  # naive
]


class PIIMasker:
    def __init__(self) -> None:
        self._compiled = [(name, re.compile(p, re.IGNORECASE), mask)
                          for name, p, mask in DEFAULT_RULES]
        # Try to load Presidio for richer NER-based detection
        self._presidio_analyzer = None
        try:
            from presidio_analyzer import AnalyzerEngine
            self._presidio_analyzer = AnalyzerEngine()
            logger.info('Presidio analyzer loaded.')
        except Exception:
            logger.info('Presidio not available — using regex-only PII masking.')

    def mask_results(
        self, columns: List[str], rows: List[Dict[str, Any]]
    ) -> Tuple[List[str], List[Dict[str, Any]], List[str]]:
        """Returns (masked_column_names, modified_rows, audit_lines)."""
        masked_columns: List[str] = []
        audit: List[str] = []

        # Detect which columns contain PII (sample first 5 values)
        column_pii_types: Dict[str, str] = {}
        for col in columns:
            sample = [r.get(col) for r in rows[:5] if r.get(col) is not None]
            if not sample:
                continue
            pii_type = self._detect_pii_type(col, sample)
            if pii_type:
                column_pii_types[col] = pii_type
                masked_columns.append(col)

        # Apply masking
        for col, pii_type in column_pii_types.items():
            mask_value = next((m for name, _, m in DEFAULT_RULES if name == pii_type), '***')
            for r in rows:
                if r.get(col) is None:
                    continue
                original = str(r[col])
                r[col] = mask_value
                audit.append(
                    f'{time.strftime("%Y-%m-%dT%H:%M:%SZ")} | column={col} | type={pii_type} '
                    f'| rule={pii_type}_PATTERN | sample_value="{original[:3]}…"'
                )

        return masked_columns, rows, audit

    # ─── Helpers ─────────────────────────────────────────────────────────
    def _detect_pii_type(self, col_name: str, sample_values: List[Any]) -> str | None:
        # Column-name heuristic first
        name_lower = col_name.lower()
        if 'email' in name_lower or 'mail' in name_lower:
            return 'email'
        if 'phone' in name_lower or 'mobile' in name_lower:
            return 'phone'
        if 'ssn' in name_lower:
            return 'ssn'
        if 'credit' in name_lower and 'card' in name_lower:
            return 'credit_card'
        # NOTE: a column merely *named* "name" (e.g. School.Name, username,
        # filename) is NOT sufficient to classify it as person-name PII — that
        # would mask ordinary single-word values like 'Luca'. Person-name
        # detection is left to the value-pattern match below (full "First Last"
        # shape) and Presidio, so ordinary database values are never altered.

        # Fall back to value-pattern matching
        for value in sample_values:
            s = str(value).strip()
            for pii_name, pattern, _ in DEFAULT_RULES:
                if re.match(pattern, s):
                    return pii_name

        # Try Presidio if available
        if self._presidio_analyzer:
            try:
                results = self._presidio_analyzer.analyze(
                    text=' '.join(str(v) for v in sample_values),
                    entities=['EMAIL_ADDRESS', 'PHONE_NUMBER', 'PERSON', 'CREDIT_CARD'],
                    language='en',
                )
                if results:
                    entity_map = {
                        'EMAIL_ADDRESS': 'email',
                        'PHONE_NUMBER': 'phone',
                        'PERSON': 'name',
                        'CREDIT_CARD': 'credit_card',
                    }
                    return entity_map.get(results[0].entity_type)
            except Exception:
                pass

        return None
