"""Type-aware per-cell masking; audit records never contain source values."""
import re
import time
DEFAULT_RULES = [
 ('email', r'^[\w.+-]+@[\w.-]+\.[a-z]{2,}$', 'xxx@xxx.com'),
 ('phone', r'^\+?[\d ()-]{10,20}$', 'XXX-XXX-XXXX'),
 ('ssn', r'^\d{3}-\d{2}-\d{4}$', 'XXX-XX-XXXX'),
 ('credit_card', r'^\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4}$', '****-****-****-****'),
]
class PIIMasker:
 def _column_type(self, name):
  parts = set(re.split(r'[_\W]+', name.lower()))
  if name.lower().replace('_','') in {'fullname','personname','employeename','customername'}: return 'name'
  if parts & {'email','mail'}: return 'email'
  if parts & {'phone','mobile','telephone'}: return 'phone'
  if parts & {'ssn'}: return 'ssn'
  if 'credit' in parts and 'card' in parts: return 'credit_card'
  return None
 def _detect_pii_type(self, name, sample):
  kind = self._column_type(name)
  if kind: return kind
  for value in sample:
   if not isinstance(value, str): continue
   for kind, pattern, _ in DEFAULT_RULES:
    if kind == 'phone' and not value.startswith('+'): continue
    if re.fullmatch(pattern, value.strip(), re.I): return kind
  return None
 def mask_results(self, columns, rows):
  result = [dict(r) for r in rows]; masked = set(); audit = []
  masks = {kind: mask for kind, _, mask in DEFAULT_RULES}; masks['name']='J*** D***'
  for row in result:
   for col in columns:
    value = row.get(col)
    if value is None: continue
    kind = self._detect_pii_type(col, [value])
    if kind:
     row[col] = masks[kind]; masked.add(col)
     audit.append(f'{time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())} | column={col} | type={kind}')
  return [c for c in columns if c in masked], result, audit
