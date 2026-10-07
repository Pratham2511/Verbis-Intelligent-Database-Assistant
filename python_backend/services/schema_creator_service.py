"""
Text2Schema Service — NL description → normalized database schema.

Research: arXiv 2503.23886 (Text2Schema, Oct 2025)
"Schema design demands domain expertise. Research on directly generating
schemas from natural language requirements remains unexplored."

Verbis implements this as a production VS Code feature — the first IDE
extension to support the complete database lifecycle:
create → query → optimize → explain.
"""

import json
import re
from typing import Optional

from openai import AsyncOpenAI

from services.llm_service import (
    DEFAULT_GEMINI_MODEL,
    DEFAULT_GROQ_MODEL,
    DEFAULT_LOCAL_MODEL,
)


from services.llm_service import _get_client
from services.llm_service import generation_options, completion_text


SCHEMA_SYSTEM_PROMPT = """You are an expert database architect inside Verbis.
Convert natural language requirements into a production-ready relational schema.

Rules:
1. Extract all entities (nouns representing things to store).
2. Identify one-to-many and many-to-many relationships.
3. Use standard SQL types: INT, VARCHAR(N), TEXT, DECIMAL(p,s), BOOLEAN, TIMESTAMP, DATE.
4. Every table must have an id column as PRIMARY KEY (INT, auto-increment).
5. Add FOREIGN KEY columns for all relationships.
6. For many-to-many relationships, create a junction table.
7. Normalize to 3NF — no redundant columns.
8. Add NOT NULL where logically required.
9. Add created_at TIMESTAMP to every table. Verbis adds its CURRENT_TIMESTAMP default.
10. Use snake_case for all names.
11. Constraints may only be PRIMARY KEY, AUTO_INCREMENT, NOT NULL or UNIQUE.
    Foreign keys use foreign_key objects. Do not put default expressions in constraints.

Return ONLY a JSON object — no markdown, no explanation:
{
  "tables": [
    {
      "name": "table_name",
      "description": "what this table stores",
      "columns": [
        {
          "name": "id",
          "type": "INT",
          "constraints": ["PRIMARY KEY", "AUTO_INCREMENT"],
          "foreign_key": null
        },
        {
          "name": "customer_id",
          "type": "INT",
          "constraints": ["NOT NULL"],
          "foreign_key": {"references_table": "customers", "references_column": "id"}
        }
      ],
      "indexes": ["customer_id", "created_at"]
    }
  ],
  "relationships": [
    {
      "from_table": "orders",
      "to_table": "customers",
      "type": "many_to_one",
      "description": "Each order belongs to one customer"
    }
  ]
}"""


async def generate_schema_from_nl(
    description: str,
    dialect: str = "postgresql",
    provider: str = "gemini",
    api_key: str = "",
    model: Optional[str] = None,
) -> dict:
    """Convert NL description into structured schema JSON."""
    client, model = _get_client(provider, api_key, model)
    try:
        r = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": SCHEMA_SYSTEM_PROMPT},
                {"role": "user", "content": f"Dialect: {dialect}\nRequirements:\n{description}\n\nSchema JSON:"},
            ],
            temperature=0.1,
            max_tokens=4096,
            **generation_options(provider, model),
        )
        raw = completion_text(r)
        raw = raw.replace("```json", "").replace("```", "").strip()
        return json.loads(raw)
    finally:
        await client.close()


