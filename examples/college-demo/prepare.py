"""Create a NEW disposable demo folder; never overwrite a folder or user database."""
import argparse
import csv
import json
import shutil
import sqlite3
from pathlib import Path

SOURCE = Path(__file__).resolve().parent
FILES = ('employees.csv', 'departments.csv', 'payments.csv', 'annual-payroll.csv',
         'schema.sql', 'queries.json', 'expected-results.json', 'payroll.py', 'verify.py', 'README.md')


def prepare(destination):
    destination = Path(destination).expanduser().resolve()
    destination.mkdir(parents=True, exist_ok=False)
    try:
        for name in FILES:
            shutil.copyfile(SOURCE / name, destination / name)
        with sqlite3.connect(destination / 'employees.db') as database:
            database.execute('PRAGMA foreign_keys=ON')
            database.executescript((SOURCE / 'schema.sql').read_text(encoding='utf-8'))
            for table, columns in (('departments', 2), ('employees', 4), ('payments', 3)):
                with (SOURCE / (table + '.csv')).open(encoding='utf-8', newline='') as stream:
                    reader = csv.reader(stream)
                    next(reader)
                    rows = [[None if value == '' else value for value in row] for row in reader]
                database.executemany(f'INSERT INTO {table} VALUES ({",".join("?" for _ in range(columns))})', rows)
        (destination / 'DEMO.json').write_text(json.dumps({
            'synthetic': True, 'salaryCurrency': 'INR', 'salaryPeriod': 'monthly',
            'aiUsed': False, 'database': 'employees.db', 'expectedEmployeeRows': 5,
        }, indent=2) + '\n', encoding='utf-8')
    except Exception:
        # Preserve the partial folder for diagnosis. Never delete a supplied path.
        raise
    return destination


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', help='A new folder that does not exist yet')
    args = parser.parse_args()
    try:
        target = prepare(args.destination)
    except (OSError, sqlite3.Error) as error:
        parser.exit(1, f'Demo setup stopped: {error}\nUse a new folder; existing files are preserved.\n')
    print(f'Created synthetic demo: {target}\nOpen this folder in VS Code. No AI or credentials were used.')
