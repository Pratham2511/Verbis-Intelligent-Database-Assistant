# Verbis college demo

All records are synthetic. Salaries are **INR per month**, with one intentionally
missing salary. This kit uses no AI or credentials. `queries.json` contains
manually reviewed SQL examples, not recorded or simulated model responses.

From the repository root, create a new disposable folder:

```bash
python3 examples/college-demo/prepare.py /tmp/verbis-college-demo
python3 /tmp/verbis-college-demo/verify.py
code /tmp/verbis-college-demo
```

On Windows use `py -3` instead of `python3`, and a new folder such as
`C:\Temp\verbis-college-demo`. The scripts use Python's standard library.
Setup refuses an existing destination. Use a new folder to repeat the demo.

## Fast path: no AI needed

1. Install the development VSIX and run **Verbis: Install / Reinstall Backend**.
   Open **Verbis: Open Database Workspace** from the command palette.
2. Under **Settings**, add a SQLite database named **College demo**. Choose the
   generated `employees.db` file, save, and select this database.
3. **Tables** shows employees, departments and payments, including foreign keys.
4. Open **Ask your data → Write SQL myself**. Paste this SQL:

   ```sql
   SELECT id, name, salary, department
   FROM employees
   WHERE salary > :threshold
   ORDER BY id
   ```

5. Under **Query values**, add `threshold`, choose **Number**, and enter `8000`.
   Choose **Run query**. Expect **Cara (8001)** and **Dev (12000)**. Bob's exact
   8000 and Esha's NULL salary are excluded.
6. Name and save the analysis. Reopen it deliberately, change the threshold to
   `9000`, and run again: **Dev only**. Download CSV and export the readable report.
7. Start another manual query and run the `payroll-chart` SQL from `queries.json`.
   Expect **Finance: 8001; IT: 27500** and a suitable aggregate bar chart.

The generated database is outside the repository. `.qmind/` appears only when
Verbis opens the demo workspace. No existing project data is replaced.

## Show actual CSV import

Use **Import CSV** with `employees.csv`. Name the table `imported_employees`,
choose `id` as its unique identifier, and set salary to a whole number with
**INR / Monthly** units. Preview: five rows, one empty salary, zero duplicate ids.
Import and select **Workspace datasets**. Run the threshold query against
`imported_employees`; expect the same two rows. Refresh/replace applies only to
the explicitly selected imported table.

## One advanced example

Select **College demo** again.

- **Explain query results:** paste the threshold SQL with value 8000 and missing
  record identifier `2`. It fails the strict comparison. Identifier `5` has NULL,
  so its comparison is unknown. The `join-expansion` query uses two payment rows
  for Dev; the measured joined salary total is 24000, demonstrating duplication.
- **Test database changes:** use `ALTER TABLE employees RENAME COLUMN salary TO
  base_salary`. Supply `SELECT SUM(salary) AS total FROM employees` as the query
  to check. The query works before the rename and fails afterward on the temporary
  snapshot. Run `verify.py` again: the source database remains unchanged.
- **Find code references:** open `payroll.py`. The navigator shows a model,
  salary read/write references and an explicitly unresolved dynamic query.

Pick one advanced example for a short presentation. There is no need to demo
every page.

## Optional live AI demonstration

Connect one available provider in Settings. Real generation uses its allowance.
With **College demo** selected, ask:

1. “Show employees earning more than 8000 INR per month.” Review and run:
   Cara and Dev.
2. “Only those in IT.” Review and run: Dev, while retaining the salary condition.
3. Optionally save the reviewed definition **high earners**, rule `salary > 9000`,
   units `salary: INR/monthly`, for this connection. Then ask about high earners.

These are expected outcomes, not evidence that a model has passed. Record the
actual SQL and returned rows when the live provider is tested. With ChatGPT,
each additional allowed attempt is explicit in Settings. Failed attempts also
count. If quota is unavailable, say that live AI is unavailable and use the
manual SQL path above; do not label it AI-generated.

See the repository's `docs/DEMO-GUIDE.md` for the presentation sequence and
`docs/SUBMISSION-REPORT.md` for the architecture and evaluation boundaries.
