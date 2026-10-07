"""Register validated connection updates without restarting or persisting passwords."""
import ssl as tls
import uuid
from typing import Literal
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from core.db_pool import build_connection_url
from sqlalchemy import text
router=APIRouter()
class Connection(BaseModel):
 id:str=Field(min_length=1,max_length=100)
 name:str=Field(min_length=1,max_length=200)
 dialect:Literal['sqlite','postgresql','mysql']
 database:str=Field(min_length=1)
 host:str='localhost'
 port:int=Field(default=0,ge=0,le=65535)
 user:str=''
 ssl:bool=False
 sslCa: str|None=None
class Registration(BaseModel):
 connection:Connection
 password:str=''
 validate_only:bool=False
@router.post('/connections')
async def register(req:Registration,request:Request):
 state=request.app.state.qm;c=req.connection
 url=build_connection_url(c.dialect,c.host,c.port,c.database,c.user,req.password,
                          ssl=c.ssl,workspace_path=state.settings.workspace_path)
 candidate=c.id if not req.validate_only else '__validate_'+uuid.uuid4().hex
 try:
  args={}
  if c.ssl and c.dialect=='postgresql':args={'sslmode':'verify-full',**({'sslrootcert':c.sslCa} if c.sslCa else {})}
  if c.ssl and c.dialect=='mysql':args={'ssl':tls.create_default_context(cafile=c.sslCa)}
  await run_in_threadpool(state.db_pools.register,candidate,url,5,args,True)
 except Exception:
  raise HTTPException(400,detail='Connection validation failed. Check path, host, credentials and TLS certificate.')
 if req.validate_only:state.db_pools.dispose(candidate)
 else:state.extra.setdefault('schemas',{}).pop(c.id,None)
 return {'registered':True,'connectionId':c.id}
@router.delete('/connections/{connection_id}')
async def delete(connection_id:str,request:Request):
 request.app.state.qm.db_pools.dispose(connection_id)
 request.app.state.qm.extra.setdefault('schemas',{}).pop(connection_id,None)
 return {'removed':True}
