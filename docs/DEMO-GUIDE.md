# Five-minute Verbis demonstration

Use one disposable project and synthetic records. Demonstrate one complete
database workflow rather than every tool.

## Before presenting

1. Install the verified VSIX on the presentation machine. Open the generated
   demo folder, trust that synthetic project, and complete backend setup.
2. Prepare and verify [the fixture](../examples/college-demo/README.md). Salaries
   are 7500, 8000, 8001, 12000 and NULL, in INR per month. Keep the reviewed
   expected answers nearby.
3. Add the generated `employees.db` as a SQLite connection named **College demo**.
4. For live AI, connect one available provider/model before presenting. Generation
   uses its allowance. Reload requires ChatGPT sign-in again.
5. Keep a recording or the manual SQL path ready. Label it accurately when quota
   or the internet is unavailable; do not describe fixture output as live AI.

## Sequence

| Time | Show | Explain/check |
|---|---|---|
| 0:00–0:40 | Start, selected database, Tables/ER | Live schema and relationships ground queries. Review precedes execution. |
| 0:40–1:30 | Above 8000 → SQL review → Run | Live AI if available; otherwise explicitly **Write SQL myself**. Cara and Dev qualify; equality and NULL do not. |
| 1:30–2:10 | Only IT / parameterized SQL | Keep the threshold; Dev only. |
| 2:10–3:00 | Save/reopen, chart and export | Retain database and values. Payroll: Finance 8001, IT 27500. Export actual executed values/results. |
| 3:00–4:00 | Import employees.csv | Five rows, one empty salary, no duplicate id; INR/monthly; new imported table. No AI needed. |
| 4:00–4:45 | One advanced example | Explain Bob's exclusion, expose join expansion, or rehearse a rename on a temporary snapshot. |
| 4:45–5:00 | Limits and evidence | Supported static references, bounded diagnostics, separate real-engine tests; no universal correctness or privacy claim. |

Pick the advanced example you can explain comfortably.

## Copyable SQL without AI

Threshold:

```sql
SELECT id, name, salary, department
FROM employees
WHERE salary > :threshold
ORDER BY id
```

Value: `threshold` → Number → `8000`.

Follow-up equivalent:

```sql
SELECT id, name, salary, department
FROM employees
WHERE salary > :threshold AND department = :department
ORDER BY id
```

Values: `threshold` → Number → `8000`; `department` → Text → `IT`.

Chart:

```sql
SELECT department, SUM(salary) AS monthly_payroll
FROM employees
GROUP BY department
ORDER BY department
```

Other reviewed examples are in `queries.json`. The verifier executes seven
examples read-only and detects an incorrect `>` to `>=` boundary change.

## Record acceptance

Record source commit, VSIX hash, VS Code/Python versions, installed UI results,
provider/model and whether inference was live. Record returned ids, clarification
and error behavior, analysis reopen and export contents. Exclude credentials and
account identities. Expected answers here are acceptance conditions, not claimed
passes; see [the dated work log](WORK-LOG.md).
