"""Schema Creation Routes — Text2Schema feature."""

from typing import Optional, Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from services.schema_creator_service import (
    generate_schema_from_nl, schema_to_ddl, schema_to_mermaid,
    count_tables, refine_schema,
)

router = APIRouter()


async def while_connected(request, operation):
    import asyncio
    task=asyncio.create_task(operation)
    async def watch():
        while not task.done():
            if await request.is_disconnected():task.cancel();return
            await asyncio.sleep(0.1)
    watcher=asyncio.create_task(watch())
    try:return await task
    finally:watcher.cancel()


class SchemaCreateRequest(BaseModel):
    description: str = Field(min_length=1,max_length=20000)
    dialect: Literal['postgresql','mysql','sqlite'] = 'postgresql'
    provider: Literal['gemini','groq','openrouter','local'] = 'gemini'
    api_key: str = ""
    model: Optional[str] = None


class SchemaRefineRequest(BaseModel):
    existing_schema: dict
    refinement: str = Field(min_length=1,max_length=20000)
    dialect: Literal['postgresql','mysql','sqlite'] = 'postgresql'
    provider: Literal['gemini','groq','openrouter','local'] = 'gemini'
    api_key: str = ""
    model: Optional[str] = None


@router.post("/schema/create")
async def create_schema(req: SchemaCreateRequest, request: Request):
    try:
        schema = await while_connected(request,generate_schema_from_nl(
        description=req.description,
        dialect=req.dialect,
        provider=req.provider,
        api_key=req.api_key,
        model=req.model,
    ))
        ddl = schema_to_ddl(schema, req.dialect)
    except Exception as exc:
        from api.routes.generate import _friendly_generation_error
        from services.llm_service import ModelOutputError, ProviderConfigurationError
        if isinstance(exc, ProviderConfigurationError): raise HTTPException(422,detail=str(exc))
        if isinstance(exc, ModelOutputError): raise HTTPException(422,detail=str(exc))
        if isinstance(exc, ValueError): raise HTTPException(422,detail=f'Provider returned an invalid schema: {exc}. Refine the description.')
        raise _friendly_generation_error(exc,req.provider,req.model or '')
    return {
        "schema": schema,
        "ddl": ddl,
        "mermaid": schema_to_mermaid(schema),
        "table_count": count_tables(ddl),
    }


@router.post("/schema/refine")
async def refine_schema_endpoint(req: SchemaRefineRequest, request: Request):
    try:
        updated = await while_connected(request,refine_schema(
        existing_schema=req.existing_schema,
        refinement=req.refinement,
        dialect=req.dialect,
        provider=req.provider,
        api_key=req.api_key,
        model=req.model,
    ))
        ddl = schema_to_ddl(updated, req.dialect)
    except Exception as exc:
        from api.routes.generate import _friendly_generation_error
        from services.llm_service import ModelOutputError, ProviderConfigurationError
        if isinstance(exc, ProviderConfigurationError): raise HTTPException(422,detail=str(exc))
        if isinstance(exc, ModelOutputError): raise HTTPException(422,detail=str(exc))
        if isinstance(exc, ValueError): raise HTTPException(422,detail=f'Provider returned an invalid schema: {exc}. Refine the description.')
        raise _friendly_generation_error(exc,req.provider,req.model or '')
    return {
        "schema": updated,
        "ddl": ddl,
        "mermaid": schema_to_mermaid(updated),
        "table_count": count_tables(ddl),
    }