def schema_to_ddl(schema: dict, dialect: str = "postgresql") -> str:
    """
    Convert structured schema JSON to executable DDL.

    CRITICAL: Foreign keys are emitted as TABLE-LEVEL CONSTRAINT clauses,
    NOT inline in the column definition. Inline FK syntax works in SQLite
    but FAILS in PostgreSQL and MySQL. This is portable across all dialects.
    """
    validate_schema(schema)
    if dialect not in {'postgresql','mysql','sqlite'}: raise ValueError('Unsupported dialect')
    statements = []

    auto_inc_type = {
        "postgresql": "SERIAL",
        "mysql": "INT AUTO_INCREMENT",
        "sqlite": "INTEGER",
    }.get(dialect, "SERIAL")

    quote = '`' if dialect == 'mysql' else '"'
    identifier = lambda name: quote + name + quote
    for table in ordered_tables(schema, dialect):
        cols = []
        fk_clauses = []

        for col in table.get("columns", []):
            constraints = col.get("constraints", [])
            col_type = col["type"].upper()

            if "AUTO_INCREMENT" in constraints and "PRIMARY KEY" in constraints:
                col_type = auto_inc_type
                constraints = [c for c in constraints if c != "AUTO_INCREMENT"]

            col_def = f"  {identifier(col['name'])} {col_type}"
            if "PRIMARY KEY" in constraints:
                col_def += " PRIMARY KEY"
            if "NOT NULL" in constraints and "PRIMARY KEY" not in constraints:
                col_def += " NOT NULL"
            if "UNIQUE" in constraints:
                col_def += " UNIQUE"
            if col["name"] == "created_at" and col_type == 'TIMESTAMP':
                col_def += " DEFAULT CURRENT_TIMESTAMP"
            cols.append(col_def)

            fk = col.get("foreign_key")
            if fk:
                fk_clauses.append(
                    f"  CONSTRAINT {identifier(object_name('fk',table['name'],col['name']))} "
                    f"FOREIGN KEY ({identifier(col['name'])}) "
                    f"REFERENCES {identifier(fk['references_table'])}({identifier(fk['references_column'])})"
                )

        all_cols = cols + fk_clauses
        table_comment = f"-- {str(table.get('description', table['name'])).replace(chr(10), ' ').replace(chr(13), ' ')}"
        ddl = f"{table_comment}\nCREATE TABLE IF NOT EXISTS {identifier(table['name'])} (\n" + ",\n".join(all_cols) + "\n);"
        statements.append(ddl)

        for idx_col in table.get("indexes", []):
            statements.append(
                f"CREATE INDEX {'IF NOT EXISTS ' if dialect != 'mysql' else ''}{identifier(object_name('idx',table['name'],idx_col))} "
                f"ON {identifier(table['name'])}({identifier(idx_col)});"
            )

    return "\n\n".join(statements)


def object_name(prefix, table, column):
    import hashlib
    name = f'{prefix}_{table}_{column}'
    return name if len(name) <= 63 else name[:54] + '_' + hashlib.sha256(name.encode()).hexdigest()[:8]


def ordered_tables(schema, dialect):
    tables = schema['tables']
    if dialect == 'sqlite': return tables
    remaining = list(tables)
    created = set()
    ordered = []
    while remaining:
        ready = [t for t in remaining if all(not c.get('foreign_key') or
                 c['foreign_key']['references_table'] in created | {t['name']}
                 for c in t['columns'])]
        if not ready:
            raise ValueError('Cyclic foreign keys require a separate reviewed migration for this dialect')
        for table in ready:
            ordered.append(table);created.add(table['name']);remaining.remove(table)
    return ordered


def schema_to_mermaid(schema: dict) -> str:
    """Convert schema JSON to Mermaid ER diagram source for live rendering."""
    lines = ["erDiagram"]
    for table in schema.get("tables", []):
        lines.append(f"  {table['name'].upper()} {{")
        for col in table.get("columns", []):
            cs = col.get("constraints", [])
            marker = "PK" if "PRIMARY KEY" in cs else ("FK" if col.get("foreign_key") else "")
            diagram_type = re.sub(r'\(.*\)', '', col['type']).upper()
            lines.append(f"    {diagram_type} {col['name']}{' ' + marker if marker else ''}")
        lines.append("  }")
    for rel in schema.get("relationships", []):
        rel_map = {
            "one_to_many": "||--o{",
            "many_to_one": "}o--||",
            "many_to_many": "}o--o{",
            "one_to_one": "||--||",
        }
        sym = rel_map.get(rel["type"], "||--o{")
        desc = re.sub(r'["\\\n\r<>]', ' ' , rel.get("description", rel["type"]))[:30]
        lines.append(f'  {rel["from_table"].upper()} {sym} {rel["to_table"].upper()} : "{desc}"')
    return "\n".join(lines)


def count_tables(ddl: str) -> int:
    """Count CREATE TABLE statements in generated DDL."""
    return sum(1 for line in ddl.split('\n') if 'CREATE TABLE' in line.upper())


