"""Synthetic application references for the navigator. Verbis scans, never runs, this file."""
from sqlalchemy import Column, ForeignKey, Integer, String, select, text, update
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class Employee(Base):
    __tablename__ = 'employees'
    id = Column(Integer, primary_key=True)
    name = Column(String)
    salary = Column(Integer)
    department = Column(String, ForeignKey('departments.name'))


def high_earners(session, threshold=8000):
    """Salary is INR per month in this synthetic fixture."""
    return session.execute(select(Employee).where(Employee.salary > threshold))


def payroll_total(session):
    return session.execute(text('SELECT SUM(salary) AS total FROM employees'))


def change_salary(session, employee_id, new_salary):
    return session.execute(update(Employee).where(Employee.id == employee_id).values(salary=new_salary))


def unresolved_query(session, sql):
    """Deliberately dynamic: the navigator must report this as unresolved."""
    return session.execute(sql)
