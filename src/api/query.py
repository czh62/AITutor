"""Knowledge query routes backed by QueryService."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from ..core.logging import get_logger
from ..schemas.query import QueryRequest, QueryResponse, ResumeRequest
from ..services.lightrag_client import LightRAGClient
from ..services.llm_client import LLMClient
from ..services.query_service import QueryService
from ..services.search_client import SearchClient

logger = get_logger("aitutor.query")

router = APIRouter(tags=["query"])


def get_lightrag_client(request: Request) -> LightRAGClient:
    """Return the app-scoped LightRAG client."""
    return request.app.state.lightrag_client


def get_llm_client(request: Request) -> LLMClient:
    """Return the app-scoped LLM client."""
    return request.app.state.llm_client


def get_search_client(request: Request) -> SearchClient | None:
    """Return the optional app-scoped search client."""
    return getattr(request.app.state, "search_client", None)


def get_memory_manager(request: Request) -> Any:
    """Return the optional app-scoped memory manager."""
    return getattr(request.app.state, "memory_manager", None)


def create_query_service(
    lightrag: LightRAGClient,
    llm: LLMClient,
    search: SearchClient | None,
    memory: Any,
) -> QueryService:
    return QueryService(
        lightrag_client=lightrag,
        llm_client=llm,
        search_client=search,
        memory_manager=memory,
    )


@router.post("/query", response_model=QueryResponse)
async def query(
    request: QueryRequest,
    lightrag: LightRAGClient = Depends(get_lightrag_client),
    llm: LLMClient = Depends(get_llm_client),
    search: SearchClient | None = Depends(get_search_client),
    memory: Any = Depends(get_memory_manager),
):
    """Run a non-streaming AgentLoop query."""
    service = create_query_service(
        lightrag=lightrag,
        llm=llm,
        search=search,
        memory=memory,
    )
    return await service.query(request)


@router.post("/query/stream")
async def query_stream(
    request: QueryRequest,
    lightrag: LightRAGClient = Depends(get_lightrag_client),
    llm: LLMClient = Depends(get_llm_client),
    search: SearchClient | None = Depends(get_search_client),
    memory: Any = Depends(get_memory_manager),
):
    """Stream AgentLoop NDJSON events."""
    service = create_query_service(
        lightrag=lightrag,
        llm=llm,
        search=search,
        memory=memory,
    )
    return StreamingResponse(
        service.query_stream(request),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.post("/query/resume")
async def query_resume(
    request: ResumeRequest,
    lightrag: LightRAGClient = Depends(get_lightrag_client),
    llm: LLMClient = Depends(get_llm_client),
    search: SearchClient | None = Depends(get_search_client),
    memory: Any = Depends(get_memory_manager),
):
    """Resume a paused ask_user AgentLoop session."""
    service = create_query_service(
        lightrag=lightrag,
        llm=llm,
        search=search,
        memory=memory,
    )
    return StreamingResponse(
        service.resume_stream(request),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
