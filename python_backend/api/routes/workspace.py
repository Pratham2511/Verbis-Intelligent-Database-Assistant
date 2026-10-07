"""Small complete workspace operations; no remote model calls or automatic production writes."""
from fastapi import APIRouter,HTTPException,Request
from pydantic import BaseModel,Field
from starlette.concurrency import run_in_threadpool
from services.dataset_service import DatasetService
from services.navigator_service import NavigatorService
from services.analysis_service import AnalysisService
from api.routes.schema import schema_result
from api.routes.glossary import get_glossary
router=APIRouter()
class WorkspaceAction(BaseModel):
    payload:dict=Field(default_factory=dict)
@router.post('/workspace/{action}')
async def workspace_action(action:str,req:WorkspaceAction,request:Request):
    state=request.app.state.qm;p=req.payload
    try:
        if action=='tree_fork':return state.history_store.fork(p['nodeId'])
        if action=='tree_checkpoint':return state.history_store.checkpoint(p['nodeId'],p['label'])
        if action=='dataset_preview':return await run_in_threadpool(DatasetService(state).preview,p)
        if action=='dataset_import':return await run_in_threadpool(DatasetService(state).import_csv,p)
        if action=='dataset_catalog':return DatasetService(state).store.read({'tables':[]})
        if action=='project_scan':return await run_in_threadpool(NavigatorService(state).scan)
        if action=='analysis_list':return AnalysisService(state).list()
        if action=='analysis_save':
            info=await schema_result(state,p.get('connectionId',''))
            return AnalysisService(state).save(p,info,await get_glossary(request))
        if action=='analysis_delete':return AnalysisService(state).delete(p['id'])
        if action=='forensics':
            from services.forensics_service import ForensicsService
            return await ForensicsService(state,p.get('connectionId','')).diagnose(p)
        if action=='reconcile':
            from services.reconciliation_service import ReconciliationService
            return await ReconciliationService(state).run(p)
        if action=='reconcile_preview':
            from services.reconciliation_service import ReconciliationService
            return await ReconciliationService(state).preview(p)
        if action=='rehearsal':
            from services.rehearsal_service import RehearsalService
            return await RehearsalService(state).run(p)
        if action=='last_result':return state.extra.get('last_result',{})
        raise HTTPException(404,detail='Unknown workspace operation')
    except HTTPException:raise
    except (ValueError,KeyError) as exc:raise HTTPException(422,detail=str(exc))
    except Exception as exc:raise HTTPException(400,detail='Workspace operation failed: '+str(exc)[:500])
