"""Fail-closed SQL safety and schema grounding."""
from __future__ import annotations
import re
import sqlglot
from sqlglot import exp
from sqlglot.optimizer.qualify import qualify

SAFE_ANONYMOUS = {'strftime', 'date', 'datetime', 'julianday', 'unixepoch', 'printf',
                  'ifnull', 'iif', 'group_concat', 'json_extract', 'json_valid',
                  'json_array_length', 'json_type', 'typeof', 'round', 'concat'}
MUTATING = {'Insert', 'Update', 'Delete', 'Create', 'Drop', 'Alter', 'Merge',
            'TruncateTable', 'Into', 'Copy', 'Grant', 'Revoke', 'Lock', 'Transaction',
            'Commit', 'Rollback', 'Set', 'Use', 'Attach', 'Detach', 'Pragma', 'Execute'}

class Validator:
    def __init__(self, dialect: str = 'postgres') -> None:
        self.dialect = 'postgres' if dialect == 'postgresql' else dialect

    def validate_syntax(self, sql: str, max_retries: int = 0):
        try:
            items = [a for a in sqlglot.parse(sql, read=self.dialect) if a]
            if not items or any(isinstance(a, exp.Command) for a in items):
                return False, 'Empty or unsupported SQL statement.'
            return True, None
        except Exception as exc:
            return False, str(exc)

    def validate_semantic(self, sql: str, schema_chunks: list[dict]) -> bool:
        try:
            schema = {t['tableName']: {c['name']: c.get('type', 'TEXT')
                      for c in t.get('columns', [])} for t in schema_chunks}
            statements=[a for a in sqlglot.parse(sql,read=self.dialect) if a]
            if len(statements)!=1 or not self.is_read_only_script(sql):return False
            ast = statements[0]
            if not isinstance(ast, exp.Query):
                return False
            qualify(ast, dialect=self.dialect, schema=schema, infer_schema=False,
                    validate_qualify_columns=True, identify=False)
            # qualify validates columns, but unknown tables with '*' need a check.
            from sqlglot.optimizer.scope import traverse_scope
            known = {n.lower() for n in schema}
            for scope in traverse_scope(ast):
                for _, (_, source) in scope.selected_sources.items():
                    if isinstance(source, exp.Table) and source.name.lower() not in known:
                        return False
            return True
        except Exception:
            return False

    def _read_ast(self, ast) -> bool:
        if isinstance(ast, exp.Command) and str(ast.this).upper() == 'EXPLAIN':
            inner = str(ast.expression.this) if ast.expression else ''
            # EXPLAIN is opaque to sqlglot. Only accept a re-parsed query.
            inner = re.sub(r'^\s*(\([^)]*\)|ANALYZE|VERBOSE|QUERY PLAN)\s*', '', inner, flags=re.I)
            return self.is_read_only_script(inner)
        if not isinstance(ast, exp.Query):
            return False
        for node in ast.walk():
            if type(node).__name__ in MUTATING or isinstance(node, exp.Command):
                return False
            if isinstance(node, exp.Anonymous) and node.name.lower() not in SAFE_ANONYMOUS:
                return False
            if isinstance(node, exp.Func):
                name = node.sql_name().lower()
                if any(x in name for x in ('nextval', 'setval', 'advisory', 'dblink', 'lo_export', 'sleep')):
                    return False
        return True

    def is_read_only(self, sql: str) -> bool:
        return self.is_read_only_script(sql)

    def is_read_only_script(self, sql: str) -> bool:
        try:
            asts = [a for a in sqlglot.parse(sql, read=self.dialect) if a]
            return bool(asts) and all(self._read_ast(a) for a in asts)
        except Exception:
            return False
