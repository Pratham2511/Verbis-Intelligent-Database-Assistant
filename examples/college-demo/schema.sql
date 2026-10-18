CREATE TABLE departments (
    name TEXT PRIMARY KEY NOT NULL,
    description TEXT NOT NULL
);
CREATE TABLE employees (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    salary INTEGER CHECK (salary IS NULL OR salary >= 0),
    department TEXT NOT NULL REFERENCES departments(name)
);
CREATE TABLE payments (
    id INTEGER PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    amount INTEGER NOT NULL CHECK (amount >= 0)
);
