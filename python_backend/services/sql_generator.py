"""Text-to-SQL Generator — Component 5.

Implements Novel Contribution #17 (Multi-Path Reasoning with
Execution-Grounded Candidate Selection).

Generates 3 candidate SQL queries via distinct reasoning strategies:
    Path 1 — Direct       (single-shot LLM call)
    Path 2 — CoT          (chain-of-thought: schema linking → CTE → final)
    Path 3 — Skeleton     (SELECT/FROM/WHERE skeleton first, then fill)

The execution-grounded ranking is in confidence_service.py.
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from typing import List

from core.memory_store import MemoryData
from core.prompt_builder import build_generation_prompt
from services.llm_service import LLMRouter


@dataclass
class SQLCandidate:
    sql: str
    interpretation: str
    confidence: float
    strategy: str  # 'direct' | 'cot' | 'skeleton'


class SQLGenerator:
    def __init__(self, llm: LLMRouter) -> None:
        self.llm = llm

    async def generate_multipath(
        self,
        nl_input: str,
        schema: List[dict],
        memory: MemoryData,
        use_cloud: bool = True,
        dialect: str = 'postgresql',
    ) -> List[SQLCandidate]:
        """Run all three paths in parallel."""
        tasks = [
            self._generate_path(nl_input, schema, memory, 'direct', use_cloud, dialect),
            self._generate_path(nl_input, schema, memory, 'cot', use_cloud, dialect),
            self._generate_path(nl_input, schema, memory, 'skeleton', use_cloud, dialect),
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        candidates: List[SQLCandidate] = []
        for strategy, result in zip(['direct', 'cot', 'skeleton'], results):
            if isinstance(result, Exception):
                continue
            sql = self._extract_sql(result)
            if sql:
                candidates.append(SQLCandidate(
                    sql=sql,
                    interpretation=f'Generated via {strategy.upper()} strategy',
                    confidence=0.7,  # Will be overridden by ConfidenceScorer
                    strategy=strategy,
                ))
        return candidates

    async def _generate_path(
        self,
        nl_input: str,
        schema: List[dict],
        memory: MemoryData,
        strategy: str,
        use_cloud: bool,
        dialect: str = 'postgresql',
    ) -> str:
        system, user = build_generation_prompt(nl_input, schema, memory,
                                                dialect=dialect,
                                                strategy=strategy)
        resp = await self.llm.complete(system, user, use_cloud=use_cloud)
        if resp.error:
            raise RuntimeError(f'LLM error ({resp.mode}): {resp.error}')
        return resp.text

    def _extract_sql(self, llm_output: str) -> str:
        """Extract SQL from the LLM response, stripping code fences and prose."""
        # Strip markdown code fences
        sql = re.sub(r'```(?:sql)?\s*', '', llm_output)
        sql = sql.split('```')[0]
        # Find the first SELECT/WITH statement
        match = re.search(r'((?:SELECT|WITH)\s+.*?;?\s*$)', sql, re.IGNORECASE | re.DOTALL)
        if match:
            return match.group(1).strip().rstrip(';')
        return sql.strip()
