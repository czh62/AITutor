"""知识图谱路由。

只读转发：接收前端请求 → 调用 LightRAGClient → 解析响应为 Pydantic schema → 返回。
路径与前端期望一致（无 /api 前缀），对齐 LightRAG 路由结构。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request

from ..schemas.graph import GraphData
from ..services.lightrag_client import LightRAGClient

router = APIRouter(tags=["graph"])


def get_lightrag_client(request: Request) -> LightRAGClient:
    """从 app.state 获取 LightRAGClient（lifespan 中创建并存储）。"""
    return request.app.state.lightrag_client


# ------------------------------------------------------------------
#  1. 查询知识图谱
# ------------------------------------------------------------------

@router.get("/graphs", response_model=GraphData)
async def get_graph(
    label: str = Query("*", description="实体标签，* 表示全局图谱"),
    max_depth: int = Query(3, ge=1, le=10),
    max_nodes: int = Query(1000, ge=1, le=100000),
    client: LightRAGClient = Depends(get_lightrag_client),
):
    raw = await client.get_graph(label=label, max_depth=max_depth, max_nodes=max_nodes)
    return GraphData(**raw)


# ------------------------------------------------------------------
#  2. 全部标签
# ------------------------------------------------------------------

@router.get("/graph/label/list", response_model=list[str])
async def get_graph_labels(client: LightRAGClient = Depends(get_lightrag_client)):
    raw = await client.get_graph_labels()
    return raw


# ------------------------------------------------------------------
#  3. 热门标签
# ------------------------------------------------------------------

@router.get("/graph/label/popular", response_model=list[str])
async def get_popular_labels(
    limit: int = Query(300, ge=1, le=10000),
    client: LightRAGClient = Depends(get_lightrag_client),
):
    raw = await client.get_popular_labels(limit=limit)
    return raw


# ------------------------------------------------------------------
#  4. 搜索标签
# ------------------------------------------------------------------

@router.get("/graph/label/search", response_model=list[str])
async def search_labels(
    q: str = Query(..., min_length=1),
    limit: int = Query(50, ge=1, le=1000),
    client: LightRAGClient = Depends(get_lightrag_client),
):
    raw = await client.search_labels(query=q, limit=limit)
    return raw