async def refine_schema(
    existing_schema: dict,
    refinement: str,
    dialect: str = "postgresql",
    provider: str = "gemini",
    api_key: str = "",
    model: Optional[str] = None,
) -> dict:
    """Apply a NL refinement request to an existing schema. Returns the COMPLETE updated schema."""
    client, model = _get_client(provider, api_key, model)
    try:
        r = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": SCHEMA_SYSTEM_PROMPT},
                {"role": "user", "content": (
                    f"Dialect: {dialect}\nExisting schema:\n{json.dumps(existing_schema, indent=2)}\n\n"
                    f"Refinement: {refinement}\n\n"
                    f"Return the COMPLETE updated schema JSON including all existing tables:"
                )},
            ],
            temperature=0.1,
            max_tokens=4096,
            **generation_options(provider, model),
        )
        raw = completion_text(r)
        raw = raw.replace("```json", "").replace("```", "").strip()
        return json.loads(raw)
    finally:
        await client.close()


def validate_schema(schema):
    if not isinstance(schema,dict): raise ValueError('Schema must be an object')
    tables=schema.get('tables')
    if not isinstance(tables,list) or not tables: raise ValueError('Schema needs tables')
    names=set()
    for t in tables:
        if not isinstance(t,dict) or not isinstance(t.get('name'),str) or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,62}',t['name']) or t['name'].lower() in names: raise ValueError('Invalid or duplicate table')
        names.add(t['name'].lower())
        cols=set()
        if not isinstance(t.get('columns'),list) or not t['columns']: raise ValueError('Table needs columns')
        primary_keys = 0
        for c in t['columns']:
            if not isinstance(c,dict) or not isinstance(c.get('name'),str) or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,62}',c['name']) or c['name'].lower() in cols: raise ValueError('Invalid or duplicate column')
            cols.add(c['name'].lower())
            if not isinstance(c.get('type'),str) or not re.fullmatch(r'(INT|INTEGER|BIGINT|SMALLINT|TEXT|REAL|FLOAT|DOUBLE|BOOLEAN|TIMESTAMP|DATE|VARCHAR\(\d+\)|DECIMAL\(\d+,\s*\d+\))',c['type'],re.I): raise ValueError('Unsupported type')
            constraints=c.get('constraints',[])
            if not isinstance(constraints,list) or any(not isinstance(x,str) for x in constraints): raise ValueError('Unsupported constraint')
            allowed={'PRIMARY KEY','AUTO_INCREMENT','NOT NULL','UNIQUE'}
            if c['name']=='created_at' and c['type'].upper()=='TIMESTAMP':allowed.add('DEFAULT CURRENT_TIMESTAMP')
            if set(constraints)-allowed: raise ValueError('Unsupported constraint')
            if 'AUTO_INCREMENT' in constraints and ('PRIMARY KEY' not in constraints or c['type'].upper() not in {'INT','INTEGER','BIGINT','SMALLINT'}):raise ValueError('Auto increment requires an integer primary key')
            primary_keys += 'PRIMARY KEY' in constraints
        if primary_keys > 1:raise ValueError('Composite primary keys require a separate reviewed migration')
        indexes=t.get('indexes',[])
        if not isinstance(indexes,list) or any(not isinstance(x,str) or x not in {c['name'] for c in t['columns']} for x in indexes): raise ValueError('Unknown indexed column')
    for t in tables:
        for c in t['columns']:
            f=c.get('foreign_key')
            if f:
                if not isinstance(f,dict):raise ValueError('Invalid foreign key')
                target=next((x for x in tables if x['name']==f.get('references_table')),None)
                if not target or f.get('references_column') not in {x['name'] for x in target['columns']}: raise ValueError('Unknown foreign key target')
                target_column=next(x for x in target['columns'] if x['name']==f['references_column'])
                if not set(target_column.get('constraints',[])) & {'PRIMARY KEY','UNIQUE'}:raise ValueError('Foreign key target must be primary or unique')
    relationships=schema.get('relationships',[])
    if not isinstance(relationships,list):raise ValueError('Invalid relationships')
    for rel in relationships:
        if not isinstance(rel,dict) or rel.get('from_table') not in {t['name'] for t in tables} or rel.get('to_table') not in {t['name'] for t in tables} or rel.get('type') not in {'one_to_many','many_to_one','many_to_many','one_to_one'}:raise ValueError('Invalid relationship')
