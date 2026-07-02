"""知识问答路由（LightRAG query 透传）。

- POST /query        非流式查询，返回 JSON {response, references}。
- POST /query/stream  NDJSON 流式查询，逐行：
    {"references": [...]}（可选首行）/ {"response": "..."} / {"error": "..."}

模式与 documents.py 一致：收请求 → 调 LightRAGClient → 解析/透传。
流式端点用 StreamingResponse 转发 NDJSON，无法套 response_model。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from ..schemas.query import QueryRequest, QueryResponse
from ..services.lightrag_client import LightRAGClient

router = APIRouter(tags=["query"])


def get_lightrag_client(request: Request) -> LightRAGClient:
    """从 app.state 获取 LightRAGClient（与 documents.py 同一依赖）。"""
    return request.app.state.lightrag_client


# ------------------------------------------------------------------
#  1. 非流式查询
# ------------------------------------------------------------------

@router.post("/query", response_model=QueryResponse)
async def query(
    request: QueryRequest,
    client: LightRAGClient = Depends(get_lightrag_client),
):
    body = request.model_dump(exclude_none=True)
    body["stream"] = False
    raw = await client.query(body)
    return QueryResponse(**raw)


# ------------------------------------------------------------------
#  2. 流式查询（NDJSON）
# ------------------------------------------------------------------

@router.post("/query/stream")
async def query_stream(
    request: QueryRequest,
    client: LightRAGClient = Depends(get_lightrag_client),
):
    body = request.model_dump(exclude_none=True)
    body["stream"] = True
    # no-cache 防止代理缓冲；X-Accel-Buffering: no 关闭 nginx 缓冲，确保逐行下发
    return StreamingResponse(
        client.query_stream(body),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
