"""Atomic stores shared by workspace modules. Malformed files fail visibly."""
import json
import threading
import uuid
from pathlib import Path
class WorkspaceStore:
    _locks={}
    _guard=threading.Lock()
    def __init__(self,path):
        self.path=Path(path)
        with self._guard:self.lock=self._locks.setdefault(str(self.path.resolve()),threading.RLock())
    def read(self,default):
        with self.lock:
            if not self.path.exists():return default
            return json.loads(self.path.read_text())
    def write(self,value):
        with self.lock:
            self.path.parent.mkdir(parents=True,exist_ok=True)
            temp=self.path.with_name(self.path.name+'.'+uuid.uuid4().hex+'.tmp')
            try:
                temp.write_text(json.dumps(value,indent=2,default=str));temp.replace(self.path)
            finally:temp.unlink(missing_ok=True)
    def update(self,default,fn):
        with self.lock:
            value=self.read(default);result=fn(value);self.write(value);return result
