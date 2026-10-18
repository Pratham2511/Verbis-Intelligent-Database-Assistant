"""Check reviewed SQL against independent expected answers; no AI and read-only SQLite."""
import argparse
import csv
import hashlib
import json
import sqlite3
from pathlib import Path


def verify(folder):
    folder = Path(folder).resolve()
    marker = json.loads((folder / 'DEMO.json').read_text(encoding='utf-8'))
    if marker.get('synthetic') is not True:
        raise ValueError('This is not a prepared synthetic demo folder')
    database = folder / 'employees.db'
    digest = hashlib.sha256(database.read_bytes()).hexdigest()
    queries = json.loads((folder / 'queries.json').read_text(encoding='utf-8'))
    expected = json.loads((folder / 'expected-results.json').read_text(encoding='utf-8'))
    # Compute the important business cases from CSV using Python, independent of SQL.
    with (folder / 'employees.csv').open(encoding='utf-8', newline='') as stream:
        employees = [{**r, 'id': int(r['id']), 'salary': int(r['salary']) if r['salary'] else None} for r in csv.DictReader(stream)]
    above = [r for r in employees if r['salary'] is not None and r['salary'] > 8000]
    if expected['above-8000'] != above or expected['only-it'] != [r for r in above if r['department'] == 'IT']:
        raise AssertionError('Approved expected answers disagree with the independent CSV calculation')
    totals = [{'department': name, 'monthly_payroll': sum(r['salary'] or 0 for r in employees if r['department'] == name)} for name in sorted({r['department'] for r in employees})]
    if totals != expected['payroll-chart']:
        raise AssertionError('Expected totals disagree with independent CSV calculation')
    passed = []
    with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as connection:
        connection.row_factory = sqlite3.Row
        connection.execute('PRAGMA query_only=ON')
        for query in queries:
            rows = [dict(r) for r in connection.execute(query['sql'], query['parameters'])]
            if rows != expected[query['id']]:
                raise AssertionError(f'Unexpected result for {query["id"]}: {rows!r}')
            passed.append(query['id'])
    if hashlib.sha256(database.read_bytes()).hexdigest() != digest:
        raise AssertionError('Source database changed during verification')
    return {'synthetic': True, 'realAIRequests': 0, 'passed': passed, 'sourceUnchanged': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder', nargs='?', default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.folder), indent=2))
    except (OSError, ValueError, AssertionError, sqlite3.Error) as error:
        parser.exit(1, f'Demo verification failed: {error}\n')
